import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import { eq } from 'drizzle-orm'
import type Anthropic from '@anthropic-ai/sdk'
import type { WorldEvent } from '@agents-world/shared'

process.env.DATABASE_URL ??= 'postgresql://test/test'
process.env.ANTHROPIC_API_KEY ??= 'test-key'
process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')
process.env.SESSION_SECRET ??= randomBytes(48).toString('base64')

const { freshDatabase, seedGoal, seedWorkspace, schema } = await import('./helpers.js')
const { EventBus } = await import('../realtime/bus.js')
const { PostgresEventStore } = await import('../realtime/store.js')
const { runGoal, resumeGoal } = await import('../runtime/orchestration.js')
const connections = await import('../tools/connections.js')

type Db = Awaited<ReturnType<typeof freshDatabase>>
let db: Db

beforeEach(async () => {
  db = await freshDatabase()
})

/**
 * A stand-in for the Anthropic client.
 *
 * The model is the one part of this loop we cannot assert on: it is
 * non-deterministic and costs money per run. Everything around it - the
 * planning, the wave grouping, the permission gate, the persistence, the
 * events the island receives - is ours, deterministic, and exactly what these
 * tests exercise.
 */
function stubClient(options: {
  plan: { interpretation: string; tasks: unknown[]; unsupported: string[] }
  /** Replies keyed by call order. A string is text; an object is a tool_use. */
  replies: (string | { toolName: string; input: Record<string, unknown> })[]
}): Anthropic {
  let callIndex = 0
  const usage = { input_tokens: 100, output_tokens: 50 }

  return {
    messages: {
      parse: async () => ({
        parsed_output: options.plan,
        stop_reason: 'end_turn',
        usage,
      }),
      create: async () => {
        const reply = options.replies[callIndex++] ?? 'Done.'
        if (typeof reply === 'string') {
          return {
            content: [{ type: 'text', text: reply }],
            stop_reason: 'end_turn',
            usage,
          }
        }
        return {
          content: [
            {
              type: 'tool_use',
              id: `call_${callIndex}`,
              name: reply.toolName,
              input: reply.input,
            },
          ],
          stop_reason: 'tool_use',
          usage,
        }
      },
    },
  } as unknown as Anthropic
}

const capture = (bus: InstanceType<typeof EventBus>, goalId: string) => {
  const events: WorldEvent[] = []
  void bus.subscribe(goalId, 0, (e) => events.push(e))
  return events
}

test('a goal runs end to end: plan, parallel wave, dependent task, summary', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(
    db,
    workspaceId,
    userId,
    'Check my mail and calendar, then summarise tomorrow',
  )

  const bus = new EventBus(new PostgresEventStore())
  const events = capture(bus, goalId)

  const client = stubClient({
    plan: {
      interpretation: 'Check mail and calendar, then combine them.',
      tasks: [
        { id: 't1', title: 'Check mail', description: 'Read unread mail', agentKey: 'hr', dependsOn: [] },
        { id: 't2', title: 'Check calendar', description: 'List tomorrow', agentKey: 'finance', dependsOn: [] },
        { id: 't3', title: 'Catch up on Slack', description: 'Read channels', agentKey: 'sales', dependsOn: ['t1', 't2'] },
      ],
      unsupported: [],
    },
    replies: ['Three unread.', 'Two meetings.', 'Nothing urgent.', 'Here is your day.'],
  })

  await runGoal({ client, bus }, { goalId, workspaceId, prompt: 'x', timezone: 'Asia/Kolkata' })

  // --- the goal finished
  const [goal] = await db.select().from(schema.goals).where(eq(schema.goals.id, goalId))
  assert.equal(goal?.state, 'completed', 'goal reached completed')
  assert.ok(goal?.summary, 'a summary was written')

  // --- every task succeeded and was persisted
  const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.goalId, goalId))
  assert.equal(tasks.length, 3)
  assert.ok(tasks.every((t) => t.state === 'succeeded'), 'all three tasks succeeded')

  // --- the two independent tasks are in wave 0, the dependent one in wave 1
  const waveOf = new Map(tasks.map((t) => [t.title, t.wave]))
  assert.equal(waveOf.get('Check mail'), 0)
  assert.equal(waveOf.get('Check calendar'), 0)
  assert.equal(waveOf.get('Catch up on Slack'), 1, 'the dependent task waits')

  // --- plan-local ids were rewritten to real ids
  const slack = tasks.find((t) => t.title === 'Catch up on Slack')
  assert.equal(slack?.dependsOn.length, 2)
  assert.ok(
    slack?.dependsOn.every((d) => tasks.some((t) => t.id === d)),
    'dependsOn holds real task ids, not plan-local ones',
  )

  // --- the island was told what happened, in order
  const types = events.map((e) => e.type)
  assert.ok(types.includes('plan.created'), 'the plan reached the client')
  assert.ok(types.includes('goal.completed'), 'and so did the result')

  const working = events.filter(
    (e) => e.type === 'agent.state_changed' && e.state === 'working',
  )
  assert.ok(working.length >= 3, 'each agent visibly started working')

  const seqs = events.map((e) => e.seq)
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'events arrived in order')

  // --- a run row exists per task, with token spend recorded
  const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.goalId, goalId))
  assert.equal(runs.length, 3)
  assert.ok(runs.every((r) => r.inputTokens > 0), 'cost is measurable per run')
})

test('an agent that tries to send email stops and waits for the user', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId, 'Reply to Priya')

  // Tools only exist when the integration is connected.
  await connections.saveConnection(workspaceId, userId, 'google', {
    accessToken: 'ya29.test',
    refreshToken: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    accountLabel: 'sam@example.com',
  })

  const bus = new EventBus(new PostgresEventStore())
  const events = capture(bus, goalId)

  const client = stubClient({
    plan: {
      interpretation: 'Reply to Priya.',
      tasks: [
        { id: 't1', title: 'Reply to Priya', description: 'Send the reply', agentKey: 'hr', dependsOn: [] },
      ],
      unsupported: [],
    },
    replies: [
      {
        toolName: 'gmail_send',
        input: { to: 'priya@example.com', subject: 'Re: Budget', body: 'Approved.' },
      },
    ],
  })

  await runGoal({ client, bus }, { goalId, workspaceId, prompt: 'x', timezone: 'UTC' })

  // --- nothing was sent
  const toolCalls = await db.select().from(schema.toolCalls)
  assert.equal(toolCalls.length, 0, 'the send never executed')

  // --- an approval is waiting, with the real content to read
  const [approval] = await db.select().from(schema.approvals).where(eq(schema.approvals.goalId, goalId))
  assert.ok(approval, 'an approval was created')
  assert.equal(approval.state, 'pending')
  assert.equal(approval.actionType, 'gmail.send')
  assert.match(approval.preview ?? '', /priya@example\.com/, 'the user sees the real recipient')
  assert.match(approval.preview ?? '', /Approved\./, 'and the real body, not a paraphrase')

  // --- the goal and the agent both reflect that they are blocked on a human
  const [goal] = await db.select().from(schema.goals).where(eq(schema.goals.id, goalId))
  assert.equal(goal?.state, 'awaiting_approval')

  const needsInput = events.filter(
    (e) => e.type === 'agent.state_changed' && e.state === 'needs_input',
  )
  assert.equal(needsInput.length, 1, 'the island shows the agent waiting on you')
  assert.ok(
    events.some((e) => e.type === 'approval.requested'),
    'and the approval prompt reached the client',
  )

  // --- the paused conversation was kept so the run can continue mid-thought
  const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.goalId, goalId))
  assert.equal(run?.state, 'needs_input')
  assert.ok(Array.isArray(run?.conversation) && run.conversation.length > 0, 'conversation persisted')
})

test('resuming is refused while any approval is still undecided', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)

  const bus = new EventBus(new PostgresEventStore())

  await db.insert(schema.plans).values({
    id: '11111111-1111-1111-1111-111111111111',
    goalId, workspaceId, interpretation: 'x', unsupported: [],
  })
  const [task] = await db.insert(schema.tasks).values({
    planId: '11111111-1111-1111-1111-111111111111',
    goalId, workspaceId, planLocalId: 't1',
    title: 'Send', description: 'Send it', agentKey: 'hr',
    dependsOn: [], wave: 0, state: 'awaiting_approval',
  }).returning({ id: schema.tasks.id })

  await db.insert(schema.approvals).values({
    taskId: task!.id, goalId, workspaceId, agentKey: 'hr',
    actionType: 'gmail.send', description: 'Send an email', state: 'pending',
  })

  const before = await db.select().from(schema.worldEvents).where(eq(schema.worldEvents.goalId, goalId))
  await resumeGoal({ client: stubClient({ plan: { interpretation: '', tasks: [], unsupported: [] }, replies: [] }), bus }, goalId)
  const after = await db.select().from(schema.worldEvents).where(eq(schema.worldEvents.goalId, goalId))

  assert.equal(after.length, before.length, 'nothing ran while an approval was outstanding')
})

test('a failed plan fails the goal with a readable reason', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)
  const bus = new EventBus(new PostgresEventStore())

  const client = stubClient({
    plan: {
      interpretation: 'Needs an agent that does not exist.',
      tasks: [
        { id: 't1', title: 'Read minds', description: 'x', agentKey: 'telepathy', dependsOn: [] },
      ],
      unsupported: [],
    },
    replies: [],
  })

  await runGoal({ client, bus }, { goalId, workspaceId, prompt: 'x', timezone: 'UTC' })

  const [goal] = await db.select().from(schema.goals).where(eq(schema.goals.id, goalId))
  assert.equal(goal?.state, 'failed')
  assert.match(goal?.error ?? '', /telepathy/, 'the reason names the invented agent')

  const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.goalId, goalId))
  assert.equal(tasks.length, 0, 'no tasks were created from an invalid plan')
})

test('approving resumes the agent mid-thought and the send actually happens', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId, 'Reply to Priya')

  await connections.saveConnection(workspaceId, userId, 'google', {
    accessToken: 'ya29.test',
    refreshToken: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    accountLabel: 'sam@example.com',
  })

  // Intercept the outbound call so the test proves the send was attempted
  // without actually mailing anyone.
  const sent: { url: string; body: string }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ id: 'sent-123' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const bus = new EventBus(new PostgresEventStore())
    const client = stubClient({
      plan: {
        interpretation: 'Reply to Priya.',
        tasks: [
          { id: 't1', title: 'Reply to Priya', description: 'Send the reply', agentKey: 'hr', dependsOn: [] },
        ],
        unsupported: [],
      },
      replies: [
        { toolName: 'gmail_send', input: { to: 'priya@example.com', subject: 'Re: Budget', body: 'Approved.' } },
        'Sent the reply to Priya.',
        'Your reply went out.',
      ],
    })

    await runGoal({ client, bus }, { goalId, workspaceId, prompt: 'x', timezone: 'UTC' })

    assert.equal(sent.length, 0, 'nothing sent while waiting for approval')

    const [approval] = await db.select().from(schema.approvals).where(eq(schema.approvals.goalId, goalId))
    assert.ok(approval)

    const { resolveApproval } = await import('../runtime/approvals.js')
    await resolveApproval({ client, bus }, {
      approvalId: approval.id,
      workspaceId,
      userId,
      decision: 'approved',
      remember: false,
    })

    // --- the send actually went out, with the content the user approved
    const send = sent.find((s) => s.url.includes('/messages/send'))
    assert.ok(send, 'the approved send executed on resume')
    const raw = JSON.parse(send.body).raw as string
    const mime = Buffer.from(raw, 'base64url').toString('utf8')
    assert.match(mime, /priya@example\.com/, 'sent to the approved recipient')
    assert.match(mime, /Approved\./, 'with the approved body')

    // --- and it was recorded as approved, not as an autonomous action
    const calls = await db.select().from(schema.toolCalls)
    const sendCall = calls.find((c) => c.toolId === 'gmail.send')
    assert.ok(sendCall, 'the send is in the audit trail')
    assert.equal(sendCall.permission, 'approved')
    assert.equal(sendCall.outcome, 'succeeded')

    // --- the goal finished
    const [goal] = await db.select().from(schema.goals).where(eq(schema.goals.id, goalId))
    assert.equal(goal?.state, 'completed')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('declining cancels the task and nothing is sent', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId, 'Reply to Priya')

  await connections.saveConnection(workspaceId, userId, 'google', {
    accessToken: 'ya29.test', refreshToken: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    accountLabel: 'sam@example.com',
  })

  const sent: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request) => {
    sent.push(String(url))
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  try {
    const bus = new EventBus(new PostgresEventStore())
    const client = stubClient({
      plan: {
        interpretation: 'Reply.',
        tasks: [{ id: 't1', title: 'Reply', description: 'Send it', agentKey: 'hr', dependsOn: [] }],
        unsupported: [],
      },
      replies: [{ toolName: 'gmail_send', input: { to: 'priya@example.com', subject: 'Re', body: 'x' } }],
    })

    await runGoal({ client, bus }, { goalId, workspaceId, prompt: 'x', timezone: 'UTC' })

    const [approval] = await db.select().from(schema.approvals).where(eq(schema.approvals.goalId, goalId))
    const { resolveApproval } = await import('../runtime/approvals.js')
    await resolveApproval({ client, bus }, {
      approvalId: approval!.id, workspaceId, userId, decision: 'rejected',
    })

    assert.ok(!sent.some((u) => u.includes('/messages/send')), 'nothing was sent')

    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.goalId, goalId))
    assert.equal(tasks[0]?.state, 'cancelled')
    assert.match(tasks[0]?.error ?? '', /declined/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('"don\'t ask again" never attaches to a deletion', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId)
  const bus = new EventBus(new PostgresEventStore())
  const workspaces = await import('../auth/workspaces.js')

  await db.insert(schema.plans).values({
    id: '22222222-2222-2222-2222-222222222222',
    goalId, workspaceId, interpretation: 'x', unsupported: [],
  })
  const [task] = await db.insert(schema.tasks).values({
    planId: '22222222-2222-2222-2222-222222222222',
    goalId, workspaceId, planLocalId: 't1', title: 'Delete', description: 'x',
    agentKey: 'finance', dependsOn: [], wave: 0, state: 'awaiting_approval',
  }).returning({ id: schema.tasks.id })

  const [approval] = await db.insert(schema.approvals).values({
    taskId: task!.id, goalId, workspaceId, agentKey: 'finance',
    actionType: 'gcal.delete_event', description: 'Delete an event', state: 'pending',
  }).returning({ id: schema.approvals.id })

  const { resolveApproval } = await import('../runtime/approvals.js')
  await resolveApproval(
    { client: stubClient({ plan: { interpretation: '', tasks: [], unsupported: [] }, replies: [] }), bus },
    { approvalId: approval!.id, workspaceId, userId, decision: 'approved', remember: true },
  )

  const workspace = await workspaces.getWorkspace(workspaceId)
  assert.deepEqual(
    workspace?.grantedActionTypes,
    [],
    'even asking to remember it, a deletion never becomes a standing grant',
  )
})
