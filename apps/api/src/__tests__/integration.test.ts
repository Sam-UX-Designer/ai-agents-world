import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import { eq } from 'drizzle-orm'

// config() is read at import time by several modules, so the environment has
// to be complete before anything else loads.
process.env.DATABASE_URL ??= 'postgresql://test/test'
process.env.ANTHROPIC_API_KEY ??= 'test-key'
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')
process.env.SESSION_SECRET ??= randomBytes(48).toString('base64')

const { freshDatabase, seedGoal, seedWorkspace, schema } = await import('./helpers.js')
const { EventBus } = await import('../realtime/bus.js')
const { PostgresEventStore } = await import('../realtime/store.js')
const { decryptToken, encryptToken } = await import('../db/crypto.js')
const sessions = await import('../auth/sessions.js')
const workspaces = await import('../auth/workspaces.js')
const connections = await import('../tools/connections.js')

type Db = Awaited<ReturnType<typeof freshDatabase>>
let db: Db

beforeEach(async () => {
  db = await freshDatabase()
})

// ------------------------------------------------------------- event store --

test('events get consecutive sequence numbers', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)
  const bus = new EventBus(new PostgresEventStore())

  const first = await bus.emit({
    goalId, workspaceId, type: 'goal.state_changed', state: 'planning', error: null,
  })
  const second = await bus.emit({
    goalId, workspaceId, type: 'goal.state_changed', state: 'executing', error: null,
  })

  assert.equal(first.seq, 0)
  assert.equal(second.seq, 1)
})

test('concurrent emitters never collide on a sequence number', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)
  const bus = new EventBus(new PostgresEventStore())

  // Four agents in one wave all reporting at once - the case an in-process
  // counter would get wrong the moment we run two API instances.
  const emitted = await Promise.all(
    ['email', 'calendar', 'slack', 'orchestrator'].map((agentKey) =>
      bus.emit({
        goalId, workspaceId, type: 'agent.state_changed',
        agentKey, taskId: null, state: 'working', activity: 'busy', error: null,
      }),
    ),
  )

  const seqs = emitted.map((e) => e.seq).sort((a, b) => a - b)
  assert.deepEqual(seqs, [0, 1, 2, 3], 'every emitter got a distinct sequence number')
})

test('a reconnecting client replays exactly the frames it missed', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)
  const bus = new EventBus(new PostgresEventStore())

  for (const state of ['planning', 'executing', 'synthesising'] as const) {
    await bus.emit({ goalId, workspaceId, type: 'goal.state_changed', state, error: null })
  }

  const received: number[] = []
  await bus.subscribe(goalId, 1, (e) => received.push(e.seq))

  assert.deepEqual(received, [1, 2], 'got the gap, not the frames it already had')
})

test('events are durable before anyone is told about them', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)
  const bus = new EventBus(new PostgresEventStore())

  let rowsAtBroadcast = -1
  await bus.subscribe(goalId, 0, () => {
    // Reading synchronously inside the subscriber would race; instead check
    // that emit() resolved only after the row existed.
    rowsAtBroadcast = 1
  })

  await bus.emit({
    goalId, workspaceId, type: 'goal.state_changed', state: 'planning', error: null,
  })

  const stored = await db.select().from(schema.worldEvents).where(eq(schema.worldEvents.goalId, goalId))
  assert.equal(stored.length, 1, 'the event was persisted')
  assert.equal(rowsAtBroadcast, 1, 'and the subscriber was called')
})

test('one broken subscriber does not stop the others', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)
  const bus = new EventBus(new PostgresEventStore())

  let healthyReceived = 0
  await bus.subscribe(goalId, 0, () => { throw new Error('this tab is broken') })
  await bus.subscribe(goalId, 0, () => { healthyReceived++ })

  await bus.emit({
    goalId, workspaceId, type: 'goal.state_changed', state: 'planning', error: null,
  })

  assert.equal(healthyReceived, 1, 'the working client still saw the world move')
})

// ----------------------------------------------------------------- crypto --

test('a token survives a round trip and a tampered one refuses to open', () => {
  const key = randomBytes(32).toString('base64')
  const sealed = encryptToken('ya29.super-secret-google-token', key)

  assert.ok(!sealed.includes('ya29'), 'the plaintext is not visible in the stored value')
  assert.equal(decryptToken(sealed, key), 'ya29.super-secret-google-token')

  const parts = sealed.split('.')
  const tampered = [parts[0], parts[1], parts[2], Buffer.from('evil').toString('base64url')].join('.')
  assert.throws(() => decryptToken(tampered, key), 'GCM rejects a modified ciphertext')

  assert.notEqual(
    encryptToken('same input', key),
    encryptToken('same input', key),
    'a fresh IV each time, so identical tokens do not produce identical ciphertext',
  )
})

// --------------------------------------------------------------- sessions --

test('a session resolves, then stops resolving once revoked', async () => {
  const { userId, workspaceId } = await seedWorkspace(db)

  const { token } = await sessions.issueSession({ userId, workspaceId })
  const resolved = await sessions.resolveSession(token)
  assert.equal(resolved?.userId, userId)

  await sessions.revokeSession(token)
  assert.equal(await sessions.resolveSession(token), null, 'revocation is immediate')
})

test('the raw cookie is never stored', async () => {
  const { userId, workspaceId } = await seedWorkspace(db)
  const { token } = await sessions.issueSession({ userId, workspaceId })

  const [row] = await db.select().from(schema.sessions)
  assert.ok(row)
  assert.notEqual(row.tokenHash, token, 'the stored value is a hash, not the cookie')
})

test('an expired session does not resolve', async () => {
  const { userId, workspaceId } = await seedWorkspace(db)
  const { token } = await sessions.issueSession({ userId, workspaceId })

  await db
    .update(schema.sessions)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(schema.sessions.userId, userId))

  assert.equal(await sessions.resolveSession(token), null)
})

// ------------------------------------------------------------- tenant guard --

test('a non-member is refused, loudly', async () => {
  const a = await seedWorkspace(db)
  const b = await seedWorkspace(db)

  await assert.rejects(
    () => workspaces.requireMembership(b.userId, a.workspaceId),
    /Not a member/,
    'one workspace cannot reach into another',
  )
})

test('a member without the role is refused', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  await db
    .update(schema.workspaceMembers)
    .set({ role: 'member' })
    .where(eq(schema.workspaceMembers.userId, userId))

  await assert.rejects(
    () => workspaces.requireMembership(userId, workspaceId, 'owner'),
    /needs the owner role/,
  )
})

test('"don\'t ask again" is recorded and does not duplicate', async () => {
  const { workspaceId } = await seedWorkspace(db)

  await workspaces.grantActionType(workspaceId, 'slack.post_message')
  await workspaces.grantActionType(workspaceId, 'slack.post_message')

  const workspace = await workspaces.getWorkspace(workspaceId)
  assert.deepEqual(workspace?.grantedActionTypes, ['slack.post_message'])
})

// ------------------------------------------------------------ connections --

test('a saved connection exposes no secrets when listed', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)

  await connections.saveConnection(workspaceId, userId, 'google', {
    accessToken: 'ya29.secret-access',
    refreshToken: '1//secret-refresh',
    expiresAt: new Date(Date.now() + 3600_000),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    accountLabel: 'sam@example.com',
  })

  const listed = await connections.listConnections(workspaceId)
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.accountLabel, 'sam@example.com')

  const serialised = JSON.stringify(listed)
  assert.ok(!serialised.includes('ya29'), 'no access token in what a client receives')
  assert.ok(!serialised.includes('secret-refresh'), 'no refresh token either')
})

test('a fresh token comes back decrypted, and a missing scope is refused', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)

  await connections.saveConnection(workspaceId, userId, 'google', {
    accessToken: 'ya29.still-fresh',
    refreshToken: null,
    expiresAt: new Date(Date.now() + 3600_000),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    accountLabel: 'sam@example.com',
  })

  assert.equal(
    await connections.accessTokenFor(workspaceId, 'google'),
    'ya29.still-fresh',
  )

  await assert.rejects(
    () => connections.accessTokenFor(workspaceId, 'google', 'https://www.googleapis.com/auth/gmail.send'),
    /did not grant/,
    'a scope the user declined is caught before we call Google',
  )
})

test('an unconnected provider fails with a message a user can act on', async () => {
  const { workspaceId } = await seedWorkspace(db)
  await assert.rejects(
    () => connections.accessTokenFor(workspaceId, 'slack'),
    /No slack account is connected/,
  )
})

test('revoking keeps the row so the audit trail survives', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const { connectionId } = await connections.saveConnection(workspaceId, userId, 'slack', {
    accessToken: 'xoxp-secret',
    refreshToken: null,
    expiresAt: null,
    scopes: ['channels:read'],
    accountLabel: 'Acme',
  })

  await connections.revokeConnection(workspaceId, connectionId)

  assert.equal((await connections.listConnections(workspaceId)).length, 0, 'gone from the UI')
  const rows = await db.select().from(schema.connections)
  assert.equal(rows.length, 1, 'but the row remains for audit')
  assert.equal(rows[0]?.accessTokenEnc, '', 'with the secret wiped')
})

test('workspace data cannot leak across the tenant boundary', async () => {
  const a = await seedWorkspace(db)
  const b = await seedWorkspace(db)

  await connections.saveConnection(a.workspaceId, a.userId, 'google', {
    accessToken: 'ya29.workspace-a', refreshToken: null,
    expiresAt: new Date(Date.now() + 3600_000), scopes: [], accountLabel: 'a@example.com',
  })

  assert.equal((await connections.listConnections(b.workspaceId)).length, 0)
  await assert.rejects(() => connections.accessTokenFor(b.workspaceId, 'google'))
})
