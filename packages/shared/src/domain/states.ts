/**
 * Lifecycle states for agents and tasks.
 *
 * These are the single source of truth for what the 3D world is allowed to
 * render. The island never invents a state: every visual an agent shows maps
 * to one value here, and that value only ever changes because the backend
 * said so.
 */

/** What an agent entity is doing right now. Drives its 3D appearance. */
export const AGENT_STATES = [
  /** Available, assigned nothing. Robot idles at its station. */
  'idle',
  /** Orchestrator only: interpreting the goal and building a plan. */
  'planning',
  /** Assigned work and initialising. The spawn/hand-off beat. */
  'spawning',
  /** Actively executing. This is the state the world exists to show. */
  'working',
  /** Blocked on a dependency or a slow external call. Not failed. */
  'waiting',
  /** Stopped, needs a human decision before it can continue. */
  'needs_input',
  /** Finished its assigned work successfully. */
  'completed',
  /** Cannot continue. `AgentSnapshot.error` explains why, in plain words. */
  'error',
] as const

export type AgentState = (typeof AGENT_STATES)[number]

/** States where the agent is genuinely doing work right now. */
export const ACTIVE_AGENT_STATES: readonly AgentState[] = [
  'planning',
  'spawning',
  'working',
]

/** States that will not change again without new input. */
export const TERMINAL_AGENT_STATES: readonly AgentState[] = [
  'completed',
  'error',
]

/** States where the system is stopped and waiting on a human. */
export const BLOCKED_ON_HUMAN_STATES: readonly AgentState[] = ['needs_input']

export const isActive = (s: AgentState): boolean =>
  ACTIVE_AGENT_STATES.includes(s)
export const isTerminal = (s: AgentState): boolean =>
  TERMINAL_AGENT_STATES.includes(s)
export const needsHuman = (s: AgentState): boolean =>
  BLOCKED_ON_HUMAN_STATES.includes(s)

/** Where a unit of work sits in the plan. */
export const TASK_STATES = [
  'pending',
  'blocked',
  'assigned',
  'running',
  'awaiting_approval',
  'succeeded',
  'failed',
  'cancelled',
] as const

export type TaskState = (typeof TASK_STATES)[number]

export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  'succeeded',
  'failed',
  'cancelled',
]

export const isTaskTerminal = (s: TaskState): boolean =>
  TERMINAL_TASK_STATES.includes(s)

/** A whole goal, from submission to final answer. */
export const GOAL_STATES = [
  'submitted',
  'planning',
  'executing',
  'awaiting_approval',
  'synthesising',
  'completed',
  'failed',
  'cancelled',
] as const

export type GoalState = (typeof GOAL_STATES)[number]

/**
 * How confident we are in a progress number.
 *
 * The PRD requires the product to distinguish confirmed backend state from
 * presentational estimate. A progress bar moving on a timer is a lie; this
 * flag is what keeps us honest about which is which.
 */
export type ProgressConfidence =
  /** Derived from completed steps the backend actually recorded. */
  | 'measured'
  /** Interpolated for smoothness. Must be visually distinguishable. */
  | 'estimated'
