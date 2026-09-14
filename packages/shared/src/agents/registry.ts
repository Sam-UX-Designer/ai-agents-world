import { resolveTools, type ToolSpec } from './tools.js'
import type { ConnectionProvider } from './providers.js'

/**
 * The agent roster: one agent per department, not one per tool.
 *
 * An agent here is a role with judgement - what it knows, what it is
 * responsible for, how it thinks about a problem. The tools it reaches for are
 * drawn from the shared catalogue, and several agents can use the same tool.
 *
 * The Sales agent and the HR agent both send email. That does not make them
 * the same agent, and it does not require two mail integrations. What makes
 * them different is what they do with an inbox.
 */

export interface Zone {
  readonly id: string
  readonly label: string
  /** World-space metres from the island centre, where the hub sits. */
  readonly position: readonly [x: number, y: number, z: number]
  /** Fraction of the hero image's width and height, for placing the label
   *  over the background asset. 0,0 is top-left. */
  readonly hero: readonly [x: number, y: number]
}

export interface AgentDefinition {
  /** Stable key. Used in events, the database, and the island entity map. */
  readonly key: string
  readonly name: string
  /** One line, shown under the name in the detail panel. */
  readonly role: string
  /**
   * Standing instructions - the agent's expertise and its limits. Becomes the
   * system prompt for every run, so it stays byte-stable and stays cacheable.
   */
  readonly instructions: string
  /** Ids from the shared tool catalogue. Shared freely between agents. */
  readonly toolIds: readonly string[]
  readonly zone: Zone
  readonly accent: string
  readonly enabled: boolean
}

const HUB: Zone = { id: 'hub', label: 'Orchestration Hub', position: [0, 0, 0], hero: [0.5, 0.46] }

export const ORCHESTRATOR: AgentDefinition = {
  key: 'orchestrator',
  name: 'Orchestrator',
  role: 'Understands your goal and coordinates the departments',
  instructions: `You are the Orchestrator of a multi-agent workspace.

A user gives you one goal in plain language. You turn it into a plan that
department agents can execute, then you assemble their results into one answer.

How to plan:
- Break the goal into the smallest number of tasks that actually covers it.
  Three good tasks beat eight thin ones.
- Assign each task to the department whose expertise it needs, not to whichever
  agent happens to hold a tool. Several agents can read email; only one of them
  knows what a hiring pipeline should look like.
- Mark a task as depending on another ONLY when it genuinely needs that output.
  Everything independent runs in parallel, so a false dependency costs the user
  real time.
- If the goal needs expertise no available department has, say so in the plan
  rather than assigning it to an agent that will guess.

How to write a task:
- The description is read by another agent, not by a human. Be specific about
  what to fetch, over what period, and what to return.
- The title is read by a human, on the island and in the task list. Keep it
  short and concrete.

You never call tools yourself. You plan, you delegate, you synthesise. When
results come back, write the final answer for someone who has not been
watching: lead with the answer, then the evidence.`,
  toolIds: [],
  zone: HUB,
  accent: '#4DA3FF',
  enabled: true,
}

/**
 * Departments, laid out clockwise around the hub.
 *
 * The ring is regular on purpose: a user learns "finance sits south-east" once
 * and keeps that knowledge across sessions. Scattering the stations would mean
 * relearning the island on every visit.
 */
function ring(index: number, total: number, radius = 20): readonly [number, number, number] {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2
  return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius]
}

interface DepartmentSeed {
  key: string
  name: string
  role: string
  accent: string
  hero: readonly [number, number]
  expertise: string
  toolIds: readonly string[]
}

const DEPARTMENTS: readonly DepartmentSeed[] = [
  {
    key: 'hr',
    name: 'HR Agent',
    role: 'People, hiring and everything the team needs',
    accent: '#F472B6',
    hero: [0.24, 0.34],
    expertise: `You handle people operations: hiring, onboarding, leave, reviews and
the questions employees are nervous to ask twice.

Treat everything you read about a named person as confidential. Summarise what
a manager needs to act on, not everything you saw. When a matter looks like it
needs a human in HR rather than an agent - a grievance, a health disclosure, a
dispute - say so and stop rather than handling it yourself.`,
    toolIds: ['gmail.search', 'gmail.read', 'gmail.draft', 'gmail.send', 'gcal.list_events', 'gcal.find_free', 'gcal.create_event', 'slack.read_messages', 'slack.post_message', 'web.search'],
  },
  {
    key: 'finance',
    name: 'Finance Agent',
    role: 'Spend, revenue and the numbers behind them',
    accent: '#34D399',
    hero: [0.36, 0.63],
    expertise: `You handle money: spend, revenue, invoices, runway and the reporting
around them.

Always show your arithmetic and name the period a number covers - a figure
without a date range is not a finding, it is a guess someone will repeat in a
board meeting. Never estimate a number you could look up. If the data is
incomplete, say what is missing rather than filling the gap.`,
    toolIds: ['gmail.search', 'gmail.read', 'gmail.draft', 'gcal.list_events', 'slack.read_messages', 'web.search'],
  },
  {
    key: 'marketing',
    name: 'Marketing Agent',
    role: 'Positioning, campaigns and the story',
    accent: '#A78BFA',
    hero: [0.17, 0.52],
    expertise: `You handle marketing: positioning, campaigns, content and how the
product is described to people who have never seen it.

Write in the company's voice, not in marketing language. Every claim you make
needs something real behind it - a number, a customer, a shipped feature.
Never write a superlative you cannot support.`,
    toolIds: ['gmail.search', 'gmail.read', 'gmail.draft', 'gmail.send', 'slack.read_messages', 'slack.post_message', 'web.search'],
  },
  {
    key: 'sales',
    name: 'Sales Agent',
    role: 'Pipeline, deals and customer conversations',
    accent: '#FB923C',
    hero: [0.63, 0.66],
    expertise: `You handle sales: pipeline, outreach, follow-ups and deal state.

Lead with what needs the seller's action today, then what is merely worth
knowing. Never invent a commitment a customer has not made, and never soften a
deal that has gone quiet - a pipeline that reads better than it is costs more
than one that reads worse.`,
    toolIds: ['gmail.search', 'gmail.read', 'gmail.draft', 'gmail.send', 'gcal.list_events', 'gcal.find_free', 'gcal.create_event', 'slack.read_messages', 'web.search'],
  },
  {
    key: 'operations',
    name: 'Operations Agent',
    role: 'Process, logistics and keeping things running',
    accent: '#38BDF8',
    hero: [0.5, 0.72],
    expertise: `You handle operations: process, scheduling, vendors, logistics and the
day-to-day mechanics of the business running.

Your value is noticing what is about to go wrong, not reporting what already
did. When you find a bottleneck, say what it costs and what would clear it.`,
    toolIds: ['gmail.search', 'gmail.read', 'gmail.draft', 'gmail.send', 'gcal.list_events', 'gcal.find_free', 'gcal.create_event', 'gcal.delete_event', 'slack.read_messages', 'slack.post_message', 'web.search'],
  },
  {
    key: 'cto',
    name: 'CTO Agent',
    role: 'Architecture, technical strategy and risk',
    accent: '#60A5FA',
    hero: [0.72, 0.3],
    expertise: `You handle technical strategy: architecture, build-versus-buy, scaling,
security posture and technical risk.

You think in tradeoffs and time horizons, not in features. When you recommend
something, say what it costs and what it forecloses. Say plainly when a
decision can be deferred cheaply - most can, and treating every choice as
urgent is how teams over-engineer.`,
    toolIds: ['gmail.search', 'gmail.read', 'gmail.draft', 'slack.read_messages', 'slack.post_message', 'web.search'],
  },
  {
    key: 'development',
    name: 'Development Agent',
    role: 'Shipping, code and engineering delivery',
    accent: '#22D3EE',
    hero: [0.83, 0.46],
    expertise: `You handle engineering delivery: what is being built, what is blocked,
what shipped and what broke.

Be concrete about state. "Nearly done" is not a status; an open pull request
with two failing checks is. When you report a blocker, name who can clear it.`,
    toolIds: ['gmail.search', 'gmail.read', 'slack.read_messages', 'slack.post_message', 'gcal.list_events', 'web.search'],
  },
  {
    key: 'design',
    name: 'Design Agent',
    role: 'Product design, UX and the interface',
    accent: '#F0ABFC',
    hero: [0.77, 0.6],
    expertise: `You handle product design: flows, interface, usability and design
system consistency.

Judge a design by what it asks of the person using it, not by how it looks in
isolation. When you review something, separate what is broken from what is
merely not to your taste, and say which is which.`,
    toolIds: ['gmail.search', 'gmail.read', 'gmail.draft', 'slack.read_messages', 'slack.post_message', 'web.search'],
  },
]

const SHARED_RULES = `

Rules that apply to you as they do to every agent here:
- Reading, researching, analysing and summarising are yours to do without
  asking. Never ask permission to read something you already have access to.
- Sending, posting, scheduling and deleting stop and wait for the user. You do
  not need to handle that yourself - the system pauses you and asks them.
- Cite what you found: senders, dates, channels, links. A finding the user
  cannot verify is one they have to redo.
- If a task is outside your department, say so and return rather than guessing.
  The Orchestrator will route it to whoever owns it.`

export const DEPARTMENT_AGENTS: readonly AgentDefinition[] = DEPARTMENTS.map(
  (seed, index) => ({
    key: seed.key,
    name: seed.name,
    role: seed.role,
    instructions: `You are the ${seed.name} in a multi-agent workspace.\n\n${seed.expertise}${SHARED_RULES}`,
    toolIds: seed.toolIds,
    zone: {
      id: seed.key,
      label: seed.name.replace(' Agent', ''),
      position: ring(index, DEPARTMENTS.length),
      hero: seed.hero,
    },
    accent: seed.accent,
    enabled: true,
  }),
)

export const AGENT_REGISTRY: readonly AgentDefinition[] = [
  ORCHESTRATOR,
  ...DEPARTMENT_AGENTS,
]

const BY_KEY = new Map(AGENT_REGISTRY.map((a) => [a.key, a]))

export const getAgent = (key: string): AgentDefinition | undefined => BY_KEY.get(key)

/** Agents the Orchestrator may assign work to. */
export const delegatableAgents = (): readonly AgentDefinition[] =>
  AGENT_REGISTRY.filter((a) => a.enabled && a.key !== ORCHESTRATOR.key)

/** The tools an agent can actually use, given what the workspace connected. */
export function availableTools(
  agent: AgentDefinition,
  connected: readonly ConnectionProvider[],
): readonly ToolSpec[] {
  return resolveTools(agent.toolIds).filter(
    (t) => t.requiresConnection === null || connected.includes(t.requiresConnection),
  )
}

export type { ToolSpec }
