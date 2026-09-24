import type Anthropic from '@anthropic-ai/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import {
  ORCHESTRATOR,
  executionWaves,
  getAgent,
  getBillingPlan,
  isTaskTerminal,
  type AgentState,
  type BillingPlan,
  type PlannedTask,
  type TaskState,
} from '@agents-world/shared'
import { getInstructions, listAgentNames } from '../agents/overrides.js'
import { refundGoal } from '../billing/wallet.js'
import { getWorkspace } from '../auth/workspaces.js'
import { db, schema } from '../db/client.js'
import { createPlan } from '../orchestrator/planner.js'
import { synthesise } from '../orchestrator/synthesis.js'
import { connectedProviders } from '../tools/connections.js'
import type { EventBus } from '../realtime/bus.js'
import { executeTask, type RunOutcome } from './executor.js'
import { explainFailure } from './failures.js'
import { buildToolbelt } from './toolbelt.js'

/**
 * The orchestration loop: a goal from submission to final answer.
 *
 * Everything the island shows originates here. Each state change is emitted
 * before the work it describes begins, so a robot stands up as its agent
 * starts rather than after it finishes - the world stays a live view, not a
 * replay running one beat behind.
 *
 * The loop is written to be resumable at every boundary. It persists a run's
 * conversation when it pauses for approval, so `resumeGoal` continues
 * mid-thought instead of restarting a task the user has already paid for.
 */

export interface OrchestrationDeps {
  readonly client: Anthropic
  readonly bus: EventBus
}

export interface RunGoalInput {
  readonly goalId: string
  readonly workspaceId: string
  readonly prompt: string
  readonly timezone: string
  readonly attachedFilenames?: readonly string[]
  /**
   * The workspace's billing plan, which decides the model, the effort and how
   * many agents this goal may use. Passed in rather than looked up here so
   * the same plan governs the whole run - a plan change mid-goal must not
   * silently upgrade the model between two waves the user paid one credit for.
   */
  readonly billing?: BillingPlan
}

/** Plan a goal, then execute it. */
export async function runGoal(
  deps: OrchestrationDeps,
  input: RunGoalInput,
): Promise<void> {
  const { bus } = deps
  const base = { goalId: input.goalId, workspaceId: input.workspaceId }

  try {
    await bus.emit({ ...base, type: 'goal.state_changed', state: 'planning', error: null })
    await setGoalState(input.goalId, 'planning')
    await emitAgentState(bus, base, ORCHESTRATOR.key, null, 'planning', 'Reading your goal')

    const plan = input.billing ?? getBillingPlan('pro')
    const providers = await connectedProviders(input.workspaceId)
    const planResult = await createPlan(deps.client, {
      goal: input.prompt,
      connectedProviders: providers,
      timezone: input.timezone,
      model: plan.model,
      effort: plan.effort,
      maxAgents: plan.maxAgents,
      agentNames: await listAgentNames(input.workspaceId),
      ...(input.attachedFilenames ? { attachedFiles: input.attachedFilenames } : {}),
    })

    if (!planResult.ok) {
      await failGoal(deps, base, planResult.reason)
      return
    }

    const { planId, taskIds } = await persistPlan(input, planResult.plan)

    await bus.emit({
      ...base,
      type: 'plan.created',
      planId,
      interpretation: planResult.plan.interpretation,
      tasks: planResult.plan.tasks.map((t) => ({
        taskId: taskIds.get(t.id) ?? t.id,
        title: t.title,
        agentKey: t.agentKey,
        dependsOn: t.dependsOn.map((d) => taskIds.get(d) ?? d),
      })),
    })

    await emitAgentState(
      bus,
      base,
      ORCHESTRATOR.key,
      null,
      'waiting',
      planResult.plan.tasks.length === 1
        ? 'Coordinating 1 task'
        : `Coordinating ${planResult.plan.tasks.length} tasks`,
    )

    await executePlan(deps, input, planResult.waves, taskIds)
  } catch (err) {
    // The raw text goes to the log; the screen gets a sentence.
    console.error('[orchestration] goal failed', base.goalId, err)
    await failGoal(deps, base, explainFailure(err).message)
  }
}

/** Resume a goal after every approval on it has been decided. */
export async function resumeGoal(
  deps: OrchestrationDeps,
  goalId: string,
): Promise<void> {
  const [goal] = await db()
    .select()
    .from(schema.goals)
    .where(eq(schema.goals.id, goalId))
    .limit(1)

  if (!goal) throw new Error(`Unknown goal ${goalId}`)

  const stillPending = await db()
    .select({ id: schema.approvals.id })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.goalId, goalId), eq(schema.approvals.state, 'pending')))
    .limit(1)

  // Several tasks in one wave can each be waiting. Resuming while any remains
  // undecided would restart the goal with half its answers still missing.
  if (stillPending.length > 0) return

  const rows = await db()
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.goalId, goalId))

  const planned: PlannedTask[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    agentKey: t.agentKey,
    dependsOn: t.dependsOn,
  }))

  const identity = new Map(planned.map((t) => [t.id, t.id]))

  // The plan the workspace is on now, not whatever it was on when the goal
  // started. A resume can be days after the pause, and running the rest of
  // the goal on a model the workspace no longer pays for is the wrong error
  // in either direction.
  const [wallet] = await db()
    .select({ plan: schema.wallets.plan })
    .from(schema.wallets)
    .where(eq(schema.wallets.workspaceId, goal.workspaceId))
    .limit(1)

  await executePlan(
    deps,
    {
      goalId,
      workspaceId: goal.workspaceId,
      prompt: goal.prompt,
      timezone: 'UTC',
      billing: getBillingPlan(wallet?.plan),
    },
    executionWaves(planned),
    identity,
  )
}

/**
 * Run the plan wave by wave.
 *
 * Within a wave every task starts at once - that is the whole point of the
 * wave grouping, and it is what lights several robots on the island
 * simultaneously. Between waves we stop, because a later wave's inputs are
 * the earlier one's outputs.
 */
async function executePlan(
  deps: OrchestrationDeps,
  input: RunGoalInput,
  waves: readonly (readonly PlannedTask[])[],
  taskIds: ReadonlyMap<string, string>,
): Promise<void> {
  const { bus } = deps
  const base = { goalId: input.goalId, workspaceId: input.workspaceId }

  await bus.emit({ ...base, type: 'goal.state_changed', state: 'executing', error: null })
  await setGoalState(input.goalId, 'executing')

  for (const wave of waves) {
    const outcomes = await Promise.all(
      wave.map((task) => runTask(deps, input, task, taskIds)),
    )

    if (outcomes.some((o) => o === 'awaiting_approval')) {
      await bus.emit({
        ...base,
        type: 'goal.state_changed',
        state: 'awaiting_approval',
        error: null,
      })
      await setGoalState(input.goalId, 'awaiting_approval')
      return
    }

    // A dependent wave cannot run on a missing input. Stopping here beats
    // handing the next agent a hole and letting it invent a filling.
    if (outcomes.every((o) => o === 'failed')) {
      await failGoal(deps, base, 'Every task in this step failed. See the agent details.')
      return
    }
  }

  await finishGoal(deps, input)
}

type TaskOutcome = 'succeeded' | 'failed' | 'awaiting_approval'

/** One task, as it ended, for the answer to be written from. */
interface TaskOutcomeRecord {
  readonly title: string
  readonly agentKey: string
  readonly state: 'succeeded' | 'failed' | 'cancelled'
  readonly result: string
  readonly error: string | null
}

/** Run one task with one agent, reporting state the whole way. */
async function runTask(
  deps: OrchestrationDeps,
  input: RunGoalInput,
  task: PlannedTask,
  taskIds: ReadonlyMap<string, string>,
): Promise<TaskOutcome> {
  const { bus } = deps
  const base = { goalId: input.goalId, workspaceId: input.workspaceId }
  const taskId = taskIds.get(task.id) ?? task.id
  const agent = getAgent(task.agentKey)
  const billing = input.billing ?? getBillingPlan('pro')

  if (!agent) {
    await markTaskFailed(bus, base, taskId, task.agentKey, `No agent named ${task.agentKey}`)
    return 'failed'
  }

  // Settled on a previous pass. Resuming must not re-send an email that
  // already went out - and must not re-ask about one the user declined.
  //
  // Both halves matter. Skipping only 'succeeded' looks sufficient until a
  // user declines something: the task is cancelled, resume re-runs it, the
  // agent reaches for the same tool, and the gate raises a fresh approval.
  // The user then gets asked again, forever, for a thing they already said no
  // to. A decline has to be as final as a success.
  const existing = await db()
    .select({ state: schema.tasks.state })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1)

  const settled = existing[0]?.state
  if (settled && isTaskTerminal(settled as TaskState)) {
    return settled === 'succeeded' ? 'succeeded' : 'failed'
  }

  await emitAgentState(bus, base, agent.key, taskId, 'spawning', `Starting: ${task.title}`)
  await setTaskState(taskId, 'assigned')

  const [run] = await db()
    .insert(schema.agentRuns)
    .values({
      taskId,
      goalId: input.goalId,
      workspaceId: input.workspaceId,
      agentKey: agent.key,
      state: 'working',
    })
    .returning({ id: schema.agentRuns.id })

  if (!run) throw new Error('Failed to create agent run')

  await emitAgentState(bus, base, agent.key, taskId, 'working', task.title)
  await setTaskState(taskId, 'running')

  const workspace = await getWorkspace(input.workspaceId)
  const providers = await connectedProviders(input.workspaceId)
  const toolbelt = buildToolbelt(agent, providers)
  const dependencyResults = await loadDependencyResults(task, taskIds)
  const priorRun = await loadPausedRun(taskId)
  // Read fresh every dispatch: an instruction saved a moment ago must apply
  // to this run, not the one after it.
  const customInstructions = await getInstructions(input.workspaceId, agent.key)

  let outcome: RunOutcome
  try {
    outcome = await executeTask(
      deps.client,
      {
        agent,
        model: billing.model,
        effort: billing.effort,
        customInstructions,
        toolbelt,
        context: { workspaceId: input.workspaceId, timezone: input.timezone },
        taskDescription: task.description,
        dependencyResults,
        attachments: [],
        autonomy: workspace?.autonomyLevel ?? 'ask_always',
        grantedActionTypes: workspace?.grantedActionTypes ?? [],
        ...(priorRun?.conversation
          ? { messages: priorRun.conversation as Anthropic.MessageParam[] }
          : {}),
        ...(priorRun?.approvedToolIds ? { approvedToolIds: priorRun.approvedToolIds } : {}),
      },
      {
        onToolCall: (record) => {
          void db()
            .insert(schema.toolCalls)
            .values({
              runId: run.id,
              workspaceId: input.workspaceId,
              agentKey: agent.key,
              toolId: record.toolId,
              effect: record.effect,
              permission: record.permission,
              summary: record.summary,
              outcome: record.outcome,
              error: record.error,
              durationMs: record.durationMs,
            })
            .catch((e) => console.error('[orchestration] failed to record tool call', e))

          void bus
            .emit({
              ...base,
              type: 'tool.called',
              taskId,
              agentKey: agent.key,
              toolId: record.toolId,
              summary: record.summary,
              outcome: record.outcome,
            })
            .catch((e) => console.error('[orchestration] failed to emit tool call', e))
        },
        onStep: (completed) => {
          void bus
            .emit({
              ...base,
              type: 'task.progress',
              taskId,
              agentKey: agent.key,
              completedSteps: completed,
              // Unknown ahead of time: the agent decides how many calls it
              // needs. Reported as measured steps with no denominator rather
              // than a percentage we would have to invent.
              totalSteps: null,
              confidence: 'measured',
              note: null,
            })
            .catch((e) => console.error('[orchestration] failed to emit progress', e))
        },
      },
    )
  } catch (err) {
    // Same split as everywhere else: the raw text is kept on the run and in
    // the log, the screen gets a sentence the user can act on.
    console.error('[orchestration] task threw', taskId, err)
    const raw = err instanceof Error ? err.message : String(err)
    await completeRun(run.id, 'error', null, raw)
    await markTaskFailed(bus, base, taskId, agent.key, explainFailure(err).message)
    return 'failed'
  }

  if (outcome.status === 'awaiting_approval') {
    await db()
      .update(schema.agentRuns)
      .set({
        state: 'needs_input',
        conversation: outcome.messages as unknown[],
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
      })
      .where(eq(schema.agentRuns.id, run.id))

    await setTaskState(taskId, 'awaiting_approval')

    for (const pending of outcome.approvals) {
      const [approval] = await db()
        .insert(schema.approvals)
        .values({
          taskId,
          goalId: input.goalId,
          workspaceId: input.workspaceId,
          agentKey: agent.key,
          actionType: pending.actionType,
          description: pending.description,
          preview: pending.preview,
        })
        .returning({ id: schema.approvals.id })

      if (!approval) continue

      await bus.emit({
        ...base,
        type: 'approval.requested',
        approvalId: approval.id,
        taskId,
        agentKey: agent.key,
        actionType: pending.actionType,
        description: pending.description,
        preview: pending.preview,
      })
    }

    await emitAgentState(
      bus,
      base,
      agent.key,
      taskId,
      'needs_input',
      'Waiting for your approval',
    )
    return 'awaiting_approval'
  }

  if (outcome.status === 'failed') {
    // The run keeps the raw error for debugging; the island and History get
    // the readable one.
    console.error('[orchestration] task failed', taskId, outcome.error)
    await completeRun(run.id, 'error', null, outcome.error, outcome.usage)
    await markTaskFailed(bus, base, taskId, agent.key, explainFailure(outcome.error).message)
    return 'failed'
  }

  await completeRun(run.id, 'completed', { text: outcome.result }, null, outcome.usage)
  await setTaskState(taskId, 'succeeded')
  await bus.emit({ ...base, type: 'task.state_changed', taskId, state: 'succeeded', error: null })
  await emitAgentState(bus, base, agent.key, taskId, 'completed', 'Finished')

  return 'succeeded'
}

/** Combine every task result into the answer the user receives. */
async function finishGoal(deps: OrchestrationDeps, input: RunGoalInput): Promise<void> {
  const { bus } = deps
  const base = { goalId: input.goalId, workspaceId: input.workspaceId }

  await bus.emit({ ...base, type: 'goal.state_changed', state: 'synthesising', error: null })
  await setGoalState(input.goalId, 'synthesising')
  await emitAgentState(
    bus,
    base,
    ORCHESTRATOR.key,
    null,
    'working',
    'Putting the results together',
  )

  const results = await loadTaskResults(input.goalId)
  const billing = input.billing ?? getBillingPlan('pro')
  const summary = await synthesise(deps.client, {
    goal: input.prompt,
    results,
    timezone: input.timezone,
    model: billing.model,
    effort: billing.effort,
  })

  const [artifact] = await db()
    .insert(schema.artifacts)
    .values({
      goalId: input.goalId,
      workspaceId: input.workspaceId,
      title: 'Summary',
      kind: 'summary',
      content: summary,
    })
    .returning({ id: schema.artifacts.id })

  await db()
    .update(schema.goals)
    .set({ state: 'completed', summary, completedAt: new Date() })
    .where(eq(schema.goals.id, input.goalId))

  await emitAgentState(bus, base, ORCHESTRATOR.key, null, 'completed', 'Done')
  await bus.emit({
    ...base,
    type: 'goal.completed',
    summary,
    artifacts: artifact ? [{ artifactId: artifact.id, title: 'Summary', kind: 'summary' }] : [],
  })
}

// ------------------------------------------------------------- persistence --

async function persistPlan(
  input: RunGoalInput,
  plan: { interpretation: string; tasks: readonly PlannedTask[]; unsupported: string[] },
): Promise<{ planId: string; taskIds: Map<string, string> }> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.plans)
      .values({
        goalId: input.goalId,
        workspaceId: input.workspaceId,
        interpretation: plan.interpretation,
        unsupported: plan.unsupported,
      })
      .returning({ id: schema.plans.id })

    if (!row) throw new Error('Failed to persist plan')

    const waves = executionWaves(plan.tasks)
    const waveOf = new Map<string, number>()
    waves.forEach((wave, index) => wave.forEach((t) => waveOf.set(t.id, index)))

    // Insert first to mint real ids, then rewrite dependsOn from plan-local
    // ids to ours. Two passes because a task can depend on one inserted after
    // it, so no single ordering makes the mapping available up front.
    const taskIds = new Map<string, string>()
    for (const task of plan.tasks) {
      const [inserted] = await tx
        .insert(schema.tasks)
        .values({
          planId: row.id,
          goalId: input.goalId,
          workspaceId: input.workspaceId,
          planLocalId: task.id,
          title: task.title,
          description: task.description,
          agentKey: task.agentKey,
          dependsOn: [],
          wave: waveOf.get(task.id) ?? 0,
          state: task.dependsOn.length > 0 ? 'blocked' : 'pending',
        })
        .returning({ id: schema.tasks.id })

      if (inserted) taskIds.set(task.id, inserted.id)
    }

    for (const task of plan.tasks) {
      const ourId = taskIds.get(task.id)
      if (!ourId || task.dependsOn.length === 0) continue
      await tx
        .update(schema.tasks)
        .set({ dependsOn: task.dependsOn.map((d) => taskIds.get(d) ?? d) })
        .where(eq(schema.tasks.id, ourId))
    }

    return { planId: row.id, taskIds }
  })
}

async function loadDependencyResults(
  task: PlannedTask,
  taskIds: ReadonlyMap<string, string>,
): Promise<readonly { title: string; result: string }[]> {
  if (task.dependsOn.length === 0) return []

  const ids = task.dependsOn.map((d) => taskIds.get(d) ?? d)
  const rows = await db()
    .select({ title: schema.tasks.title, result: schema.agentRuns.result })
    .from(schema.agentRuns)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.agentRuns.taskId))
    .where(
      and(inArray(schema.agentRuns.taskId, ids), eq(schema.agentRuns.state, 'completed')),
    )

  return rows.map((r) => ({
    title: r.title,
    result: typeof r.result?.text === 'string' ? r.result.text : '',
  }))
}

/**
 * Everything that was attempted for this goal, however it ended.
 *
 * This used to return only the runs that completed, and that made the final
 * answer dishonest in the one case that matters. A goal fails outright only
 * when every task in a step fails; a goal where one of three tasks failed
 * still finishes and still gets summarised - from the two that worked, with
 * no mention anywhere that the third did not. The user reads a confident
 * answer about two thirds of their request.
 *
 * So failures and declines come back too, and the synthesis prompt is told
 * to say what is missing. A partial answer is fine. A partial answer wearing
 * a complete one's clothes is not.
 *
 * Left join, because a task can reach a terminal state without a run ever
 * being written - the planner naming an agent that does not exist fails the
 * task before there is anything to join to.
 */
async function loadTaskResults(goalId: string): Promise<readonly TaskOutcomeRecord[]> {
  const rows = await db()
    .select({
      title: schema.tasks.title,
      state: schema.tasks.state,
      error: schema.tasks.error,
      agentKey: schema.tasks.agentKey,
      runAgentKey: schema.agentRuns.agentKey,
      result: schema.agentRuns.result,
    })
    .from(schema.tasks)
    .leftJoin(
      schema.agentRuns,
      and(eq(schema.agentRuns.taskId, schema.tasks.id), eq(schema.agentRuns.goalId, goalId)),
    )
    .where(eq(schema.tasks.goalId, goalId))

  return rows
    .filter((r) => isTaskTerminal(r.state as TaskState))
    .map((r) => ({
      title: r.title,
      agentKey: r.runAgentKey ?? r.agentKey ?? 'unknown',
      state: r.state as 'succeeded' | 'failed' | 'cancelled',
      result: typeof r.result?.text === 'string' ? r.result.text : '',
      error: r.error ?? null,
    }))
}

async function loadPausedRun(
  taskId: string,
): Promise<{ conversation: unknown[] | null; approvedToolIds: string[] } | null> {
  const [row] = await db()
    .select({
      conversation: schema.agentRuns.conversation,
      approvedToolIds: schema.agentRuns.approvedToolIds,
    })
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.taskId, taskId), eq(schema.agentRuns.state, 'needs_input')))
    .limit(1)

  return row ?? null
}

async function completeRun(
  runId: string,
  state: string,
  result: Record<string, unknown> | null,
  error: string | null,
  usage?: { inputTokens: number; outputTokens: number },
): Promise<void> {
  await db()
    .update(schema.agentRuns)
    .set({
      state,
      result,
      error,
      completedAt: new Date(),
      // Cleared on completion: the conversation only exists to survive a
      // pause, and keeping transcripts of finished runs stores user mail
      // contents we have no reason to retain.
      conversation: null,
      ...(usage
        ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
        : {}),
    })
    .where(eq(schema.agentRuns.id, runId))
}

// ----------------------------------------------------------------- emitting --

type Base = { goalId: string; workspaceId: string }

async function emitAgentState(
  bus: EventBus,
  base: Base,
  agentKey: string,
  taskId: string | null,
  state: AgentState,
  activity: string,
): Promise<void> {
  await bus.emit({
    ...base,
    type: 'agent.state_changed',
    agentKey,
    taskId,
    state,
    activity,
    error: null,
  })
}

async function markTaskFailed(
  bus: EventBus,
  base: Base,
  taskId: string,
  agentKey: string,
  error: string,
): Promise<void> {
  await setTaskState(taskId, 'failed', error)
  await bus.emit({ ...base, type: 'task.state_changed', taskId, state: 'failed', error })
  await bus.emit({
    ...base,
    type: 'agent.state_changed',
    agentKey,
    taskId,
    state: 'error',
    activity: 'Could not finish',
    error,
  })
}

async function failGoal(
  deps: OrchestrationDeps,
  base: Base,
  error: string,
): Promise<void> {
  // The credit goes back when the run produced nothing.
  //
  // Judged on whether any task actually succeeded rather than on where the
  // failure happened, which covers both shapes of it: a goal that died during
  // planning never started, and a goal whose every task failed has nothing to
  // show either. A goal that got some of the way is not refunded - that work
  // was really done, and really paid for.
  await refundIfNothingLanded(base, error)

  await db()
    .update(schema.goals)
    .set({ state: 'failed', error, completedAt: new Date() })
    .where(eq(schema.goals.id, base.goalId))
    .catch(() => undefined)

  // Stand the Orchestrator down before announcing the failure.
  //
  // It was left in whatever state it last reported - usually "Reading your
  // goal" - so a goal that died during planning left the island showing one
  // agent still at work on it, indefinitely. A robot is busy because a run is
  // in flight; when the run ends the robot sits down, whichever way it ended.
  await deps.bus
    .emit({
      ...base,
      type: 'agent.state_changed',
      agentKey: ORCHESTRATOR.key,
      taskId: null,
      state: 'error',
      activity: 'Could not finish',
      error,
    })
    .catch((e) => console.error('[orchestration] failed to stand down the hub', e))

  await deps.bus
    .emit({ ...base, type: 'goal.state_changed', state: 'failed', error })
    .catch((e) => console.error('[orchestration] failed to emit failure', e))
}

async function refundIfNothingLanded(base: Base, error: string): Promise<void> {
  try {
    const succeeded = await db()
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.goalId, base.goalId), eq(schema.tasks.state, 'succeeded')))
      .limit(1)

    if (succeeded.length > 0) return
    await refundGoal(base.workspaceId, base.goalId, error.slice(0, 200))
  } catch (err) {
    // A refund that fails is a support ticket, not a second failure to show
    // the user on top of the one they already have.
    console.error('[orchestration] could not refund', base.goalId, err)
  }
}

const setGoalState = (goalId: string, state: string): Promise<unknown> =>
  db().update(schema.goals).set({ state }).where(eq(schema.goals.id, goalId))

const setTaskState = (taskId: string, state: string, error?: string): Promise<unknown> =>
  db()
    .update(schema.tasks)
    .set({ state, ...(error ? { error } : {}) })
    .where(eq(schema.tasks.id, taskId))
