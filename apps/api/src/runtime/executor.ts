import type Anthropic from '@anthropic-ai/sdk'
import {
  decide,
  isAutonomous,

  type AgentDefinition,
  type AutonomyLevel,
  type ToolEffect,
} from '@agents-world/shared'
import type { ToolBinding, ToolContext } from './toolbelt.js'

/**
 * The agent loop: one agent, one task, from dispatch to result.
 *
 * The shape that matters here is what happens when an agent reaches for a
 * consequential tool. The run does not ask the model to behave, and does not
 * execute-then-apologise. It stops before the call, records what was asked
 * for, and returns - so the decision is genuinely the user's, made with the
 * exact arguments in front of them.
 *
 * That pause is resumable. The assistant turn holding the tool_use blocks is
 * persisted un-answered; on approval the same batch executes and the
 * conversation continues as if it had never stopped. The model is never told
 * it was blocked, so it does not reroute around the gate.
 */

const MODEL = 'claude-opus-5'
const MAX_TOKENS = 16_000

/** Ceiling on model turns. A runaway agent is a cost incident, not a feature. */
const MAX_ITERATIONS = 20

export interface ExecuteInput {
  readonly agent: AgentDefinition
  readonly toolbelt: readonly ToolBinding[]
  readonly context: ToolContext
  /** What the Orchestrator asked this agent to do. */
  readonly taskDescription: string
  /** Outputs of tasks this one depended on. */
  readonly dependencyResults: readonly { title: string; result: string }[]
  /** Text of files the user attached that this task needs. */
  readonly attachments: readonly { filename: string; text: string }[]
  readonly autonomy: AutonomyLevel
  readonly grantedActionTypes: readonly string[]
  /** Conversation so far. Empty on first dispatch, populated on resume. */
  readonly messages?: readonly Anthropic.MessageParam[]
  /** Tool ids approved for this run specifically, on resume. */
  readonly approvedToolIds?: readonly string[]
}

export interface ToolCallRecord {
  readonly toolId: string
  readonly effect: ToolEffect
  readonly permission: 'allowed' | 'approved' | 'denied'
  readonly outcome: 'succeeded' | 'failed' | 'denied'
  readonly summary: string
  readonly error: string | null
  readonly durationMs: number
}

export interface PendingApproval {
  readonly toolId: string
  readonly actionType: string
  readonly description: string
  /** Exactly what would go out, for the user to read before approving. */
  readonly preview: string
}

export type RunOutcome =
  | {
      readonly status: 'completed'
      readonly result: string
      readonly toolCalls: readonly ToolCallRecord[]
      readonly messages: readonly Anthropic.MessageParam[]
      readonly usage: { inputTokens: number; outputTokens: number }
    }
  | {
      readonly status: 'awaiting_approval'
      readonly approvals: readonly PendingApproval[]
      readonly toolCalls: readonly ToolCallRecord[]
      /** Persist verbatim. Resuming replays this exactly. */
      readonly messages: readonly Anthropic.MessageParam[]
      readonly usage: { inputTokens: number; outputTokens: number }
    }
  | {
      readonly status: 'failed'
      readonly error: string
      readonly toolCalls: readonly ToolCallRecord[]
      readonly usage: { inputTokens: number; outputTokens: number }
    }

/** Progress reporting, so the island moves while the agent works. */
export interface ProgressReporter {
  onToolCall(record: ToolCallRecord): void
  onStep(completed: number): void
}

export async function executeTask(
  client: Anthropic,
  input: ExecuteInput,
  report: ProgressReporter,
): Promise<RunOutcome> {
  const messages: Anthropic.MessageParam[] = [...(input.messages ?? [])]
  const toolCalls: ToolCallRecord[] = []
  const byName = new Map(input.toolbelt.map((t) => [t.claudeName, t]))

  let inputTokens = 0
  let outputTokens = 0

  if (messages.length === 0) {
    messages.push({ role: 'user', content: buildTaskPrompt(input) })
  }

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // On resume the last turn is an un-answered assistant tool_use. Execute it
    // rather than asking the model to produce it again.
    const resuming =
      iteration === 0 &&
      messages.length > 0 &&
      messages[messages.length - 1]?.role === 'assistant'

    let assistant: Anthropic.Message | null = null

    if (!resuming) {
      assistant = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: input.agent.instructions,
            // Byte-stable across every run of this agent, so the prefix caches.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
        tools: input.toolbelt.map((t) => t.definition),
        output_config: { effort: 'high' },
      })

      inputTokens += assistant.usage.input_tokens
      outputTokens += assistant.usage.output_tokens

      // A refusal arrives as HTTP 200 with a refusal stop reason, so it has to
      // be checked before anything reads the content.
      if (assistant.stop_reason === 'refusal') {
        return {
          status: 'failed',
          error: `The ${input.agent.name} declined this task. It may need rewording.`,
          toolCalls,
          usage: { inputTokens, outputTokens },
        }
      }

      messages.push({ role: 'assistant', content: assistant.content })

      if (assistant.stop_reason !== 'tool_use') {
        return {
          status: 'completed',
          result: textOf(assistant.content),
          toolCalls,
          messages,
          usage: { inputTokens, outputTokens },
        }
      }
    }

    const lastTurn = messages[messages.length - 1]
    const blocks: Anthropic.ContentBlock[] = Array.isArray(lastTurn?.content)
      ? (lastTurn.content as Anthropic.ContentBlock[])
      : []
    const requests = blocks.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )

    if (requests.length === 0) {
      return {
        status: 'completed',
        result: textOf(blocks),
        toolCalls,
        messages,
        usage: { inputTokens, outputTokens },
      }
    }

    // Gate the whole batch before executing any of it. Checking first means a
    // batch that pairs a read with a send does not half-run and then stop,
    // leaving the user to work out what did and did not happen.
    const pending: PendingApproval[] = []

    for (const request of requests) {
      const binding = byName.get(request.name)
      if (!binding) continue
      if (isAutonomous(binding.effect)) continue
      if (input.approvedToolIds?.includes(binding.toolId)) continue

      const verdict = decide({
        effect: binding.effect,
        autonomy: input.autonomy,
        grantedActionTypes: input.grantedActionTypes,
        actionType: binding.toolId,
      })

      if (!verdict.allow) {
        pending.push({
          toolId: binding.toolId,
          actionType: binding.toolId,
          description: describeAction(binding, request.input as Record<string, unknown>),
          preview: previewOf(request.input as Record<string, unknown>),
        })
      }
    }

    if (pending.length > 0) {
      // Stop here with the assistant turn un-answered. Approving replays this
      // exact batch; the model never learns it was paused, so it cannot try
      // to route around the gate on the next turn.
      return {
        status: 'awaiting_approval',
        approvals: pending,
        toolCalls,
        messages,
        usage: { inputTokens, outputTokens },
      }
    }

    const results = await Promise.all(
      requests.map((request) => runOne(request, byName, input.context, report, toolCalls)),
    )

    report.onStep(toolCalls.length)

    // Every result goes back in ONE user message. Splitting them across
    // several teaches the model to stop calling tools in parallel, which
    // would quietly serialise every agent on the island.
    messages.push({ role: 'user', content: results })
  }

  return {
    status: 'failed',
    error: `The ${input.agent.name} did not finish within ${MAX_ITERATIONS} steps.`,
    toolCalls,
    usage: { inputTokens, outputTokens },
  }
}

async function runOne(
  request: Anthropic.ToolUseBlock,
  byName: ReadonlyMap<string, ToolBinding>,
  context: ToolContext,
  report: ProgressReporter,
  sink: ToolCallRecord[],
): Promise<Anthropic.ToolResultBlockParam> {
  const binding = byName.get(request.name)
  const started = Date.now()

  if (!binding) {
    const record: ToolCallRecord = {
      toolId: request.name,
      effect: 'read',
      permission: 'denied',
      outcome: 'denied',
      summary: `Unknown tool ${request.name}`,
      error: 'No such tool',
      durationMs: 0,
    }
    sink.push(record)
    report.onToolCall(record)
    return {
      type: 'tool_result',
      tool_use_id: request.id,
      content: `No tool named ${request.name} is available to you.`,
      is_error: true,
    }
  }

  try {
    const output = await binding.run(context, request.input as Record<string, unknown>)
    const record: ToolCallRecord = {
      toolId: binding.toolId,
      effect: binding.effect,
      permission: isAutonomous(binding.effect) ? 'allowed' : 'approved',
      outcome: 'succeeded',
      summary: describeAction(binding, request.input as Record<string, unknown>),
      error: null,
      durationMs: Date.now() - started,
    }
    sink.push(record)
    report.onToolCall(record)

    return {
      type: 'tool_result',
      tool_use_id: request.id,
      content: JSON.stringify(output),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const record: ToolCallRecord = {
      toolId: binding.toolId,
      effect: binding.effect,
      permission: isAutonomous(binding.effect) ? 'allowed' : 'approved',
      outcome: 'failed',
      summary: describeAction(binding, request.input as Record<string, unknown>),
      error: message,
      durationMs: Date.now() - started,
    }
    sink.push(record)
    report.onToolCall(record)

    // Returned as a tool_result rather than thrown: the agent can often
    // recover from one failed call, and killing the run would throw away the
    // work it has already done.
    return {
      type: 'tool_result',
      tool_use_id: request.id,
      content: `That failed: ${message}`,
      is_error: true,
    }
  }
}

function buildTaskPrompt(input: ExecuteInput): string {
  const parts = [`Your task:\n${input.taskDescription}`]

  if (input.dependencyResults.length > 0) {
    parts.push(
      'Results from earlier tasks you depend on:\n' +
        input.dependencyResults.map((d) => `### ${d.title}\n${d.result}`).join('\n\n'),
    )
  }

  if (input.attachments.length > 0) {
    parts.push(
      'Files the user attached:\n' +
        input.attachments.map((a) => `### ${a.filename}\n${a.text}`).join('\n\n'),
    )
  }

  parts.push(
    `The user's timezone is ${input.context.timezone}.`,
    'When you are done, write your result as plain prose for the Orchestrator ' +
      'to combine with other agents\' work. State what you found, not what you did.',
  )

  return parts.join('\n\n')
}

/** One readable line for the audit log and the agent detail panel. */
function describeAction(
  binding: ToolBinding,
  input: Record<string, unknown>,
): string {
  switch (binding.toolId) {
    case 'gmail.search':
      return `Searched mail for "${String(input.query ?? '')}"`
    case 'gmail.read':
      return 'Read a message'
    case 'gmail.draft':
      return `Drafted a reply to ${String(input.to ?? '')}`
    case 'gmail.send':
      return `Send an email to ${String(input.to ?? '')} - "${String(input.subject ?? '')}"`
    case 'gcal.list_events':
      return 'Checked the calendar'
    case 'gcal.find_free':
      return 'Looked for free time'
    case 'gcal.create_event':
      return `Create "${String(input.title ?? '')}" and invite attendees`
    case 'gcal.delete_event':
      return 'Delete a calendar event and notify attendees'
    case 'slack.list_channels':
      return 'Listed Slack channels'
    case 'slack.read_messages':
      return 'Read a Slack channel'
    case 'slack.summarise_thread':
      return 'Read a Slack thread'
    case 'slack.post_message':
      return 'Post a message to Slack'
    default:
      return binding.toolId
  }
}

/**
 * What the user reads before approving.
 *
 * The actual content - the email body, the Slack text - not a paraphrase.
 * Approving something you were shown a summary of is not informed consent.
 */
function previewOf(input: Record<string, unknown>): string {
  const lines: string[] = []
  if (input.to) lines.push(`To: ${String(input.to)}`)
  if (input.subject) lines.push(`Subject: ${String(input.subject)}`)
  if (input.channelId) lines.push(`Channel: ${String(input.channelId)}`)
  if (input.title) lines.push(`Title: ${String(input.title)}`)
  if (input.start) lines.push(`Start: ${String(input.start)}`)
  if (Array.isArray(input.attendees) && input.attendees.length > 0) {
    lines.push(`Attendees: ${(input.attendees as string[]).join(', ')}`)
  }
  const body = input.body ?? input.text
  if (body) lines.push('', String(body))
  return lines.join('\n')
}

const textOf = (content: readonly Anthropic.ContentBlock[]): string =>
  content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

