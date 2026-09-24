import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  ORCHESTRATOR,
  PLAN_LIMIT_MARKER,
  type PlanEffort,
  type PlanModel,
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
  /**
   * Which model plans this goal, and how hard it thinks.
   *
   * Set by the workspace's billing plan rather than fixed, because planning
   * every free goal on the most expensive model is how a free tier becomes a
   * bill. Defaults to the best of both so a caller that does not care - a
   * test, a script - still gets the good behaviour.
   */
  readonly model?: PlanModel
  readonly effort?: PlanEffort
  /**
   * How many different agents this plan may wake, from the workspace's plan.
   *
   * Agents, not tasks, because that is what the pricing page sells: the free
   * tier's own feature list says "One agent per goal". Counting tasks instead
   * refused a goal that gave two steps to the same agent - one agent, told it
   * needed more than one.
   *
   * Cost is bounded separately, by stepCeiling, because one agent can still be
   * given any number of tasks and each is its own model run.
   *
   * Told to the Orchestrator rather than enforced by truncation afterwards:
   * cutting tasks off a finished plan breaks the dependencies between the ones
   * that remain.
   */
  readonly maxAgents?: number
  /**
   * What this workspace calls its agents, keyed by agent key.
   *
   * Only the ones that were actually renamed. The Orchestrator still plans
   * against the built-in role - that is where the expertise is described, and
   * a rename must not quietly change who gets a task - but it is told the
   * chosen name too, so "ask Muse to check the numbers" reaches the agent the
   * user means rather than failing to match anything.
   */
  readonly agentNames?: Readonly<Record<string, string>>
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
 * never assign work to an agent that does not exist on screen.
 *
 * Every agent is listed, tools or no tools. Listing only agents that hold a
 * connected tool sounds safer and is in fact the difference between a working
 * product and a dead one: a brand-new workspace has connected nothing, so that
 * filter left the Orchestrator an empty roster, and every goal - including
 * "explain X to me", which needs no integration at all - came back as "could
 * not find any work to do". An agent's value is its judgement; a tool is how
 * it reaches outside itself. What it can reach is stated per agent below, so
 * the Orchestrator can still avoid handing someone a task they cannot fetch
 * the inputs for.
 */
function describeRoster(
  connected: readonly ConnectionProvider[],
  names: Readonly<Record<string, string>> = {},
): string {
  return delegatableAgents()
    .map((agent) => {
      const tools = availableTools(agent, connected)
      const belt =
        tools.length > 0
          ? `Tools:\n${tools.map((t) => `      - ${t.id}: ${t.label} (${t.effect})`).join('\n')}`
          : 'Tools: none connected - works from its own knowledge and from what earlier tasks return.'
      // The built-in name first, because that is what the role description
      // below is about, and the chosen one after it, because that is what the
      // user will call it.
      const chosen = names[agent.key]
      const title =
        chosen && chosen !== agent.name
          ? `${agent.name} (this user calls it "${chosen}")`
          : agent.name
      return `  ${agent.key} - ${title}\n    ${agent.role}\n    ${belt}`
    })
    .join('\n\n')
}

/**
 * How many tasks a plan may hold, given how many agents it may wake.
 *
 * Three apiece, and never fewer than three, so a single-agent free goal can
 * still be a read, a check and a write rather than one shot.
 */
const stepCeiling = (maxAgents: number): number => Math.max(3, maxAgents * 3)

function buildUserPrompt(req: PlanRequest): string {
  const cap =
    req.maxAgents && req.maxAgents > 0
      ? `\n\nHard limit: use at most ${req.maxAgents} different agent${req.maxAgents === 1 ? '' : 's'}, ` +
        `and at most ${stepCeiling(req.maxAgents)} tasks in total. ` +
        'If the goal genuinely needs more, do the most valuable part within the ' +
        'limit and say in the interpretation what you left out.'
      : ''

  const files =
    req.attachedFiles && req.attachedFiles.length > 0
      ? `\n\nThe user attached these files. Route them to whichever task needs them:\n${req.attachedFiles.map((f) => `  - ${f}`).join('\n')}`
      : ''

  return `Available agents and their tools:

${describeRoster(req.connectedProviders, req.agentNames)}

The user's timezone is ${req.timezone}. Resolve relative dates like "tomorrow" against it.

The user's goal:
"""
${req.goal}
"""${files}${cap}

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
    model: req.model ?? 'claude-opus-5',
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
      // Planning decides how well every downstream agent spends its time, so
      // it is the last place to economise - but a free goal that only ever
      // goes to one agent has little to plan, and paying Opus prices to
      // decide that is worse than thinking about it less.
      effort: req.effort ?? 'high',
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

  if (req.maxAgents && req.maxAgents > 0) {
    const wanted = new Set(plan.tasks.map((t) => t.agentKey)).size
    if (wanted > req.maxAgents) {
      return {
        ok: false,
        reason:
          `This goal needs ${wanted} agents and ${PLAN_LIMIT_MARKER} ` +
          `${req.maxAgents} in one goal. Split it into smaller goals, or move up a plan.`,
      }
    }

    /*
     * A second ceiling, on steps rather than agents.
     *
     * One agent can be given any number of tasks, and every task is a
     * separate model run - so the agent cap alone does not bound what a goal
     * costs. This does. It is worded as steps because that is what it counts;
     * calling it agents is the mistake this pair of checks replaced.
     */
    const ceiling = stepCeiling(req.maxAgents)
    if (plan.tasks.length > ceiling) {
      return {
        ok: false,
        reason:
          `This goal breaks down into ${plan.tasks.length} steps and ${PLAN_LIMIT_MARKER} ` +
          `${ceiling} in one goal. Split it into smaller goals, or move up a plan.`,
      }
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
