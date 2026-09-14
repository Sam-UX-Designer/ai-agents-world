import type { ToolEffect } from '../domain/permissions.js'

/**
 * The agent roster.
 *
 * One entry describes an agent completely: who it is, what it may touch, what
 * it is told, and where it stands on the island. The backend reads this to
 * build a runtime; the 3D world reads the same entry to place and label the
 * robot. They cannot drift apart because there is only one of them.
 */

/** A capability an agent can use, and what using it does. */
export interface ToolSpec {
  /** Stable id. Also the audit key and the approval `actionType`. */
  readonly id: string
  /** Shown in the agent detail panel under "Connected Tools". */
  readonly label: string
  /** Decides autonomously-or-ask. See domain/permissions.ts. */
  readonly effect: ToolEffect
  /** Which integration must be connected for this tool to exist. */
  readonly requiresConnection: ConnectionProvider | null
}

export const CONNECTION_PROVIDERS = ['google', 'slack'] as const
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number]

/**
 * Where an agent lives on the island.
 *
 * Zones are fixed, not scattered: a user learns "finance is the south-east
 * headland" once and keeps that knowledge. `position` is world-space metres
 * from the island centre, which is where the Orchestrator hub sits.
 */
export interface Zone {
  readonly id: string
  readonly label: string
  readonly position: readonly [x: number, y: number, z: number]
}

export interface AgentDefinition {
  /** Stable key. Used in events, the DB, and the 3D entity map. */
  readonly key: string
  readonly name: string
  /** One line, shown under the name in the detail panel. */
  readonly role: string
  /**
   * The agent's standing instructions - its character and its limits.
   * Becomes the system prompt for every run. Per-task detail is appended
   * at dispatch, so this stays byte-stable and stays cacheable.
   */
  readonly instructions: string
  readonly tools: readonly ToolSpec[]
  readonly zone: Zone
  /** Accent colour for its label, path and station lighting. */
  readonly accent: string
  /** False until its phase ships. Present on the island, greyed out. */
  readonly enabled: boolean
}

const ORCHESTRATOR_ZONE: Zone = {
  id: 'hub',
  label: 'Orchestration Hub',
  position: [0, 0, 0],
}

export const ORCHESTRATOR: AgentDefinition = {
  key: 'orchestrator',
  name: 'Orchestrator',
  role: 'Understands your goal and coordinates the other agents',
  instructions: `You are the Orchestrator of a multi-agent workspace.

A user gives you one goal in plain language. You turn it into a plan that
specialist agents can execute, then you assemble their results into one answer.

How to plan:
- Break the goal into the smallest number of tasks that actually covers it.
  Three good tasks beat eight thin ones.
- Assign each task to exactly one agent, chosen by capability.
- Mark a task as depending on another ONLY when it genuinely needs that
  output. Everything independent runs in parallel, so a false dependency
  costs the user real time.
- If the goal needs a capability no available agent has, say so in the plan
  rather than assigning it to an agent that will fail.

How to write a task:
- The description is read by another agent, not by a human. Be specific about
  what to fetch, over what period, and what to return.
- The title is read by a human, on the island and in the task list. Keep it
  short and concrete: "Check tomorrow's calendar", not "Calendar processing".

You never call integration tools yourself. You plan, you delegate, you
synthesise. When results come back, write the final answer for a person who
has not been watching: lead with the answer, then the evidence.`,
  tools: [],
  zone: ORCHESTRATOR_ZONE,
  accent: '#4DA3FF',
  enabled: true,
}

export const EMAIL_AGENT: AgentDefinition = {
  key: 'email',
  name: 'Email Agent',
  role: 'Reads, triages and drafts your mail',
  instructions: `You are the Email Agent. You work with the user's Gmail.

You read and triage mail autonomously - that needs no permission and you
should never ask for it. You may draft replies freely; a draft lives inside
this workspace and has not reached anyone.

Sending is different. You never send without explicit human approval, and you
never treat a user's general enthusiasm as approval for a specific message.

When you summarise mail, lead with what needs the user's action, then what
merely needs their awareness. Always cite the sender and subject so the user
can verify you without opening their inbox.`,
  tools: [
    { id: 'gmail.search', label: 'Search mail', effect: 'read', requiresConnection: 'google' },
    { id: 'gmail.read', label: 'Read a message', effect: 'read', requiresConnection: 'google' },
    { id: 'gmail.draft', label: 'Draft a reply', effect: 'draft', requiresConnection: 'google' },
    { id: 'gmail.send', label: 'Send mail', effect: 'external_send', requiresConnection: 'google' },
  ],
  zone: { id: 'comms', label: 'Communications', position: [-18, 0, -6] },
  accent: '#EA4335',
  enabled: true,
}

export const CALENDAR_AGENT: AgentDefinition = {
  key: 'calendar',
  name: 'Calendar Agent',
  role: 'Checks your schedule and finds time',
  instructions: `You are the Calendar Agent. You work with the user's Google Calendar.

Reading the schedule and reasoning about it is autonomous. Creating, moving or
cancelling an event is not: other people are invited to those events, so every
write waits for approval.

Always state times in the user's own timezone and say which timezone that is.
When you report a day, include what is notable about it - the back-to-back
stretch, the gap, the thing that clashes - not just a list of rows.`,
  tools: [
    { id: 'gcal.list_events', label: 'List events', effect: 'read', requiresConnection: 'google' },
    { id: 'gcal.find_free', label: 'Find free time', effect: 'analyse', requiresConnection: 'google' },
    { id: 'gcal.create_event', label: 'Create an event', effect: 'external_write', requiresConnection: 'google' },
    { id: 'gcal.delete_event', label: 'Delete an event', effect: 'destructive', requiresConnection: 'google' },
  ],
  zone: { id: 'schedule', label: 'Scheduling', position: [16, 0, -12] },
  accent: '#4285F4',
  enabled: true,
}

export const SLACK_AGENT: AgentDefinition = {
  key: 'slack',
  name: 'Slack Agent',
  role: 'Catches you up on conversations',
  instructions: `You are the Slack Agent. You work with the user's Slack workspace.

Reading channels and threads the user already has access to is autonomous.
Posting is not - a Slack message is visible to colleagues the moment it lands,
so every post waits for approval.

When you catch someone up, separate what was directed at them from what merely
happened near them. Name the channel and the people involved, and link the
thread so they can read it themselves.`,
  tools: [
    { id: 'slack.list_channels', label: 'List channels', effect: 'read', requiresConnection: 'slack' },
    { id: 'slack.read_messages', label: 'Read messages', effect: 'read', requiresConnection: 'slack' },
    { id: 'slack.summarise_thread', label: 'Summarise a thread', effect: 'analyse', requiresConnection: 'slack' },
    { id: 'slack.post_message', label: 'Post a message', effect: 'external_send', requiresConnection: 'slack' },
  ],
  zone: { id: 'chat', label: 'Team Chat', position: [4, 0, 20] },
  accent: '#611F69',
  enabled: true,
}

/** Phase 1. Expands to Finance, Research, CRM and Documents once stable. */
export const AGENT_REGISTRY: readonly AgentDefinition[] = [
  ORCHESTRATOR,
  EMAIL_AGENT,
  CALENDAR_AGENT,
  SLACK_AGENT,
]

const BY_KEY = new Map(AGENT_REGISTRY.map((a) => [a.key, a]))

export const getAgent = (key: string): AgentDefinition | undefined =>
  BY_KEY.get(key)

/** Agents the Orchestrator is allowed to assign work to. */
export const delegatableAgents = (): readonly AgentDefinition[] =>
  AGENT_REGISTRY.filter((a) => a.enabled && a.key !== ORCHESTRATOR.key)

/** Every tool an agent has, given which integrations are actually connected. */
export function availableTools(
  agent: AgentDefinition,
  connected: readonly ConnectionProvider[],
): readonly ToolSpec[] {
  return agent.tools.filter(
    (t) => t.requiresConnection === null || connected.includes(t.requiresConnection),
  )
}
