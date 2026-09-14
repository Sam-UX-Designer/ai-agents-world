import type { ToolEffect } from '../domain/permissions.js'
import type { ConnectionProvider } from './providers.js'

/**
 * The shared tool catalogue.
 *
 * Tools are infrastructure, not identity. Gmail is not an agent - it is a
 * capability that the HR agent, the Sales agent and the Orchestrator can all
 * reach when their task needs it.
 *
 * Defining tools per agent instead would mean one "Gmail Agent" that owns the
 * mailbox and cannot do HR work, and an HR agent that cannot send a single
 * email. Every new tool would then need a new agent, every new department a
 * duplicate set of tools, and the roster would grow as the product of the two.
 * One catalogue, referenced by id, keeps that from happening.
 */

export interface ToolSpec {
  /** Stable id. Also the audit key and the approval action type. */
  readonly id: string
  /** Shown in the agent detail panel under "Tools". */
  readonly label: string
  /** Decides autonomous-or-ask. See domain/permissions.ts. */
  readonly effect: ToolEffect
  /** Which integration must be connected for this tool to exist. */
  readonly requiresConnection: ConnectionProvider | null
  /** One line for the model, so it knows when to reach for this. */
  readonly description: string
}

export const TOOL_CATALOGUE: readonly ToolSpec[] = [
  // ------------------------------------------------------------- messaging --
  { id: 'gmail.search', label: 'Search mail', effect: 'read', requiresConnection: 'google', description: 'Search the mailbox with Gmail query syntax.' },
  { id: 'gmail.read', label: 'Read a message', effect: 'read', requiresConnection: 'google', description: 'Read one message in full.' },
  { id: 'gmail.draft', label: 'Draft a reply', effect: 'draft', requiresConnection: 'google', description: 'Save a draft. Nothing is sent.' },
  { id: 'gmail.send', label: 'Send mail', effect: 'external_send', requiresConnection: 'google', description: 'Send an email. Always needs approval.' },
  { id: 'slack.list_channels', label: 'List channels', effect: 'read', requiresConnection: 'slack', description: 'List Slack channels the user belongs to.' },
  { id: 'slack.read_messages', label: 'Read a channel', effect: 'read', requiresConnection: 'slack', description: 'Read recent messages in a channel.' },
  { id: 'slack.summarise_thread', label: 'Read a thread', effect: 'analyse', requiresConnection: 'slack', description: 'Read every message in one thread.' },
  { id: 'slack.post_message', label: 'Post to Slack', effect: 'external_send', requiresConnection: 'slack', description: 'Post a message. Always needs approval.' },

  // -------------------------------------------------------------- schedule --
  { id: 'gcal.list_events', label: 'Check the calendar', effect: 'read', requiresConnection: 'google', description: 'List events between two times.' },
  { id: 'gcal.find_free', label: 'Find free time', effect: 'analyse', requiresConnection: 'google', description: 'Find gaps in a time window.' },
  { id: 'gcal.create_event', label: 'Create an event', effect: 'external_write', requiresConnection: 'google', description: 'Create an event and invite attendees. Needs approval.' },
  { id: 'gcal.delete_event', label: 'Delete an event', effect: 'destructive', requiresConnection: 'google', description: 'Delete an event. Always needs approval.' },

  // -------------------------------------------------------------- research --
  { id: 'web.search', label: 'Search the web', effect: 'read', requiresConnection: null, description: 'Search the public web. No account needed.' },
]

const BY_ID = new Map(TOOL_CATALOGUE.map((t) => [t.id, t]))

export const getTool = (id: string): ToolSpec | undefined => BY_ID.get(id)

/** Resolve a list of tool ids to specs, dropping any that do not exist. */
export function resolveTools(ids: readonly string[]): readonly ToolSpec[] {
  return ids.map((id) => BY_ID.get(id)).filter((t): t is ToolSpec => t !== undefined)
}
