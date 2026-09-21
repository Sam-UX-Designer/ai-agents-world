/**
 * Live demo server - run the whole product with no API keys and no Postgres.
 *
 *   pnpm --filter @agents-world/api demo
 *   # then, in another terminal:
 *   API_URL=http://localhost:4000 pnpm --filter @agents-world/web dev
 *   # open the printed COOKIE in devtools > Application > Cookies
 *
 *
 * Runs the REAL application - real Postgres (in-process via PGlite), real
 * orchestration loop, real permission gate, real event bus, real WebSocket.
 * The only stand-in is the Claude client, because there is no API key on this
 * machine yet.
 *
 * That means everything this exercises is production code: the plan is
 * validated and persisted, waves dispatch in parallel, events are sequenced
 * and stored, and the browser gets them over a real socket.
 */
import { randomBytes } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'

process.env.DATABASE_URL ??= 'postgresql://demo/demo'
process.env.ANTHROPIC_API_KEY ??= 'demo-no-key'
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')
process.env.SESSION_SECRET ??= randomBytes(48).toString('base64')
process.env.APP_URL ??= 'http://localhost:3000'
process.env.PORT ??= '4000'

const { freshDatabase, seedWorkspace } = await import('../src/__tests__/helpers.js')
const { buildApp } = await import('../src/main.js')
const { EventBus } = await import('../src/realtime/bus.js')
const { PostgresEventStore } = await import('../src/realtime/store.js')
const { issueSession, SESSION_COOKIE } = await import('../src/auth/sessions.js')
const { saveConnection } = await import('../src/tools/connections.js')
const { schema } = await import('../src/db/client.js')
const { eq } = await import('drizzle-orm')

const db = await freshDatabase()
const { workspaceId, userId } = await seedWorkspace(db)

// Connect Google and Slack so agents actually have tools available.
for (const provider of ['google', 'slack'] as const) {
  await saveConnection(workspaceId, userId, provider, {
    accessToken: 'demo-token',
    refreshToken: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'channels:read', 'channels:history', 'chat:write', 'users:read',
    ],
    accountLabel: provider === 'google' ? 'sam@example.com' : 'Acme',
  })
}

const { token } = await issueSession({ userId, workspaceId })

/**
 * Stand-in for Claude.
 *
 * Plans a realistic multi-agent breakdown and has each agent do a little tool
 * work before answering, so the island shows genuine parallel activity rather
 * than agents that flip straight to done.
 */
let planCall = 0

/**
 * Which agents a prompt should reach.
 *
 * The real Orchestrator decides this with Claude. This stub matches on a few
 * words instead, for one reason: the demo has to show the actual product
 * behaviour, which is that a goal goes to the agents it needs and to no
 * others. A stub that always returned the same five tasks would teach anyone
 * watching exactly the wrong thing.
 */
const planFor = (prompt: string) => {
  const p = prompt.toLowerCase()
  const has = (...words: string[]) => words.some((w) => p.includes(w))

  if (has('design', 'ui', 'ux', 'brand', 'logo')) {
    return {
      interpretation: 'Produce the design work described, and say what it is based on.',
      tasks: [
        { id: 't1', title: 'Design the system', description: 'Produce the design described and explain the decisions.', agentKey: 'design', dependsOn: [] },
      ],
    }
  }

  if (has('campaign', 'marketing', 'launch', 'audience', 'positioning')) {
    return {
      interpretation: 'Pull together what we know, then turn it into a campaign brief.',
      tasks: [
        { id: 't1', title: 'Catch up on Slack', description: 'Read the main channels and find customer feedback.', agentKey: 'sales', dependsOn: [] },
        { id: 't2', title: 'Draft the campaign brief', description: 'Combine the findings into a marketing campaign brief.', agentKey: 'marketing', dependsOn: ['t1'] },
      ],
    }
  }

  if (has('schedule', 'calendar', 'meeting', 'email', 'inbox')) {
    return {
      interpretation: 'Review the inbox and the calendar, and flag what needs attention.',
      tasks: [
        { id: 't1', title: 'Review this week\u2019s email', description: 'Read unread mail from the last 7 days and pull out what needs action.', agentKey: 'operations', dependsOn: [] },
        { id: 't2', title: 'Check the calendar', description: 'List tomorrow\u2019s meetings and flag any clashes.', agentKey: 'operations', dependsOn: [] },
      ],
    }
  }

  if (has('revenue', 'spend', 'budget', 'cost', 'financ', 'insight', 'users', 'analytics')) {
    return {
      interpretation: 'Find what the numbers and the conversations say about our users.',
      tasks: [
        { id: 't1', title: 'Catch up on Slack', description: 'Read the main channels and find customer feedback.', agentKey: 'sales', dependsOn: [] },
        { id: 't2', title: 'Analyse the numbers', description: 'Summarise spend and revenue signals from the last month.', agentKey: 'finance', dependsOn: [] },
      ],
    }
  }

  // Anything else is one task for the General Agent, which is the common case.
  return {
    interpretation: 'Answer this directly - no specialist needed.',
    tasks: [
      { id: 't1', title: 'Answer the question', description: prompt, agentKey: 'general', dependsOn: [] },
    ],
  }
}

const stub = {
  messages: {
    parse: async (params: { messages?: { content?: unknown }[] }) => {
      // Real planning on claude-opus-5 takes several seconds. Without that
      // delay the whole run finishes before a browser can paint a frame, and
      // the island looks like it did nothing.
      await new Promise((r) => setTimeout(r, 2500))
      planCall++

      /*
       * Only the goal, not the whole prompt.
       *
       * buildUserPrompt wraps the goal in triple quotes and surrounds it with
       * the agent roster - which names every department. Matching against the
       * whole blob sent "how should I think about pricing?" to the Design
       * Agent, because the roster contains the word "design".
       */
      const content = String((params.messages ?? [])[0]?.content ?? '')
      const goal = content.match(/\"\"\"\n([\s\S]*?)\n\"\"\"/)?.[1] ?? content

      // A goal starting "fail:" makes the provider throw, so the failure
      // screen can be looked at without emptying a real account of credits.
      // Demo script only - the server `pnpm dev` builds has none of this.
      if (/^fail:/i.test(goal.trim())) {
        throw new Error(
          'Your credit balance is too low to access the Anthropic API. ' +
            'Please go to Plans & Billing to upgrade or purchase credits.',
        )
      }

      const plan = planFor(goal)

      return {
        parsed_output: { ...plan, unsupported: [] },
        stop_reason: 'end_turn',
        usage: { input_tokens: 1200, output_tokens: 340 },
      }
    },
    create: async (params: { messages?: unknown[]; tools?: { name: string }[] }) => {
      // Each agent turn costs real time too. 3s is conservative - a real
      // agent turn with a tool call is usually 5-15s.
      await new Promise((r) => setTimeout(r, 3000))
      const usage = { input_tokens: 800, output_tokens: 180 }
      const turns = (params.messages ?? []).length
      const tools = params.tools ?? []

      // First turn with a toolbelt: call a real tool, so the island shows a
      // tool.called event and the agent stays visibly busy for a beat.
      if (tools.length > 0 && turns <= 1) {
        const tool = tools.find((t) => /search|list|read/.test(t.name)) ?? tools[0]
        const input: Record<string, unknown> =
          tool!.name === 'gmail_search' ? { query: 'is:unread newer_than:7d' }
          : tool!.name === 'gcal_list_events' ? { timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + 86400000).toISOString() }
          : tool!.name === 'slack_list_channels' ? {}
          : {}
        return {
          content: [{ type: 'tool_use', id: `call_${Date.now()}`, name: tool!.name, input }],
          stop_reason: 'tool_use',
          usage,
        }
      }

      return {
        content: [{ type: 'text', text: 'Done. Findings below.\n- Three items need a reply.\n- Tomorrow has a clash at 09:00.' }],
        stop_reason: 'end_turn',
        usage,
      }
    },
  },
} as unknown as Anthropic

const app = await buildApp(stub, new EventBus(new PostgresEventStore()))

/**
 * Demo sign-in.
 *
 * Google OAuth needs credentials and a registered redirect URI, neither of
 * which exist on a laptop. This hands the browser the same session cookie the
 * real callback would set - same name, same flags, same session table - so
 * everything downstream is the production path. Opening one URL replaces
 * pasting a cookie into devtools by hand.
 *
 * It exists only in this script. The server built by `pnpm dev` has no such
 * route.
 */
app.get('/demo/login', async (_request, reply) =>
  reply
    .setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      expires: new Date(Date.now() + 7 * 86_400_000),
    })
    .redirect(`${process.env.APP_URL}/world`),
)

/**
 * Refill the demo wallet.
 *
 * The end-to-end suite spends credits doing its job, and one spec deliberately
 * spends the lot to prove the gate refuses a goal. Without a way back, every
 * test after that one fails for want of credit rather than for want of
 * correctness - and a suite whose result depends on the order its files
 * happen to run in is not a launch gate.
 *
 * Demo script only, like /demo/login. The server `pnpm dev` builds has no such
 * route, and neither does production.
 */
app.post('/demo/credits', async (request, reply) => {
  const { balanceOf, grantCredits } = await import('../src/billing/wallet.js')
  const before = await balanceOf(workspaceId)

  /*
   * Set the plan, defaulting back to free.
   *
   * The free plan allows one agent per goal, so a spec that needs two agents
   * actually working has no way to get there without asking for a bigger one.
   * Resetting to free when no plan is named matters just as much: there is
   * one demo workspace, so an upgrade left in place turns every later spec
   * into a test of a plan it did not choose.
   */
  const plan = (request.query as { plan?: string } | undefined)?.plan ?? 'free'
  await db.update(schema.wallets).set({ plan }).where(eq(schema.wallets.workspaceId, workspaceId))

  // Reset the daily allowance too - it is the free plan's whole balance, and
  // a top-up of paid credits would not restore it.
  await db
    .update(schema.wallets)
    .set({ dailyUsed: 0, dailyResetAt: new Date(Date.now() + 86_400_000) })
    .where(eq(schema.wallets.workspaceId, workspaceId))

  await grantCredits(workspaceId, 25, 'adjustment', 'e2e top-up')
  return reply.send({ before: before.total, after: (await balanceOf(workspaceId)).total, plan })
})

await app.listen({ port: Number(process.env.PORT), host: '0.0.0.0' })

console.log('DEMO_READY')
console.log(`COOKIE=${SESSION_COOKIE}=${token}`)
console.log(`WORKSPACE=${workspaceId}`)
console.log(`PLANS=${planCall}`)
