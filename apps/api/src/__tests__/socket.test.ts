import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'

process.env.DATABASE_URL ??= 'postgresql://test/test'
process.env.ANTHROPIC_API_KEY ??= 'test-key'
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')
process.env.SESSION_SECRET ??= randomBytes(48).toString('base64')

const { freshDatabase, seedGoal, seedWorkspace } = await import('./helpers.js')
const { buildApp } = await import('../main.js')
const { EventBus } = await import('../realtime/bus.js')
const { PostgresEventStore } = await import('../realtime/store.js')
const { issueSession, SESSION_COOKIE } = await import('../auth/sessions.js')

/**
 * Socket tests over a real listening server and a real ws client.
 *
 * inject() cannot express an upgrade, and the HTTP 101 that an upgrade returns
 * says nothing about whether the handler then accepted the connection - the
 * protocol switch happens before any of our code runs. Only a real client can
 * show that an unauthenticated socket is actually closed rather than merely
 * upgraded and left open.
 */

const stubClient = {
  messages: {
    parse: async () => ({ parsed_output: {}, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
    create: async () => ({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
  },
} as unknown as Anthropic

let app: FastifyInstance
let bus: InstanceType<typeof EventBus>
let port: number
let db: Awaited<ReturnType<typeof freshDatabase>>

before(async () => {
  db = await freshDatabase()
  bus = new EventBus(new PostgresEventStore())
  app = await buildApp(stubClient, bus)
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  port = typeof address === 'object' && address ? address.port : 0
})

after(async () => {
  await app.close()
})

const connect = (cookie?: string): WebSocket =>
  new WebSocket(`ws://127.0.0.1:${port}/ws`, cookie ? { headers: { cookie } } : {})

/** Resolve on the first message, or on close, whichever comes first. */
function firstEvent(socket: WebSocket): Promise<
  { kind: 'message'; data: Record<string, unknown> } | { kind: 'close'; code: number }
> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket timed out')), 5000)
    socket.once('message', (raw: Buffer) => {
      clearTimeout(timer)
      resolve({ kind: 'message', data: JSON.parse(raw.toString()) })
    })
    socket.once('close', (code: number) => {
      clearTimeout(timer)
      resolve({ kind: 'close', code })
    })
    socket.once('error', () => {
      // A socket closed during handshake surfaces as an error on some
      // platforms; the close handler above still settles the promise.
    })
  })
}

test('an unauthenticated socket is closed, not left open', async () => {
  const socket = connect()
  const result = await firstEvent(socket)

  assert.equal(result.kind, 'close', 'the server hung up rather than serving frames')
  assert.equal(result.code, 4401, 'with the not-signed-in code')
  socket.close()
})

test('an authenticated socket is greeted', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const { token } = await issueSession({ userId, workspaceId })

  const socket = connect(`${SESSION_COOKIE}=${token}`)
  const result = await firstEvent(socket)

  assert.equal(result.kind, 'message')
  assert.equal(result.kind === 'message' ? result.data.type : null, 'ready')
  socket.close()
})

test('subscribing streams live agent state to the client', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)
  const { token } = await issueSession({ userId, workspaceId })

  const socket = connect(`${SESSION_COOKIE}=${token}`)
  const frames: Record<string, unknown>[] = []

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('never received the agent event')), 8000)

    socket.on('message', (raw: Buffer) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>
      frames.push(frame)

      if (frame.type === 'ready') {
        socket.send(JSON.stringify({ type: 'subscribe', goalId, sinceSeq: 0 }))
      }
      if (frame.type === 'subscribed') {
        void bus.emit({
          goalId, workspaceId, type: 'agent.state_changed',
          agentKey: 'email', taskId: null, state: 'working',
          activity: 'Reading your mail', error: null,
        })
      }
      if (frame.type === 'agent.state_changed') {
        clearTimeout(timer)
        resolve()
      }
    })
    socket.on('error', reject)
  })

  const agentFrame = frames.find((f) => f.type === 'agent.state_changed')
  assert.equal(agentFrame?.state, 'working', 'the island learns the agent started')
  assert.equal(agentFrame?.activity, 'Reading your mail')
  assert.equal(agentFrame?.seq, 0, 'carrying the sequence number for ordering')
  socket.close()
})

test('a client cannot subscribe to another workspace\'s goal', async () => {
  const a = await seedWorkspace(db)
  const b = await seedWorkspace(db)
  const goalId = await seedGoal(db, a.workspaceId, a.userId)
  const { token } = await issueSession({ userId: b.userId, workspaceId: b.workspaceId })

  const socket = connect(`${SESSION_COOKIE}=${token}`)

  const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no reply')), 5000)
    socket.on('message', (raw: Buffer) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>
      if (frame.type === 'ready') {
        socket.send(JSON.stringify({ type: 'subscribe', goalId, sinceSeq: 0 }))
        return
      }
      clearTimeout(timer)
      resolve(frame)
    })
    socket.on('error', reject)
  })

  assert.equal(reply.type, 'error')
  assert.equal(
    reply.message,
    'No such goal',
    'the same answer a missing goal gives, so ids cannot be probed',
  )
  socket.close()
})

test('a reconnecting client receives only the frames it missed', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)
  const { token } = await issueSession({ userId, workspaceId })

  for (const state of ['planning', 'executing', 'synthesising'] as const) {
    await bus.emit({ goalId, workspaceId, type: 'goal.state_changed', state, error: null })
  }

  const socket = connect(`${SESSION_COOKIE}=${token}`)
  const replayed: number[] = []

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('replay never arrived')), 8000)
    socket.on('message', (raw: Buffer) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>
      if (frame.type === 'ready') {
        // Pretend the client already applied seq 0 before it dropped.
        socket.send(JSON.stringify({ type: 'subscribe', goalId, sinceSeq: 1 }))
        return
      }
      if (frame.type === 'goal.state_changed') replayed.push(frame.seq as number)
      if (replayed.length === 2) {
        clearTimeout(timer)
        resolve()
      }
    })
    socket.on('error', reject)
  })

  assert.deepEqual(replayed, [1, 2], 'the gap, not the whole history')
  socket.close()
})

test('a malformed frame is answered, not fatal', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const { token } = await issueSession({ userId, workspaceId })
  const socket = connect(`${SESSION_COOKIE}=${token}`)

  const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no reply')), 5000)
    socket.on('message', (raw: Buffer) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>
      if (frame.type === 'ready') {
        socket.send('this is not json')
        return
      }
      clearTimeout(timer)
      resolve(frame)
    })
    socket.on('error', reject)
  })

  assert.equal(reply.type, 'error')
  assert.equal(socket.readyState, WebSocket.OPEN, 'the socket survived a bad frame')
  socket.close()
})
