/**
 * Turn a failure into a sentence the person who hit it can act on.
 *
 * Model providers report problems as JSON blobs inside an error message. Put
 * straight on screen, "400 {"type":"error","error":{"type":"invalid_request_
 * error","message":"Your credit balance is too low..."}}" tells a user nothing
 * they can use, hides the one sentence that matters inside punctuation, and
 * leaks our request ids while it does it.
 *
 * The full original is still logged and still stored on the run, so debugging
 * loses nothing. Only what reaches the screen changes.
 */

export interface Failure {
  /** What the user sees. One sentence, and where possible, what to do next. */
  readonly message: string
  /** True when a retry might work on its own - a rate limit, an overload. */
  readonly transient: boolean
}

const RULES: readonly { match: RegExp; message: string; transient: boolean }[] = [
  {
    match: /credit balance is too low|insufficient[_ ]?credits|billing/i,
    message:
      'Your Anthropic account has run out of credits, so the agents cannot think. ' +
      'Add credits at console.anthropic.com under Plans & Billing, then run this again.',
    transient: false,
  },
  {
    match: /invalid[_ ]?api[_ ]?key|authentication[_ ]?error|401/,
    message:
      'The Anthropic API key on this server was rejected. Check ANTHROPIC_API_KEY ' +
      'in the API host settings - a rotated or mistyped key gives exactly this.',
    transient: false,
  },
  {
    match: /rate[_ ]?limit|429/,
    message: 'Anthropic is rate-limiting this workspace. Wait a moment and try again.',
    transient: true,
  },
  {
    match: /overloaded|529|503/,
    message: 'Claude is overloaded right now. Try again in a moment.',
    transient: true,
  },
  {
    match: /refus/i,
    message:
      'Claude declined this goal. Rephrase it, or break it into smaller steps.',
    transient: false,
  },
  {
    match: /timeout|ETIMEDOUT|ECONNRESET|fetch failed/i,
    message: 'The connection to Anthropic dropped part-way through. Try again.',
    transient: true,
  },
]

export function explainFailure(err: unknown): Failure {
  const raw = err instanceof Error ? err.message : String(err)

  for (const rule of RULES) {
    if (rule.match.test(raw)) {
      return { message: rule.message, transient: rule.transient }
    }
  }

  // Unrecognised. Say so honestly rather than guessing at a cause, and keep
  // it short - the real text is in the logs for whoever can read it.
  return {
    message: 'Something went wrong while running this goal. The details are in the server logs.',
    transient: false,
  }
}
