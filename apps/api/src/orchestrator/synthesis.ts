import type Anthropic from '@anthropic-ai/sdk'
import type { PlanEffort, PlanModel } from '@agents-world/shared'

/**
 * The Orchestrator's second half: many agent results, one answer.
 *
 * The user watched several robots work but read none of their output. What
 * they get back has to read like one considered reply from one mind, not a
 * stapled-together report with a heading per agent.
 */

const MAX_TOKENS = 16_000

const SYNTHESIS_INSTRUCTIONS = `You are the Orchestrator of a multi-agent workspace,
writing the final answer for the user.

Several specialist agents have finished their tasks. You have their results.
The user watched them work but has read none of this.

Write one answer:
- Lead with what the user actually asked for. Not "I dispatched three agents" -
  they saw that happen.
- Merge the findings. If the Email Agent found a meeting request and the
  Calendar Agent found that slot is busy, say so as one fact, not as two
  separate reports the user has to reconcile.
- Keep the evidence: senders, subjects, times, channel names, links. A summary
  the user cannot verify is a summary they have to redo.
- Lead with what needs them to act, then what needs them to know.
- If an agent failed or returned nothing useful, say so plainly and say what
  is therefore missing. Never present a partial answer as a complete one.
- No preamble, no sign-off, no restating the question. Start with the answer.

Write in plain prose with short paragraphs. This text is also read aloud, so
avoid tables and deeply nested lists.`

export interface SynthesisInput {
  readonly goal: string
  readonly results: readonly { title: string; agentKey: string; result: string }[]
  readonly timezone: string
  /** The workspace's billing plan decides both. See the planner. */
  readonly model?: PlanModel
  readonly effort?: PlanEffort
}

export async function synthesise(
  client: Anthropic,
  input: SynthesisInput,
): Promise<string> {
  if (input.results.length === 0) {
    return 'No agent produced a result for this goal. Nothing was completed.'
  }

  const findings = input.results
    .map((r) => `### ${r.title} (${r.agentKey})\n${r.result || '(returned nothing)'}`)
    .join('\n\n')

  const response = await client.messages.create({
    model: input.model ?? 'claude-opus-5',
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: SYNTHESIS_INSTRUCTIONS,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `The user asked:\n"""\n${input.goal}\n"""\n\nTheir timezone is ${input.timezone}.\n\nWhat the agents found:\n\n${findings}\n\nWrite the answer.`,
      },
    ],
    output_config: { effort: input.effort ?? 'high' },
  })

  if (response.stop_reason === 'refusal') {
    return 'The results could not be summarised. Open the individual agents to read their findings directly.'
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

  return text || 'The agents finished but produced no summary.'
}
