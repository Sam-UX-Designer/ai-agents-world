import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  ORCHESTRATOR,
  availableTools,
  delegatableAgents,
  executionWaves,
  taskPlanSchema,
  validatePlan,
  type ConnectionProvider,
  type PlannedTask,
  type TaskPlan,
} from '@agents-world/shared'

/**
 * The Orchestrator's planning step: one goal in, an executable plan out.
 *
 * This is the first half of orchestration. The second half - dispatching the
 * plan and synthesising what comes back - lives in the runtime, because it
 * needs the database and this does not. Keeping planning pure makes it
 * testable against a fixed goal without standing up Postgres.
 */

const MODEL = 'claude-opus-5'

/** Non-streaming ceiling that stays under the SDK's HTTP timeout. */
const MAX_TOKENS = 16_000

export interface PlanRequest {
  readonly goal: string
  /** Integrations this workspace has actually connected. An agent whose
   *  tools all need Slack is not offered when Slack is not connected. */
  readonly connectedProviders: readonly ConnectionProvider[]
  /** Filenames the user attached, so the plan can route them to an agent. */
  readonly attachedFiles?: readonly string[]
  /** The user's timezone, so "tomorrow" means the right day. */
  readonly timezone: string
}

export type PlanResult =
  | { readonly ok: true; readonly plan: TaskPlan; readonly waves: readonly (readonly PlannedTask[])[]; readonly usage: Usage }
  | { readonly ok: false; readonly reason: string }

export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
}

/**
 * Describe the roster to the model.
 *
 * Built from the same registry the island renders, so the Orchestrator can
 * never assign work to an agent that does not exist on screen. Only agents
 * with at least one usable tool are listed: offering an agent whose
 * integration is disconnected produces a plan that fails on its first step.
 */
function describeRoster(connected: readonly ConnectionProvider[]): string {
  const usable = delegatableAgents().filter(
    (a) => availableTools(a, connected).length > 0,
  )

  if (usable.length === 0) return '(No agents are available - no integrations are connected.)'

  return usable
    .map((agent) => {
      const tools = availableTools(agent, connected)
        .map((t) => `      - ${t.id}: ${t.label} (${t.effect})`)
        .join('\n')
      return `  ${agent.key} - ${agent.name}\n    ${agent.role}\n    Tools:\n${tools}`
    })
    .join('\n\n')
}

function buildUserPrompt(req: PlanRequest): string {
  const files =
    req.attachedFiles && req.attachedFiles.length > 0
      ? `\n\nThe user attached these files. Route them to whichever task needs them:\n${req.attachedFiles.map((f) => `  - ${f}`).join('\n')}`
      : ''

  return `Available agents and their tools:

${describeRoster(req.connectedProviders)}

The user's timezone is ${req.timezone}. Resolve relative dates like "tomorrow" against it.

The user's goal:
"""
${req.goal}
"""${files}

Produce the plan.`
}

/**
 * Ask the Orchestrator for a plan, and refuse to return one we cannot run.
 *
 * The model is reliable at decomposition and still capable of naming an agent
 * that does not exist or wiring two tasks into a cycle. `validatePlan` catches
 * that here, at plan time, where the error is one clear message - rather than
 * at dispatch, where it would be a task that silently never starts.
 */
export async function createPlan(
  client: Anthropic,
  req: PlanRequest,
): Promise<PlanResult> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // Stable prefix, cached: the instructions never vary between goals, so
    // every plan after the first pays for only the goal itself.
    system: [
      {
        type: 'text',
        text: ORCHESTRATOR.instructions,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserPrompt(req) }],
    output_config: {
      format: zodOutputFormat(taskPlanSchema),
      // Planning decides how well every downstream agent spends its time.
      // It is the wrong place to economise.
      effort: 'high',
    },
  })

  const usage: Usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  }

  // Safety classifiers can decline a goal. That arrives as a 200 with a
  // refusal stop reason, not an exception, so it has to be checked before
  // anything reads the content.
  if (response.stop_reason === 'refusal') {
    return {
      ok: false,
      reason:
        'The Orchestrator could not plan this goal. Try rewording it, or ask for something narrower.',
    }
  }

  const plan = response.parsed_output
  if (!plan) {
    return { ok: false, reason: 'The Orchestrator did not return a usable plan. Try again.' }
  }

  if (plan.tasks.length === 0) {
    return {
      ok: false,
      reason:
        plan.unsupported.length > 0
          ? `This goal needs capabilities no connected agent has: ${plan.unsupported.join(', ')}.`
          : 'The Orchestrator could not find any work to do for this goal.',
    }
  }

  const knownKeys = delegatableAgents().map((a) => a.key)
  const errors = validatePlan(plan, knownKeys)
  if (errors.length > 0) {
    return { ok: false, reason: explainPlanErrors(errors) }
  }

  return { ok: true, plan, waves: executionWaves(plan.tasks), usage }
}

/** Turn validation failures into one sentence an operator can act on. */
function explainPlanErrors(
  errors: readonly ReturnType<typeof validatePlan>[number][],
): string {
  const first = errors[0]
  if (!first) return 'The plan failed validation.'

  switch (first.kind) {
    case 'unknown_agent':
      return `The plan assigned work to "${first.agentKey}", which is not an available agent.`
    case 'unknown_dependency':
      return `Task ${first.taskId} depends on ${first.dependsOn}, which is not in the plan.`
    case 'duplicate_task_id':
      return `The plan reused task id ${first.taskId}.`
    case 'self_dependency':
      return `Task ${first.taskId} depends on itself.`
    case 'dependency_cycle':
      return `The plan has a dependency cycle: ${first.taskIds.join(' -> ')}.`
  }
}
