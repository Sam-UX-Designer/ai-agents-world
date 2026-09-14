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
const stub = {
  messages: {
    parse: async () => {
      // Real planning on claude-opus-5 takes several seconds. Without that
      // delay the whole run finishes before a browser can paint a frame, and
      // the island looks like it did nothing.
      await new Promise((r) => setTimeout(r, 2500))
      planCall++
      return {
        parsed_output: {
          interpretation:
            'Pull together what happened this week across mail, calendar and Slack, then turn it into a campaign brief.',
          tasks: [
            { id: 't1', title: 'Review this week’s email', description: 'Read unread mail from the last 7 days and pull out what needs action.', agentKey: 'operations', dependsOn: [] },
            { id: 't2', title: 'Check the calendar', description: 'List tomorrow’s meetings and flag any clashes.', agentKey: 'operations', dependsOn: [] },
            { id: 't3', title: 'Catch up on Slack', description: 'Read the main channels and find customer feedback.', agentKey: 'sales', dependsOn: [] },
            { id: 't4', title: 'Analyse the numbers', description: 'Summarise spend and revenue signals from the last month.', agentKey: 'finance', dependsOn: [] },
            { id: 't5', title: 'Draft the campaign brief', description: 'Combine the findings into a marketing campaign brief.', agentKey: 'marketing', dependsOn: ['t1', 't2', 't3', 't4'] },
          ],
          unsupported: [],
        },
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
await app.listen({ port: 4000, host: '0.0.0.0' })

console.log('DEMO_READY')
console.log(`COOKIE=${SESSION_COOKIE}=${token}`)
console.log(`WORKSPACE=${workspaceId}`)
console.log(`PLANS=${planCall}`)
