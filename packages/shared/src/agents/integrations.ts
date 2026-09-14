import { TOOL_CATALOGUE, type ToolSpec } from './tools.js'
import type { ConnectionProvider } from './providers.js'
import { AGENT_REGISTRY } from './registry.js'
import { isAutonomous, requiresApprovalAlways } from '../domain/permissions.js'

/**
 * The integration catalogue.
 *
 * An integration is a service a workspace connects - Gmail, Slack, Figma. It
 * owns no behaviour of its own: what it actually grants is a set of
 * capabilities drawn from the shared tool catalogue, and agents reach those
 * capabilities through their own permissions.
 *
 * Keeping the two apart is what stops a "Gmail Agent" appearing. Gmail is a
 * capability; an agent is something that uses capabilities. One integration
 * serves many agents, and one agent draws on many integrations.
 *
 * Adding an integration is one entry here. Nothing else in the product needs
 * to know it exists.
 */

export const INTEGRATION_CATEGORIES = [
  'Productivity',
  'Communication',
  'Storage',
  'Design',
  'Marketing',
  'Development',
  'Finance',
  'Analytics',
  'Other',
] as const

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number]

export type IntegrationStatus =
  /** OAuth is implemented; Connect completes a real authorisation. */
  | 'available'
  /** Listed so the roadmap is visible, but Connect cannot complete yet. */
  | 'planned'

export interface Integration {
  /** Stable id. Also the icon filename: /tools/<id>.png */
  readonly id: string
  readonly name: string
  /** One line on the card. Written for someone deciding whether to connect. */
  readonly description: string
  readonly category: IntegrationCategory
  /**
   * The OAuth provider that authorises it. Several integrations can share one
   * provider - Gmail, Calendar and Drive are all Google - so connecting once
   * lights up all three.
   */
  readonly provider: ConnectionProvider | null
  /** Capability ids from the shared tool catalogue. */
  readonly toolIds: readonly string[]
  readonly status: IntegrationStatus
  /** Why, when status is not 'available'. Shown on the card. */
  readonly statusNote: string | null
}

export const INTEGRATIONS: readonly Integration[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Send, read and manage emails.',
    category: 'Communication',
    provider: 'google',
    toolIds: ['gmail.search', 'gmail.read', 'gmail.draft', 'gmail.send'],
    status: 'available',
    statusNote: null,
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Manage your schedule and events.',
    category: 'Productivity',
    provider: 'google',
    toolIds: ['gcal.list_events', 'gcal.find_free', 'gcal.create_event', 'gcal.delete_event'],
    status: 'available',
    statusNote: null,
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Team communication and collaboration.',
    category: 'Communication',
    provider: 'slack',
    toolIds: [
      'slack.list_channels',
      'slack.read_messages',
      'slack.summarise_thread',
      'slack.post_message',
    ],
    status: 'available',
    statusNote: null,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Store and access files.',
    category: 'Storage',
    provider: 'google',
    toolIds: [],
    status: 'planned',
    statusNote: 'Drive capabilities are not built yet.',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read and write to your workspace.',
    category: 'Productivity',
    provider: null,
    toolIds: [],
    status: 'planned',
    statusNote: 'Arrives with the documents capabilities.',
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Create and manage design files.',
    category: 'Design',
    provider: null,
    toolIds: [],
    status: 'planned',
    statusNote: 'Not built yet.',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Manage repositories and code.',
    category: 'Development',
    provider: null,
    toolIds: [],
    status: 'planned',
    statusNote: 'Not built yet.',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Track and manage product issues.',
    category: 'Productivity',
    provider: null,
    toolIds: [],
    status: 'planned',
    statusNote: 'Not built yet.',
  },
  {
    id: 'meta',
    name: 'Meta',
    description: 'Manage ads and social media.',
    category: 'Marketing',
    provider: null,
    toolIds: [],
    status: 'planned',
    statusNote: 'Requires Meta Business review.',
  },
  {
    id: 'x',
    name: 'X',
    description: 'Post and manage content.',
    category: 'Marketing',
    provider: null,
    toolIds: [],
    status: 'planned',
    statusNote: 'Not built yet.',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Upload and manage videos.',
    category: 'Marketing',
    provider: null,
    toolIds: [],
    status: 'planned',
    statusNote: 'Not built yet.',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Manage CRM and marketing.',
    category: 'Marketing',
    provider: null,
    toolIds: [],
    status: 'planned',
    statusNote: 'Not built yet.',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    description: 'Manage customer data.',
    category: 'Finance',
    provider: null,
    toolIds: [],
    status: 'planned',
    statusNote: 'Not built yet.',
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Organize and manage data.',
    category: 'Productivity',
    provider: null,
    toolIds: [],
    status: 'planned',
    statusNote: 'Not built yet.',
  },
  {
    id: 'zapier',
    name: 'Zapier',
    description: 'Automate workflows between apps.',
    category: 'Other',
    provider: null,
    toolIds: [],
    status: 'planned',
    statusNote: 'Not built yet.',
  },
]

const BY_ID = new Map(INTEGRATIONS.map((i) => [i.id, i]))

export const getIntegration = (id: string): Integration | undefined => BY_ID.get(id)

/** Icon path. Uploaded to apps/web/public/tools/ by the product owner. */
export const integrationIcon = (id: string): string => `/tools/${id}.png`

// ------------------------------------------------------------ permissions --

/**
 * What an integration lets an agent do, split the way a person thinks about
 * it rather than the way the code does.
 *
 * Connecting a service is not the same as handing every agent unlimited use
 * of it, and this is where that distinction becomes visible: the read list is
 * what happens silently, the approval list is what will stop and ask.
 */
export type PermissionKind = 'read' | 'write' | 'approval'

export interface Permission {
  readonly toolId: string
  readonly label: string
  readonly kind: PermissionKind
  readonly description: string
}

export function permissionsFor(integration: Integration): readonly Permission[] {
  return capabilitiesFor(integration).map((tool) => ({
    toolId: tool.id,
    label: tool.label,
    kind: permissionKind(tool),
    description: tool.description,
  }))
}

function permissionKind(tool: ToolSpec): PermissionKind {
  if (requiresApprovalAlways(tool.effect)) return 'approval'
  if (isAutonomous(tool.effect)) {
    // A draft is written, but it is written inside the workspace and has not
    // reached anyone - so it belongs with reading, not with sending.
    return tool.effect === 'draft' ? 'write' : 'read'
  }
  return 'approval'
}

/** The capabilities this integration contributes to the catalogue. */
export function capabilitiesFor(integration: Integration): readonly ToolSpec[] {
  return integration.toolIds
    .map((id) => TOOL_CATALOGUE.find((t) => t.id === id))
    .filter((t): t is ToolSpec => t !== undefined)
}

// -------------------------------------------------------- connected agents --

export interface AgentAccess {
  readonly agentKey: string
  readonly agentName: string
  readonly accent: string
  /** How many of this integration's capabilities the agent may reach. */
  readonly grantedCount: number
  readonly totalCount: number
  /** The strongest thing it can do: read-only, can draft, or can act outward. */
  readonly level: 'read' | 'write' | 'act'
}

/**
 * Which agents can reach this integration, and how far.
 *
 * Derived from each agent's own tool grants rather than stored separately, so
 * the answer cannot drift from what the runtime will actually permit.
 */
export function agentsWithAccess(integration: Integration): readonly AgentAccess[] {
  const capabilities = capabilitiesFor(integration)
  if (capabilities.length === 0) return []

  return AGENT_REGISTRY.flatMap((agent) => {
    const granted = capabilities.filter((c) => agent.toolIds.includes(c.id))
    if (granted.length === 0) return []

    const level: AgentAccess['level'] = granted.some(
      (g) => !isAutonomous(g.effect),
    )
      ? 'act'
      : granted.some((g) => g.effect === 'draft')
        ? 'write'
        : 'read'

    return [{
      agentKey: agent.key,
      agentName: agent.name,
      accent: agent.accent,
      grantedCount: granted.length,
      totalCount: capabilities.length,
      level,
    }]
  })
}
