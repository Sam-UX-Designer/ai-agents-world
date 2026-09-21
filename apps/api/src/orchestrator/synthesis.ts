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
- Some of what follows is marked DID NOT FINISH or NOT DONE. Say so plainly,
  name what is therefore missing, and never write around it. A user who is
  not told a third of their request failed will act as though it did not.
- Never claim an action was taken. The agents read; anything that sends,
  posts or schedules stops for the user's approval, so write about what was
  found, not about what was done.
- No preamble, no sign-off, no restating the question. Start with the answer.

Write in plain prose with short paragraphs. This text is also read aloud, so
avoid tables and deeply nested lists.`

export interface SynthesisInput {
  readonly goal: string
  /**
   * Every task that was attempted, however it ended - not only the ones that
   * worked. A goal finishes as long as one task in each step did, so leaving
   * the failures out is how a two-thirds answer gets written as a whole one.
   */
  readonly results: readonly {
    title: string
    agentKey: string
    result: string
    state?: 'succeeded' | 'failed' | 'cancelled'
    error?: string | null
  }[]
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

  /*
   * A task that failed or was declined is stated as such, in the same list
   * as the ones that worked. The instructions above tell the model to say
   * what is therefore missing, and it can only do that if it is told.
   */
  const findings = input.results
    .map((r) => {
      const head = `### ${r.title} (${r.agentKey})`
      if (r.state === 'failed') {
        return `${head} - DID NOT FINISH\n${r.error ?? 'No reason was recorded.'}`
      }
      if (r.state === 'cancelled') {
        return `${head} - NOT DONE, the user declined it\n${r.error ?? ''}`.trimEnd()
      }
      return `${head}\n${r.result || '(returned nothing)'}`
    })
    .join('\n\n')

  // Everything was attempted and nothing worked. Saying so is the answer -
  // there is nothing for a model to summarise.
  if (input.results.every((r) => r.state === 'failed' || r.state === 'cancelled')) {
    const lines = input.results.map((r) =>
      r.state === 'cancelled'
        ? `${r.title}: you declined this, so it was not done.`
        : `${r.title}: ${r.error ?? 'did not finish.'}`,
    )
    return `Nothing was completed for this goal.\n\n${lines.join('\n')}`
  }

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
