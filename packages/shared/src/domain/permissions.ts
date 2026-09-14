/**
 * The approval model.
 *
 * Product rule, stated once and enforced here rather than per-agent:
 *
 *   Reading, researching, analysing and summarising run autonomously.
 *   Anything with a consequence out in the world stops and asks a human.
 *
 * "Consequential" means the action is visible to someone else, moves money,
 * or destroys data - the three things a user cannot take back. An agent that
 * drafts an email is autonomous; the same agent sending it is not.
 */

/** What a tool does, which is what decides whether it needs a human. */
export type ToolEffect =
  /** Reads data. No external trace. Always autonomous. */
  | 'read'
  /** Derives something new from data already read. Always autonomous. */
  | 'analyse'
  /** Produces a draft held inside our system. Nothing has left yet. */
  | 'draft'
  /** Sends, posts, or shares outside the workspace. Someone else will see it. */
  | 'external_send'
  /** Creates or changes state in a connected third-party system. */
  | 'external_write'
  /** Moves money. Always requires approval, never auto-approvable. */
  | 'financial'
  /** Destroys data. Always requires approval, never auto-approvable. */
  | 'destructive'

/** Effects an agent may perform with no human in the loop. */
export const AUTONOMOUS_EFFECTS: readonly ToolEffect[] = [
  'read',
  'analyse',
  'draft',
]

/**
 * Effects a user may never blanket-approve in advance.
 *
 * Everything else can be waved through per-workspace with "don't ask again".
 * These two cannot, at any permission level, because a wrong payment and a
 * wrong deletion are the two mistakes with no undo.
 */
export const ALWAYS_CONFIRM_EFFECTS: readonly ToolEffect[] = [
  'financial',
  'destructive',
]

export const isAutonomous = (e: ToolEffect): boolean =>
  AUTONOMOUS_EFFECTS.includes(e)

export const requiresApprovalAlways = (e: ToolEffect): boolean =>
  ALWAYS_CONFIRM_EFFECTS.includes(e)

/**
 * How much rope a workspace gives its agents for the approvable middle
 * ground - external_send and external_write.
 */
export type AutonomyLevel =
  /** Ask before every consequential action. The default for a new workspace. */
  | 'ask_always'
  /** Ask once per action type, then remember the answer ("don't ask again"). */
  | 'ask_once_per_type'
  /** Never ask for external_send / external_write. Financial and destructive
   *  still stop, because those are not waivable. */
  | 'autonomous'

export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = 'ask_always'

/** The single input to the gate. Everything needed to decide, nothing more. */
export interface PermissionRequest {
  readonly effect: ToolEffect
  readonly autonomy: AutonomyLevel
  /** Action types already waved through for this workspace, e.g. "slack.post". */
  readonly grantedActionTypes: readonly string[]
  /** Stable identifier for the kind of action, e.g. "gmail.send". */
  readonly actionType: string
}

export type PermissionDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string }

/**
 * The one function that decides whether an agent may act.
 *
 * Every tool call in the system passes through here. It is deliberately pure
 * and deliberately small: an approval gate that is hard to read is an approval
 * gate nobody trusts. The runtime calls this, and the audit log records the
 * decision alongside the action.
 */
export function decide(req: PermissionRequest): PermissionDecision {
  if (isAutonomous(req.effect)) return { allow: true }

  if (requiresApprovalAlways(req.effect)) {
    return {
      allow: false,
      reason:
        req.effect === 'financial'
          ? 'Moving money always needs your confirmation.'
          : 'Deleting data always needs your confirmation.',
    }
  }

  switch (req.autonomy) {
    case 'autonomous':
      return { allow: true }
    case 'ask_once_per_type':
      return req.grantedActionTypes.includes(req.actionType)
        ? { allow: true }
        : {
            allow: false,
            reason: `This is the first time an agent has tried to ${req.actionType}. Approve it once and it will not ask again.`,
          }
    case 'ask_always':
      return {
        allow: false,
        reason: 'This action affects something outside your workspace.',
      }
  }
}
