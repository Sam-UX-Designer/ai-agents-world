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

/*
 * The two failures behind "I sent a prompt and nothing came back".
 *
 * Neither had a test, which is why both shipped. One made a brand-new
 * workspace unable to plan anything at all; the other left the reason for a
 * failure in the database while the screen showed a calm 0%.
 */

test('a workspace with nothing connected can still be given work', async () => {
  const { createPlan } = await import('../orchestrator/planner.js')

  let prompt = ''
  const client = {
    messages: {
      parse: async (body: { messages: { content: string }[] }) => {
        prompt = body.messages[0]?.content ?? ''
        return {
          parsed_output: {
            interpretation: 'Answer the question.',
            tasks: [
              { id: 't1', title: 'Answer', description: 'Explain it', agentKey: 'general', dependsOn: [] },
            ],
            unsupported: [],
          },
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }
      },
    },
  } as unknown as Anthropic

  const result = await createPlan(client, {
    goal: 'Explain what a design system is',
    connectedProviders: [],
    timezone: 'Asia/Kolkata',
  })

  // The roster used to list only agents holding a connected tool. With nothing
  // connected that is nobody, so the Orchestrator was handed an empty roster
  // and every goal came back "could not find any work to do" - including ones
  // needing no integration at all.
  assert.ok(
    prompt.includes('general - General Agent'),
    'the General Agent is offered even with no integrations connected',
  )
  assert.ok(
    !prompt.includes('No agents are available'),
    'the roster is never empty',
  )
  assert.ok(
    prompt.includes('none connected'),
    'and the Orchestrator is told which agents have no tools, rather than being misled',
  )
  assert.equal(result.ok, true, 'the plan is usable')
})

test('a goal that dies before planning tells the user why, in words', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId, 'Plan a product launch')

  const bus = new EventBus(new PostgresEventStore())
  const events = capture(bus, goalId)

  const raw =
    'Your credit balance is too low to access the Anthropic API. ' +
    'Please go to Plans & Billing to upgrade or purchase credits.'

  const client = {
    messages: {
      parse: async () => {
        throw new Error(raw)
      },
    },
  } as unknown as Anthropic

  await runGoal({ client, bus }, { goalId, workspaceId, prompt: 'x', timezone: 'UTC' })

  const [goal] = await db.select().from(schema.goals).where(eq(schema.goals.id, goalId))
  assert.equal(goal?.state, 'failed')

  const failure = events.find((e) => e.type === 'goal.state_changed' && e.state === 'failed')
  assert.ok(failure, 'the screen is told the goal failed rather than being left at 0%')

  const message = failure && 'error' in failure ? (failure.error ?? '') : ''
  assert.match(message, /credits/i, 'and told what to do about it')
  assert.ok(
    !message.includes('Plans & Billing to upgrade or purchase'),
    'in our words, not the provider\'s raw text',
  )
})

test('a goal that half worked says which half did not', async () => {
  /*
   * The dishonest case, and the reason this test exists.
   *
   * A goal fails outright only when every task in a step fails. One failure
   * out of two leaves the goal finishing normally - and the answer used to be
   * written from the successes alone, because the loader asked only for runs
   * in state 'completed'. The user read a confident reply about half their
   * request with no sign the other half never happened.
   */
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId, 'Check mail and the numbers')

  const bus = new EventBus(new PostgresEventStore())

  // What the synthesis step was actually shown.
  let synthesisPrompt = ''
  let agentTurns = 0

  const client = {
    messages: {
      parse: async () => ({
        parsed_output: {
          interpretation: 'Two independent checks.',
          tasks: [
            { id: 't1', title: 'Check mail', description: 'Read unread mail', agentKey: 'hr', dependsOn: [] },
            { id: 't2', title: 'Check the numbers', description: 'Last month spend', agentKey: 'finance', dependsOn: [] },
          ],
          unsupported: [],
        },
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      create: async (params: { system?: { text?: string }[]; messages?: { content?: unknown }[] }) => {
        const system = String(params.system?.[0]?.text ?? '')
        if (system.includes('writing the final answer')) {
          synthesisPrompt = String(params.messages?.[0]?.content ?? '')
          return {
            content: [{ type: 'text', text: 'Summary.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 100, output_tokens: 50 },
          }
        }
        // The first agent to run falls over; the second answers normally.
        agentTurns++
        if (agentTurns === 1) throw new Error('the mailbox refused the connection')
        return {
          content: [{ type: 'text', text: 'Spend was flat.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        }
      },
    },
  } as unknown as Anthropic

  await runGoal({ client, bus }, { goalId, workspaceId, prompt: 'x', timezone: 'Asia/Kolkata' })

  const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.goalId, goalId))
  const failed = tasks.filter((t) => t.state === 'failed')
  const ok = tasks.filter((t) => t.state === 'succeeded')
  assert.equal(failed.length, 1, 'one task failed')
  assert.equal(ok.length, 1, 'and one succeeded')

  const [goal] = await db.select().from(schema.goals).where(eq(schema.goals.id, goalId))
  assert.equal(goal?.state, 'completed', 'the goal still finishes on a partial success')

  // The thing that was wrong: the failure has to reach whoever writes the
  // answer, or the answer cannot mention it.
  assert.ok(
    synthesisPrompt.includes('DID NOT FINISH'),
    'the failed task is shown to the synthesis, marked as failed',
  )
  assert.ok(
    synthesisPrompt.includes(failed[0]!.title),
    'and named, so the answer can say what is missing',
  )
  assert.ok(
    synthesisPrompt.includes('Spend was flat.'),
    'alongside the result that did work',
  )
})

test('a goal where nothing worked does not ask a model to dress it up', async () => {
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId, 'Do two things')

  const bus = new EventBus(new PostgresEventStore())
  let synthesisCalls = 0

  const client = {
    messages: {
      parse: async () => ({
        parsed_output: {
          interpretation: 'Two checks.',
          tasks: [
            { id: 't1', title: 'Check mail', description: 'a', agentKey: 'hr', dependsOn: [] },
            { id: 't2', title: 'Check numbers', description: 'b', agentKey: 'finance', dependsOn: [] },
          ],
          unsupported: [],
        },
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      create: async (params: { system?: { text?: string }[] }) => {
        if (String(params.system?.[0]?.text ?? '').includes('writing the final answer')) {
          synthesisCalls++
          return {
            content: [{ type: 'text', text: 'It all went beautifully.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }
        }
        throw new Error('nothing was reachable')
      },
    },
  } as unknown as Anthropic

  await runGoal({ client, bus }, { goalId, workspaceId, prompt: 'x', timezone: 'Asia/Kolkata' })

  const [goal] = await db.select().from(schema.goals).where(eq(schema.goals.id, goalId))
  assert.equal(goal?.state, 'failed', 'a goal where every task failed is a failed goal')
  assert.equal(synthesisCalls, 0, 'and no summary is written over the top of it')
  assert.ok(
    !String(goal?.summary ?? '').includes('beautifully'),
    'the model never got the chance to be cheerful about it',
  )
})

test('the free plan allows one agent doing several things, as it advertises', async () => {
  /*
   * The Free plan's own feature list says "One agent per goal". The cap was
   * counting tasks, so a goal that gave the same agent two steps - read the
   * inbox, then check the calendar - was refused with "this goal needs more
   * than the 1 agent your plan allows". One agent. The product was selling
   * something it then declined to do, on one of the suggestion chips printed
   * on its own Home screen.
   */
  const { getBillingPlan } = await import('@agents-world/shared')
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId, 'Organize my schedule')

  const bus = new EventBus(new PostgresEventStore())
  const client = stubClient({
    plan: {
      interpretation: 'Two steps, both for Operations.',
      tasks: [
        { id: 't1', title: 'Review email', description: 'Unread mail', agentKey: 'operations', dependsOn: [] },
        { id: 't2', title: 'Check the calendar', description: 'Tomorrow', agentKey: 'operations', dependsOn: [] },
      ],
      unsupported: [],
    },
    replies: ['Three need a reply.', 'One clash at 09:00.', 'Here is your day.'],
  })

  await runGoal(
    { client, bus },
    {
      goalId,
      workspaceId,
      prompt: 'Organize my schedule',
      timezone: 'Asia/Kolkata',
      billing: getBillingPlan('free'),
    },
  )

  const [goal] = await db.select().from(schema.goals).where(eq(schema.goals.id, goalId))
  assert.equal(goal?.state, 'completed', 'one agent, two steps, on the plan that sells one agent')
})

test('a goal needing more agents than the plan allows says so in those terms', async () => {
  const { getBillingPlan } = await import('@agents-world/shared')
  const { workspaceId, userId } = await seedWorkspace(db)
  const goalId = await seedGoal(db, workspaceId, userId, 'Everything at once')

  const bus = new EventBus(new PostgresEventStore())
  const client = stubClient({
    plan: {
      interpretation: 'Two different departments.',
      tasks: [
        { id: 't1', title: 'Check mail', description: 'a', agentKey: 'operations', dependsOn: [] },
        { id: 't2', title: 'Check spend', description: 'b', agentKey: 'finance', dependsOn: [] },
      ],
      unsupported: [],
    },
    replies: [],
  })

  await runGoal(
    { client, bus },
    {
      goalId,
      workspaceId,
      prompt: 'Everything at once',
      timezone: 'Asia/Kolkata',
      billing: getBillingPlan('free'),
    },
  )

  const [goal] = await db.select().from(schema.goals).where(eq(schema.goals.id, goalId))
  assert.equal(goal?.state, 'failed')
  assert.match(
    goal?.error ?? '',
    /needs 2 agents and your plan allows 1/,
    'the refusal counts the thing it names',
  )
})
