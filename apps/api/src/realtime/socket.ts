import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { clientMessageSchema, type WorldEvent } from '@agents-world/shared'
import { requireMembership } from '../auth/workspaces.js'
import { resolveSession, SESSION_COOKIE } from '../auth/sessions.js'
import { db, schema } from '../db/client.js'
import { eq } from 'drizzle-orm'
import type { EventBus } from './bus.js'

/**
 * The WebSocket endpoint the 3D world connects to.
 *
 * One socket per client, many goals per socket. The contract is narrow on
 * purpose: a client may subscribe, unsubscribe and ping. It cannot ask the
 * server to do anything else here - commands go over HTTP, where they are
 * authenticated, audited and idempotent. A socket that could start work would
 * be a socket that could start work twice on a flaky connection.
 */

/** Below the 60s most proxies use, so an idle socket is not silently dropped. */
const HEARTBEAT_MS = 30_000

interface Subscription {
  readonly goalId: string
  readonly unsubscribe: () => void
}

export async function registerSocket(
  app: FastifyInstance,
  bus: EventBus,
): Promise<void> {
  app.get('/ws', { websocket: true }, async (socket, request) => {
    // Authenticate before the socket is useful for anything. An unauthenticated
    // socket that is allowed to linger is a socket someone will find a use for.
    const resolved = await resolveSession(request.cookies[SESSION_COOKIE])
    if (!resolved) {
      socket.close(4401, 'Not signed in')
      return
    }
    // Bound to its own const so the narrowing survives into the message
    // handler below; TypeScript cannot carry an early return through a closure.
    const session = resolved

    const subscriptions = new Map<string, Subscription>()
    let alive = true

    const send = (payload: unknown): void => {
      if (socket.readyState !== socket.OPEN) return
      socket.send(JSON.stringify(payload))
    }

    const heartbeat = setInterval(() => {
      // A client that stopped answering is gone even though TCP has not
      // noticed. Without this its subscriptions leak until the process
      // restarts.
      if (!alive) {
        socket.terminate()
        return
      }
      alive = false
      socket.ping()
    }, HEARTBEAT_MS)

    socket.on('pong', () => {
      alive = true
    })

    socket.on('message', (raw: Buffer) => {
      void handleMessage(raw)
    })

    async function handleMessage(raw: Buffer): Promise<void> {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        send({ type: 'error', message: 'Malformed frame' })
        return
      }

      const message = clientMessageSchema.safeParse(parsed)
      if (!message.success) {
        send({ type: 'error', message: 'Unrecognised message' })
        return
      }

      const command = message.data

      if (command.type === 'ping') {
        alive = true
        send({ type: 'pong' })
        return
      }

      if (command.type === 'unsubscribe') {
        subscriptions.get(command.goalId)?.unsubscribe()
        subscriptions.delete(command.goalId)
        return
      }

      if (subscriptions.has(command.goalId)) return

      // Authorise per goal, not once per socket. Session membership at connect
      // time says nothing about this particular goal, and a goal id is easy to
      // guess at compared to a session cookie.
      const [goal] = await db()
        .select({ workspaceId: schema.goals.workspaceId })
        .from(schema.goals)
        .where(eq(schema.goals.id, command.goalId))
        .limit(1)

      if (!goal) {
        send({ type: 'error', message: 'No such goal' })
        return
      }

      try {
        await requireMembership(session.userId, goal.workspaceId)
      } catch {
        // Same answer as a missing goal. Distinguishing "does not exist" from
        // "not yours" tells an attacker which goal ids are real.
        send({ type: 'error', message: 'No such goal' })
        return
      }

      const unsubscribe = await bus.subscribe(
        command.goalId,
        command.sinceSeq,
        (event: WorldEvent) => send(event),
      )

      subscriptions.set(command.goalId, { goalId: command.goalId, unsubscribe })
      send({ type: 'subscribed', goalId: command.goalId })
    }

    socket.on('close', () => {
      clearInterval(heartbeat)
      for (const subscription of subscriptions.values()) subscription.unsubscribe()
      subscriptions.clear()
    })

    socket.on('error', (err: Error) => {
      app.log.warn({ err }, 'websocket error')
    })

    send({ type: 'ready' })
  })
}

export type { WebSocket }
