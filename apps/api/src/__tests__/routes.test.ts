import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import type { FastifyInstance } from 'fastify'

process.env.DATABASE_URL ??= 'postgresql://test/test'
process.env.ANTHROPIC_API_KEY ??= 'test-key'
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')
process.env.SESSION_SECRET ??= randomBytes(48).toString('base64')
process.env.GOOGLE_CLIENT_ID ??= 'test-google-client'
process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-secret'
process.env.GOOGLE_REDIRECT_URI ??= 'http://localhost:4000/auth/google/callback'

const { freshDatabase, seedWorkspace } = await import('./helpers.js')
const { buildApp } = await import('../main.js')
const { EventBus } = await import('../realtime/bus.js')
const { PostgresEventStore } = await import('../realtime/store.js')
const { issueSession, SESSION_COOKIE } = await import('../auth/sessions.js')

/**
 * Route tests driven through Fastify's inject().
 *
 * Same app, same plugins, same auth path as production - just no socket. What
 * these prove is that the tenant boundary and the auth gate actually hold at
 * the HTTP edge, which is the layer an attacker can reach.
 */

const stubClient = {
  messages: {
    parse: async () => ({
      parsed_output: { interpretation: 'x', tasks: [], unsupported: [] },
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    create: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  },
} as unknown as Anthropic

let app: FastifyInstance
let db: Awaited<ReturnType<typeof freshDatabase>>

beforeEach(async () => {
  db = await freshDatabase()
  app = await buildApp(stubClient, new EventBus(new PostgresEventStore()))
  await app.ready()
})

const cookieFor = async (userId: string, workspaceId: string): Promise<string> => {
  const { token } = await issueSession({ userId, workspaceId })
  return `${SESSION_COOKIE}=${token}`
}

test('health reports the service and whether voice is configured', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.status, 'ok')
  assert.equal(body.voice, 'text-only', 'no ElevenLabs key configured in tests')
})

test('the agent roster is served for the island', async () => {
  const res = await app.inject({ method: 'GET', url: '/agents' })
  assert.equal(res.statusCode, 200)

  const agents = res.json() as {
    key: string
    zone: { position: number[]; hero: number[] }
    tools: { id: string }[]
  }[]

  const keys = agents.map((a) => a.key).sort()
  assert.deepEqual(
    keys,
    ['cto', 'design', 'development', 'finance', 'hr', 'marketing', 'operations', 'orchestrator', 'sales'],
    'one agent per department, not one per tool',
  )

  const orchestrator = agents.find((a) => a.key === 'orchestrator')
  assert.deepEqual(orchestrator?.zone.position, [0, 0, 0], 'the hub sits at the island centre')

  // The point of the shared catalogue: one tool, reachable by several roles.
  const senders = agents.filter((a) => a.tools.some((t) => t.id === 'gmail.send'))
  assert.ok(senders.length > 1, 'gmail.send is shared across departments, not owned by one agent')

  // Every agent needs a hero coordinate so its label can sit on the artwork.
  assert.ok(
    agents.every((a) => a.zone.hero.length === 2),
    'every agent has a position on the hero image',
  )
})

test('the connector catalogue marks unconfigured providers as blocked', async () => {
  const res = await app.inject({ method: 'GET', url: '/providers' })
  const providers = res.json() as { id: string; status: string; statusNote: string | null }[]

  const google = providers.find((p) => p.id === 'google')
  assert.equal(google?.status, 'available', 'Google is configured in this test env')

  const slack = providers.find((p) => p.id === 'slack')
  assert.equal(slack?.status, 'blocked', 'Slack has no credentials here')
  assert.match(slack?.statusNote ?? '', /Not configured/)

  const teams = providers.find((p) => p.id === 'microsoft')
  assert.equal(teams?.status, 'planned', 'Teams shows as coming, not as broken')
})

test('every data route refuses an unauthenticated caller', async () => {
  for (const url of ['/connections', '/goals', '/approvals']) {
    const res = await app.inject({ method: 'GET', url })
    assert.equal(res.statusCode, 401, `${url} must require a session`)
  }

  const post = await app.inject({ method: 'POST', url: '/goals', payload: { prompt: 'do a thing' } })
  assert.equal(post.statusCode, 401)
})

test('a forged session cookie is refused', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/goals',
    headers: { cookie: `${SESSION_COOKIE}=not-a-real-token` },
  })
  assert.equal(res.statusCode, 401)
})

test('submitting a goal returns immediately and persists it', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const cookie = await cookieFor(userId, workspaceId)

  const res = await app.inject({
    method: 'POST',
    url: '/goals',
    headers: { cookie },
    payload: { prompt: 'Summarise my morning', timezone: 'Asia/Kolkata' },
  })

  assert.equal(res.statusCode, 202, 'accepted, not awaited - the run continues server-side')
  const { goalId } = res.json() as { goalId: string }
  assert.ok(goalId)

  const list = await app.inject({ method: 'GET', url: '/goals', headers: { cookie } })
  const goals = list.json() as { id: string; prompt: string }[]
  assert.equal(goals[0]?.prompt, 'Summarise my morning')
})

test('an empty goal is rejected', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const res = await app.inject({
    method: 'POST',
    url: '/goals',
    headers: { cookie: await cookieFor(userId, workspaceId) },
    payload: { prompt: '' },
  })
  assert.equal(res.statusCode, 400)
})

test('one workspace cannot read another workspace\'s goal', async () => {
  const a = await seedWorkspace(db)
  const b = await seedWorkspace(db)

  const created = await app.inject({
    method: 'POST',
    url: '/goals',
    headers: { cookie: await cookieFor(a.userId, a.workspaceId) },
    payload: { prompt: 'private to A' },
  })
  const { goalId } = created.json() as { goalId: string }

  const stolen = await app.inject({
    method: 'GET',
    url: `/goals/${goalId}`,
    headers: { cookie: await cookieFor(b.userId, b.workspaceId) },
  })

  assert.equal(stolen.statusCode, 404, 'and 404, not 403 - existence is itself information')
})

test('connect returns an authorisation URL with plain-language permissions', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const res = await app.inject({
    method: 'GET',
    url: '/connect/google',
    headers: { cookie: await cookieFor(userId, workspaceId) },
  })

  assert.equal(res.statusCode, 200)
  const body = res.json() as { url: string; permissions: string[] }

  assert.match(body.url, /^https:\/\/accounts\.google\.com/)
  assert.match(body.url, /code_challenge=/, 'PKCE is in the request')
  assert.match(body.url, /access_type=offline/, 'so we receive a refresh token')
  assert.ok(
    body.permissions.some((p) => p.includes('only when you approve it')),
    'the consent screen says which actions still need the user',
  )
})

test('connecting an unconfigured provider fails with a reason, not a dead end', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const res = await app.inject({
    method: 'GET',
    url: '/connect/slack',
    headers: { cookie: await cookieFor(userId, workspaceId) },
  })
  assert.equal(res.statusCode, 409)
  assert.match((res.json() as { error: string }).error, /Not configured/)
})

test('an unknown provider is a 404', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const res = await app.inject({
    method: 'GET',
    url: '/connect/myspace',
    headers: { cookie: await cookieFor(userId, workspaceId) },
  })
  assert.equal(res.statusCode, 404)
})

test('an OAuth callback with a replayed state is refused', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/auth/google/callback?code=abc&state=never-issued',
  })
  assert.equal(res.statusCode, 302)
  assert.match(res.headers.location as string, /error=expired/)
})

test('a member cannot change the workspace autonomy level', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const { schema } = await import('./helpers.js')
  const { eq } = await import('drizzle-orm')

  await db
    .update(schema.workspaceMembers)
    .set({ role: 'member' })
    .where(eq(schema.workspaceMembers.userId, userId))

  const res = await app.inject({
    method: 'PUT',
    url: '/settings/autonomy',
    headers: { cookie: await cookieFor(userId, workspaceId) },
    payload: { level: 'autonomous' },
  })

  assert.equal(res.statusCode, 403, 'autonomy is not a per-member preference')
})

test('an owner can change the autonomy level', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const res = await app.inject({
    method: 'PUT',
    url: '/settings/autonomy',
    headers: { cookie: await cookieFor(userId, workspaceId) },
    payload: { level: 'ask_once_per_type' },
  })
  assert.equal(res.statusCode, 200)
})

test('speech returns 204 when no voice key is configured', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const res = await app.inject({
    method: 'POST',
    url: '/speak',
    headers: { cookie: await cookieFor(userId, workspaceId) },
    payload: { text: 'Your summary is ready.' },
  })
  assert.equal(res.statusCode, 204, 'the client shows text and plays nothing, not an error')
})
