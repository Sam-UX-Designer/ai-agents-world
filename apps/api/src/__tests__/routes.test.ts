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
const { schema: schemaFor } = await import('../db/client.js')
const { eq: eqFor } = await import('drizzle-orm')

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
    zone: { position: number[]; station: number[] }
    tools: { id: string }[]
  }[]

  const keys = agents.map((a) => a.key).sort()
  assert.deepEqual(
    keys,
    ['design', 'development', 'finance', 'general', 'hr', 'marketing', 'operations', 'orchestrator', 'sales'],
    'one agent per department, not one per tool',
  )

  const orchestrator = agents.find((a) => a.key === 'orchestrator')
  assert.deepEqual(orchestrator?.zone.position, [0, 0, 0], 'the hub sits at the island centre')

  // The point of the shared catalogue: one tool, reachable by several roles.
  const senders = agents.filter((a) => a.tools.some((t) => t.id === 'gmail.send'))
  assert.ok(senders.length > 1, 'gmail.send is shared across departments, not owned by one agent')

  // Every agent is anchored to a workstation in the artwork.
  assert.ok(
    agents.every((a) => a.zone.station.length === 2),
    'every agent is anchored to a workstation in the artwork',
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
  for (const url of ['/connections', '/goals', '/approvals', '/integrations', '/history', '/usage', '/agents/instructions']) {
    const res = await app.inject({ method: 'GET', url })
    assert.equal(res.statusCode, 401, `${url} must require a session`)
  }

  const post = await app.inject({ method: 'POST', url: '/goals', payload: { prompt: 'do a thing' } })
  assert.equal(post.statusCode, 401)
})

/**
 * The integration catalogue is what the Tools screen renders, and everything
 * on that screen is a claim about what the product will actually do. These
 * pin the two claims that would be lies if they drifted.
 */
test('the integration catalogue reports permissions the runtime will honour', async () => {
  const { userId, workspaceId } = await seedWorkspace(db)
  const res = await app.inject({
    method: 'GET',
    url: '/integrations',
    headers: { cookie: await cookieFor(userId, workspaceId) },
  })
  assert.equal(res.statusCode, 200)

  const list = res.json() as {
    id: string
    status: string
    connection: unknown
    permissions: { toolId: string; kind: string }[]
    agents: { agentKey: string; level: string }[]
  }[]

  const gmail = list.find((i) => i.id === 'gmail')
  assert.ok(gmail, 'Gmail is in the catalogue')
  assert.equal(gmail.status, 'available', 'Google is configured in this test env')

  // Sending mail is irreversible and reaches a third party, so the screen must
  // never show it as something an agent does quietly.
  const send = gmail.permissions.find((p) => p.toolId === 'gmail.send')
  assert.equal(send?.kind, 'approval', 'sending mail always asks the user first')

  const search = gmail.permissions.find((p) => p.toolId === 'gmail.search')
  assert.equal(search?.kind, 'read', 'searching the mailbox is autonomous')

  assert.ok(gmail.agents.length > 0, 'the panel can name who uses this')
})

test('an integration with nothing built behind it never reports itself connected', async () => {
  const { userId, workspaceId } = await seedWorkspace(db)
  const { saveConnection } = await import('../tools/connections.js')

  // One Google grant covers Gmail, Calendar and Drive. Only the first two are
  // built, so Drive must not inherit the appearance of working.
  await saveConnection(workspaceId, userId, 'google', {
    accessToken: 'token',
    refreshToken: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    accountLabel: 'someone@example.com',
  })

  const res = await app.inject({
    method: 'GET',
    url: '/integrations',
    headers: { cookie: await cookieFor(userId, workspaceId) },
  })
  const list = res.json() as { id: string; connection: unknown }[]

  assert.ok(list.find((i) => i.id === 'gmail')?.connection, 'Gmail is genuinely connected')
  assert.equal(
    list.find((i) => i.id === 'google-drive')?.connection,
    null,
    'Drive is not built, so it cannot claim a sibling\'s connection',
  )
})

/**
 * Sign-in.
 *
 * The first of these is the regression that mattered: the sign-in state row
 * used to be written with a nil UUID in user_id, which has a foreign key to
 * `users`. Postgres refused the insert, so every Google sign-in died on the
 * first query - and the raw SQL, parameters included, was sent to the browser
 * as the error message. Nothing covered this route, which is why it shipped.
 */
test('starting a Google sign-in stores state without an account', async () => {
  const res = await app.inject({ method: 'GET', url: '/auth/google/signin' })

  assert.equal(res.statusCode, 200, res.body)
  const { url } = res.json() as { url: string }
  assert.ok(url.startsWith('https://accounts.google.com/'), 'sends the user to Google')

  const state = new URL(url).searchParams.get('state')
  assert.ok(state, 'a state parameter is issued')

  const [row] = await db
    .select()
    .from(schemaFor.oauthStates)
    .where(eqFor(schemaFor.oauthStates.state, state))

  assert.ok(row, 'the state row exists')
  assert.equal(row.userId, null, 'no account exists yet, so no user is claimed')
  assert.equal(row.workspaceId, null)
  assert.equal(row.provider, 'signin:google')
})

test('a failed sign-in never returns the underlying error to the browser', async () => {
  // Apple has no credentials in this environment, which is the one cause a
  // person can act on - so it is named, and nothing else leaks.
  const res = await app.inject({ method: 'GET', url: '/auth/apple/signin' })

  const body = res.json() as { error?: string }
  assert.ok(body.error, 'an error is reported')
  assert.match(body.error, /not set up|not configured/i)
  assert.doesNotMatch(body.error, /insert into|select |params:|oauth_states/i,
    'no SQL, table names or parameters reach the client')
})

test('registering with an email and password signs the person straight in', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Sam Jo', email: 'Sam@Example.com', password: 'a-good-password', phone: '+91 90000 00000' },
  })

  assert.equal(res.statusCode, 200, res.body)
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)
  assert.ok(cookie, 'a session cookie is set')
  assert.equal(cookie.httpOnly, true, 'not readable from JavaScript')

  // That session works on a real route.
  const me = await app.inject({
    method: 'GET',
    url: '/me',
    headers: { cookie: `${SESSION_COOKIE}=${cookie.value}` },
  })
  assert.equal(me.statusCode, 200)
  const who = me.json() as { user: { email: string; name: string | null }; workspace: unknown }
  assert.equal(who.user.email, 'sam@example.com', 'email is normalised to lowercase')
  assert.equal(who.user.name, 'Sam Jo')
  assert.ok(who.workspace, 'and they have a workspace to land in')
})

test('a short password is refused before any account is made', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Sam', email: 'short@example.com', password: 'abc' },
  })
  assert.equal(res.statusCode, 400)

  const retry = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'short@example.com', password: 'abc' },
  })
  assert.equal(retry.statusCode, 401, 'nothing was created')
})

test('logging in works, and a wrong password is refused without saying why', async () => {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Sam', email: 'login@example.com', password: 'a-good-password' },
  })

  const ok = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'login@example.com', password: 'a-good-password' },
  })
  assert.equal(ok.statusCode, 200)
  assert.ok(ok.cookies.find((c) => c.name === SESSION_COOKIE))

  const bad = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'login@example.com', password: 'the-wrong-password' },
  })
  const unknown = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'nobody@example.com', password: 'the-wrong-password' },
  })

  assert.equal(bad.statusCode, 401)
  assert.equal(unknown.statusCode, 401)
  assert.deepEqual(
    bad.json(),
    unknown.json(),
    'a wrong password and an unknown address are indistinguishable',
  )
})

test('the same email cannot register twice', async () => {
  const payload = { name: 'Sam', email: 'dupe@example.com', password: 'a-good-password' }
  await app.inject({ method: 'POST', url: '/auth/register', payload })
  const second = await app.inject({ method: 'POST', url: '/auth/register', payload })
  assert.equal(second.statusCode, 409)
})

/**
 * History.
 *
 * The screen's whole job is to be the record, so the test that matters is
 * that a goal still running reports no duration rather than a made-up one.
 */
test('history reports a real duration, and none for a goal still running', async () => {
  const { userId, workspaceId } = await seedWorkspace(db)
  const cookie = await cookieFor(userId, workspaceId)

  // Finishes immediately here - the Claude client is stubbed - so this is the
  // completed case.
  const created = await app.inject({
    method: 'POST',
    url: '/goals',
    headers: { cookie },
    payload: { prompt: 'Summarise last week', timezone: 'UTC' },
  })
  // 202: accepted and run in the background, which is why closing the tab is
  // harmless.
  assert.equal(created.statusCode, 202, created.body)

  // And one that has not finished, written directly so it stays that way.
  await db.insert(schemaFor.goals).values({
    workspaceId,
    userId,
    prompt: 'Still going',
    state: 'executing',
  })

  const res = await app.inject({ method: 'GET', url: '/history', headers: { cookie } })
  assert.equal(res.statusCode, 200)

  const list = res.json() as {
    prompt: string
    durationMs: number | null
    agentKeys: string[]
    toolIds: string[]
    artifacts: unknown[]
  }[]

  const running = list.find((e) => e.prompt === 'Still going')
  assert.ok(running, 'the running goal is listed')
  assert.equal(running.durationMs, null, 'an unfinished goal has no duration invented for it')

  const done = list.find((e) => e.prompt === 'Summarise last week')
  assert.ok(done, 'the finished goal is listed')
  assert.ok(
    typeof done.durationMs === 'number' && done.durationMs >= 0,
    'a finished goal reports the time it actually took',
  )
  assert.ok(Array.isArray(done.agentKeys))
  assert.ok(Array.isArray(done.toolIds))
  assert.ok(Array.isArray(done.artifacts))
})

test('history never returns another workspace\'s goals', async () => {
  const mine = await seedWorkspace(db)
  const theirs = await seedWorkspace(db)

  await app.inject({
    method: 'POST',
    url: '/goals',
    headers: { cookie: await cookieFor(theirs.userId, theirs.workspaceId) },
    payload: { prompt: 'Their private goal', timezone: 'UTC' },
  })

  const res = await app.inject({
    method: 'GET',
    url: '/history',
    headers: { cookie: await cookieFor(mine.userId, mine.workspaceId) },
  })

  const list = res.json() as { prompt: string }[]
  assert.ok(
    !list.some((e) => e.prompt === 'Their private goal'),
    'the tenant boundary holds on this route too',
  )
})

/**
 * Agent instructions.
 *
 * The one that matters is the last: an instruction the user saves has to
 * actually reach the model, or the feature is a text box that does nothing.
 */
test('agent instructions save, come back, and clear when emptied', async () => {
  const { userId, workspaceId } = await seedWorkspace(db)
  const cookie = await cookieFor(userId, workspaceId)

  const empty = await app.inject({ method: 'GET', url: '/agents/instructions', headers: { cookie } })
  assert.deepEqual(empty.json(), {}, 'nothing saved to begin with')

  const saved = await app.inject({
    method: 'PUT',
    url: '/agents/finance/instructions',
    headers: { cookie },
    payload: { instructions: 'Our quarter ends in March.' },
  })
  assert.equal(saved.statusCode, 200, saved.body)

  const after = await app.inject({ method: 'GET', url: '/agents/instructions', headers: { cookie } })
  assert.deepEqual(after.json(), { finance: 'Our quarter ends in March.' })

  await app.inject({
    method: 'PUT',
    url: '/agents/finance/instructions',
    headers: { cookie },
    payload: { instructions: '   ' },
  })
  const cleared = await app.inject({ method: 'GET', url: '/agents/instructions', headers: { cookie } })
  assert.deepEqual(cleared.json(), {}, 'emptying removes the row rather than storing blanks')
})

test('instructions cannot be saved for an agent that does not exist', async () => {
  const { userId, workspaceId } = await seedWorkspace(db)
  const res = await app.inject({
    method: 'PUT',
    url: '/agents/not-a-real-agent/instructions',
    headers: { cookie: await cookieFor(userId, workspaceId) },
    payload: { instructions: 'anything' },
  })
  assert.equal(res.statusCode, 404, 'a typo would otherwise write a row no run ever reads')
})

test("one workspace's agent instructions never reach another", async () => {
  const mine = await seedWorkspace(db)
  const theirs = await seedWorkspace(db)

  await app.inject({
    method: 'PUT',
    url: '/agents/finance/instructions',
    headers: { cookie: await cookieFor(theirs.userId, theirs.workspaceId) },
    payload: { instructions: 'Their private policy' },
  })

  const res = await app.inject({
    method: 'GET',
    url: '/agents/instructions',
    headers: { cookie: await cookieFor(mine.userId, mine.workspaceId) },
  })
  assert.deepEqual(res.json(), {})
})

test('usage counts real token spend, never an estimate', async () => {
  const { userId, workspaceId } = await seedWorkspace(db)
  const cookie = await cookieFor(userId, workspaceId)

  const before = await app.inject({ method: 'GET', url: '/usage', headers: { cookie } })
  assert.equal(before.statusCode, 200)
  const fresh = before.json() as { creditsUsed: number; goalsRun: number; agentMinutes: number }
  assert.equal(fresh.creditsUsed, 0, 'a workspace that has done nothing has used nothing')
  assert.equal(fresh.goalsRun, 0)

  await app.inject({
    method: 'POST',
    url: '/goals',
    headers: { cookie },
    payload: { prompt: 'Do a thing', timezone: 'UTC' },
  })

  const after = await app.inject({ method: 'GET', url: '/usage', headers: { cookie } })
  const used = after.json() as { goalsRun: number; tokensPerCredit: number }
  assert.equal(used.goalsRun, 1, 'the goal just run is counted')
  assert.equal(used.tokensPerCredit, 1000, 'the conversion is stated, not left to the client')
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

/*
 * The gate at the HTTP edge.
 *
 * The wallet tests prove the arithmetic; these prove the arithmetic is
 * actually consulted before a goal runs. A limit that the route forgets to
 * call is not a limit.
 */

test('a goal is refused once the allowance is gone, before any model call', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const cookie = await cookieFor(userId, workspaceId)
  const { getBillingPlan } = await import('@agents-world/shared')
  const perDay = getBillingPlan('free').goalsPerDay!

  /*
   * A plan that actually succeeds.
   *
   * The shared stub returns an empty task list, which fails the goal - and a
   * failed goal is refunded, so the allowance never ran out and this test
   * quietly passed five goals through forever. Metering can only be observed
   * on runs that complete.
   */
  let planCalls = 0
  const counting = {
    messages: {
      parse: async () => {
        planCalls++
        return {
          parsed_output: {
            interpretation: 'Answer it.',
            tasks: [
              {
                id: 't1',
                title: 'Answer',
                description: 'Answer the question',
                agentKey: 'general',
                dependsOn: [],
              },
            ],
            unsupported: [],
          },
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }
      },
      create: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  } as unknown as Anthropic

  const metered = await buildApp(counting, new EventBus(new PostgresEventStore()))
  await metered.ready()

  const submit = () =>
    metered.inject({
      method: 'POST',
      url: '/goals',
      headers: { cookie },
      payload: { prompt: 'Plan a launch', timezone: 'UTC' },
    })

  for (let i = 0; i < perDay; i++) {
    assert.equal((await submit()).statusCode, 202, `goal ${i + 1} is accepted`)
    // runGoal is fired, not awaited. Let it settle so a late failure cannot
    // refund a credit after the next submission has already read the balance.
    await new Promise((r) => setTimeout(r, 60))
  }

  const callsBefore = planCalls
  const refused = await submit()

  assert.equal(refused.statusCode, 402, 'the next one is refused with "payment required"')
  const body = refused.json() as { error: string; upgrade?: boolean }
  assert.match(body.error, /free goals/i, 'and says what ran out, in words')
  assert.equal(body.upgrade, true, 'and tells the client there is a way forward')
  assert.equal(planCalls, callsBefore, 'no model call was made for the refused goal')

  // Recorded rather than silently dropped, so History can show the user they
  // asked and why nothing happened.
  const goals = await db
    .select()
    .from(schemaFor.goals)
    .where(eqFor(schemaFor.goals.workspaceId, workspaceId))
  const failed = goals.filter((g) => g.state === 'failed')
  assert.equal(failed.length, 1)
  assert.match(failed[0]?.error ?? '', /free goals/i)

  await metered.close()
})

test('the billing route reports the plan and what is left', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const cookie = await cookieFor(userId, workspaceId)

  const response = await app.inject({ method: 'GET', url: '/billing', headers: { cookie } })
  assert.equal(response.statusCode, 200)

  const body = response.json() as {
    plan: { key: string; name: string; maxAgents: number }
    freeLeft: number
    credits: number
    total: number
    ledger: unknown[]
  }

  assert.equal(body.plan.key, 'free')
  // The whole plan comes back, so the client never keeps its own copy of what
  // a plan includes and the two can never disagree.
  assert.ok(body.plan.maxAgents >= 1)
  assert.equal(body.freeLeft, body.total)
  assert.ok(Array.isArray(body.ledger))
})
