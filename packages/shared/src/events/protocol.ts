import { z } from 'zod'
import { AGENT_STATES, GOAL_STATES, TASK_STATES } from '../domain/states.js'

/**
 * The event protocol: backend -> clients.
 *
 * This is the only channel through which the 3D world learns anything. The
 * island has no independent opinion about what an agent is doing - it renders
 * the last event it received for that agent and nothing else.
 *
 * Two consequences worth stating, because both are easy to get wrong later:
 *
 *  1. Every event carries `seq`, monotonic per goal. A client that reconnects
 *     sends the last `seq` it saw and receives the gap. Out-of-order arrivals
 *     are dropped, not applied, so a stale packet can never resurrect a
 *     finished agent.
 *
 *  2. Events are facts about the past, never instructions to the UI. There is
 *     no `camera.focus` event. The backend reports that an agent started
 *     working; whether that moves the camera is the client's business.
 */

const agentStateSchema = z.enum(AGENT_STATES)
const taskStateSchema = z.enum(TASK_STATES)
const goalStateSchema = z.enum(GOAL_STATES)

const baseEvent = z.object({
  /** Monotonic within a goal. The client's ordering and gap-detection key. */
  seq: z.number().int().nonnegative(),
  goalId: z.string(),
  workspaceId: z.string(),
  /** Server clock, ISO 8601. Never trust a client's clock for ordering. */
  at: z.string(),
})

export const goalStateChangedSchema = baseEvent.extend({
  type: z.literal('goal.state_changed'),
  state: goalStateSchema,
  /** Present only on terminal failure. Written for a person to read. */
  error: z.string().nullable().default(null),
})

export const planCreatedSchema = baseEvent.extend({
  type: z.literal('plan.created'),
  planId: z.string(),
  /** The Orchestrator's reading of the goal, shown on the planning screen. */
  interpretation: z.string(),
  tasks: z.array(
    z.object({
      taskId: z.string(),
      title: z.string(),
      agentKey: z.string(),
      dependsOn: z.array(z.string()),
    }),
  ),
})

export const taskStateChangedSchema = baseEvent.extend({
  type: z.literal('task.state_changed'),
  taskId: z.string(),
  state: taskStateSchema,
  error: z.string().nullable().default(null),
})

/**
 * An agent changed state. The single most important event in the system:
 * this is what makes a robot stand up and start working.
 */
export const agentStateChangedSchema = baseEvent.extend({
  type: z.literal('agent.state_changed'),
  agentKey: z.string(),
  /** Null when idle - an idle agent is not attached to any task. */
  taskId: z.string().nullable(),
  state: agentStateSchema,
  /** Plain language, shown on the island label and in the detail panel. */
  activity: z.string(),
  error: z.string().nullable().default(null),
})

/**
 * Progress on a running task.
 *
 * `confidence` is load-bearing, not decoration. 'measured' means steps the
 * backend actually completed. 'estimated' means we are interpolating for
 * smoothness, and the UI must render it differently - otherwise the product
 * is quietly lying about how far along it is.
 */
export const taskProgressSchema = baseEvent.extend({
  type: z.literal('task.progress'),
  taskId: z.string(),
  agentKey: z.string(),
  completedSteps: z.number().int().nonnegative(),
  totalSteps: z.number().int().positive().nullable(),
  confidence: z.enum(['measured', 'estimated']),
  note: z.string().nullable().default(null),
})

/** A tool was invoked. Feeds the Activity tab and the audit trail. */
export const toolCalledSchema = baseEvent.extend({
  type: z.literal('tool.called'),
  taskId: z.string(),
  agentKey: z.string(),
  toolId: z.string(),
  /** Human summary of the call. Never the raw arguments - those can hold PII. */
  summary: z.string(),
  outcome: z.enum(['succeeded', 'failed', 'denied']),
})

/** An agent hit a consequential action and stopped. The user must decide. */
export const approvalRequestedSchema = baseEvent.extend({
  type: z.literal('approval.requested'),
  approvalId: z.string(),
  taskId: z.string(),
  agentKey: z.string(),
  actionType: z.string(),
  /** What will happen if approved, in plain words. */
  description: z.string(),
  /** The exact content that would go out, for the user to read before saying yes. */
  preview: z.string().nullable().default(null),
})

export const approvalResolvedSchema = baseEvent.extend({
  type: z.literal('approval.resolved'),
  approvalId: z.string(),
  taskId: z.string(),
  decision: z.enum(['approved', 'rejected']),
  /** Whether the user also chose "don't ask again" for this action type. */
  remembered: z.boolean(),
})

/** The final synthesised answer. */
export const goalCompletedSchema = baseEvent.extend({
  type: z.literal('goal.completed'),
  summary: z.string(),
  artifacts: z.array(
    z.object({
      artifactId: z.string(),
      title: z.string(),
      kind: z.enum(['summary', 'report', 'draft', 'file']),
    }),
  ),
})

export const worldEventSchema = z.discriminatedUnion('type', [
  goalStateChangedSchema,
  planCreatedSchema,
  taskStateChangedSchema,
  agentStateChangedSchema,
  taskProgressSchema,
  toolCalledSchema,
  approvalRequestedSchema,
  approvalResolvedSchema,
  goalCompletedSchema,
])

export type WorldEvent = z.infer<typeof worldEventSchema>
export type WorldEventType = WorldEvent['type']

export type AgentStateChangedEvent = z.infer<typeof agentStateChangedSchema>
export type PlanCreatedEvent = z.infer<typeof planCreatedSchema>
export type ApprovalRequestedEvent = z.infer<typeof approvalRequestedSchema>

/** Parse an inbound frame. Returns null rather than throwing on a bad frame. */
export function parseWorldEvent(raw: unknown): WorldEvent | null {
  const parsed = worldEventSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Client -> server. Deliberately tiny: clients ask, they do not command. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    goalId: z.string(),
    /** Last seq the client applied. The server replays everything after it. */
    sinceSeq: z.number().int().nonnegative().default(0),
  }),
  z.object({ type: z.literal('unsubscribe'), goalId: z.string() }),
  z.object({ type: z.literal('ping') }),
])

export type ClientMessage = z.infer<typeof clientMessageSchema>
