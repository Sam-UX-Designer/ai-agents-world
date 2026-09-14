import type Anthropic from '@anthropic-ai/sdk'
import {
  availableTools,
  type AgentDefinition,
  type ConnectionProvider,
  type ToolEffect,
} from '@agents-world/shared'
import * as google from '../tools/google.js'
import * as slack from '../tools/slack.js'

/**
 * The bridge between the agent registry and real API calls.
 *
 * An agent's tools come from one place - the registry - and are turned into
 * Claude tool definitions here. If a tool is not in the registry entry for
 * this agent, it does not exist for this agent: there is no ambient access
 * and no shared toolbox.
 */

export interface ToolContext {
  readonly workspaceId: string
  readonly timezone: string
}

export interface ToolBinding {
  /** Registry id, e.g. "gmail.send". The audit key and approval action type. */
  readonly toolId: string
  /** Claude requires [a-zA-Z0-9_-], so dots become underscores. */
  readonly claudeName: string
  readonly effect: ToolEffect
  readonly definition: Anthropic.Tool
  readonly run: (ctx: ToolContext, input: Record<string, unknown>) => Promise<unknown>
}

const claudeName = (toolId: string): string => toolId.replace(/\./g, '_')

const str = (description: string) => ({ type: 'string' as const, description })

/**
 * Every tool the system can perform.
 *
 * Keyed by registry id so the registry stays the single source of truth for
 * which agent may reach which capability. An entry here without a matching
 * registry entry is unreachable, which is the safe direction for a mistake.
 */
const IMPLEMENTATIONS: Record<
  string,
  {
    description: string
    schema: Anthropic.Tool['input_schema']
    run: (ctx: ToolContext, input: Record<string, unknown>) => Promise<unknown>
  }
> = {
  'gmail.search': {
    description:
      'Search the mailbox using Gmail search syntax. Returns message summaries, ' +
      'newest first. Example queries: "is:unread newer_than:7d", "from:boss@co.com".',
    schema: {
      type: 'object',
      properties: {
        query: str('Gmail search query, e.g. "is:unread newer_than:7d"'),
        maxResults: { type: 'number', description: 'Up to 50. Defaults to 20.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: (ctx, input) =>
      google.searchMessages(
        ctx.workspaceId,
        String(input.query),
        typeof input.maxResults === 'number' ? input.maxResults : 20,
      ),
  },

  'gmail.read': {
    description: 'Read one message in full, including its decoded body text.',
    schema: {
      type: 'object',
      properties: { messageId: str('Message id from gmail.search') },
      required: ['messageId'],
      additionalProperties: false,
    },
    run: (ctx, input) => google.readMessage(ctx.workspaceId, String(input.messageId)),
  },

  'gmail.draft': {
    description:
      'Save a draft reply. The draft stays in the user\'s Drafts folder and is ' +
      'not sent. Use this whenever you have written a reply - never send directly.',
    schema: {
      type: 'object',
      properties: {
        to: str('Recipient email address'),
        subject: str('Subject line'),
        body: str('Plain text body'),
        threadId: str('Thread id, to keep the draft in an existing conversation'),
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: false,
    },
    run: (ctx, input) =>
      google.createDraft(ctx.workspaceId, {
        to: String(input.to),
        subject: String(input.subject),
        body: String(input.body),
        ...(input.threadId ? { threadId: String(input.threadId) } : {}),
      }),
  },

  'gmail.send': {
    description:
      'Send an email. This reaches the recipient immediately and cannot be undone, ' +
      'so it always waits for the user to approve it first.',
    schema: {
      type: 'object',
      properties: {
        to: str('Recipient email address'),
        subject: str('Subject line'),
        body: str('Plain text body'),
        threadId: str('Thread id, to reply within an existing conversation'),
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: false,
    },
    run: (ctx, input) =>
      google.sendMessage(ctx.workspaceId, {
        to: String(input.to),
        subject: String(input.subject),
        body: String(input.body),
        ...(input.threadId ? { threadId: String(input.threadId) } : {}),
      }),
  },

  'gcal.list_events': {
    description:
      'List calendar events between two times. Both bounds are ISO 8601. ' +
      'Recurring series are expanded into individual occurrences.',
    schema: {
      type: 'object',
      properties: {
        timeMin: str('Window start, ISO 8601'),
        timeMax: str('Window end, ISO 8601'),
      },
      required: ['timeMin', 'timeMax'],
      additionalProperties: false,
    },
    run: (ctx, input) =>
      google.listEvents(
        ctx.workspaceId,
        String(input.timeMin),
        String(input.timeMax),
        ctx.timezone,
      ),
  },

  'gcal.find_free': {
    description:
      'Find free gaps in a time window, accounting for existing events. ' +
      'Use this rather than working out gaps yourself from a list of events.',
    schema: {
      type: 'object',
      properties: {
        timeMin: str('Window start, ISO 8601'),
        timeMax: str('Window end, ISO 8601'),
        minimumMinutes: { type: 'number', description: 'Shortest useful gap. Defaults to 30.' },
      },
      required: ['timeMin', 'timeMax'],
      additionalProperties: false,
    },
    run: async (ctx, input) => {
      const events = await google.listEvents(
        ctx.workspaceId,
        String(input.timeMin),
        String(input.timeMax),
        ctx.timezone,
      )
      return google.findFreeSlots(
        events,
        String(input.timeMin),
        String(input.timeMax),
        typeof input.minimumMinutes === 'number' ? input.minimumMinutes : 30,
      )
    },
  },

  'gcal.create_event': {
    description:
      'Create a calendar event. Attendees are invited immediately, so this ' +
      'always waits for the user to approve it first.',
    schema: {
      type: 'object',
      properties: {
        title: str('Event title'),
        start: str('Start time, ISO 8601'),
        end: str('End time, ISO 8601'),
        attendees: { type: 'array', items: { type: 'string' }, description: 'Email addresses' },
        description: str('Event description'),
      },
      required: ['title', 'start', 'end'],
      additionalProperties: false,
    },
    run: (ctx, input) =>
      google.createEvent(ctx.workspaceId, {
        title: String(input.title),
        start: String(input.start),
        end: String(input.end),
        timezone: ctx.timezone,
        attendees: Array.isArray(input.attendees) ? (input.attendees as string[]) : [],
        ...(input.description ? { description: String(input.description) } : {}),
      }),
  },

  'gcal.delete_event': {
    description:
      'Delete a calendar event and notify attendees. Destructive and not ' +
      'reversible, so it always waits for the user to approve it first.',
    schema: {
      type: 'object',
      properties: { eventId: str('Event id from gcal.list_events') },
      required: ['eventId'],
      additionalProperties: false,
    },
    run: async (ctx, input) => {
      await google.deleteEvent(ctx.workspaceId, String(input.eventId))
      return { deleted: true }
    },
  },

  'slack.list_channels': {
    description: 'List the Slack channels the user belongs to.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => slack.listChannels(ctx.workspaceId),
  },

  'slack.read_messages': {
    description:
      'Read recent messages in a channel. User ids are resolved to display ' +
      'names so they are readable in a summary.',
    schema: {
      type: 'object',
      properties: {
        channelId: str('Channel id from slack.list_channels'),
        oldest: str('Only messages after this Unix timestamp (seconds)'),
        limit: { type: 'number', description: 'Up to 200. Defaults to 50.' },
      },
      required: ['channelId'],
      additionalProperties: false,
    },
    run: async (ctx, input) => {
      const messages = await slack.readMessages(ctx.workspaceId, String(input.channelId), {
        ...(input.oldest ? { oldest: String(input.oldest) } : {}),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
      })
      const names = await slack.resolveUserNames(
        ctx.workspaceId,
        messages.map((m) => m.userId),
      )
      return messages.map((m) => ({ ...m, author: names.get(m.userId) ?? m.userId }))
    },
  },

  'slack.summarise_thread': {
    description: 'Read every message in one thread, so it can be summarised in full.',
    schema: {
      type: 'object',
      properties: {
        channelId: str('Channel id'),
        threadTs: str('Thread parent timestamp'),
      },
      required: ['channelId', 'threadTs'],
      additionalProperties: false,
    },
    run: async (ctx, input) => {
      const messages = await slack.readThread(
        ctx.workspaceId,
        String(input.channelId),
        String(input.threadTs),
      )
      const names = await slack.resolveUserNames(
        ctx.workspaceId,
        messages.map((m) => m.userId),
      )
      const link = await slack.permalink(
        ctx.workspaceId,
        String(input.channelId),
        String(input.threadTs),
      )
      return {
        permalink: link,
        messages: messages.map((m) => ({ ...m, author: names.get(m.userId) ?? m.userId })),
      }
    },
  },

  'slack.post_message': {
    description:
      'Post a message to a channel. Colleagues see it immediately, so this ' +
      'always waits for the user to approve it first.',
    schema: {
      type: 'object',
      properties: {
        channelId: str('Channel id'),
        text: str('Message text'),
        threadTs: str('Thread timestamp, to reply in a thread'),
      },
      required: ['channelId', 'text'],
      additionalProperties: false,
    },
    run: (ctx, input) =>
      slack.postMessage(
        ctx.workspaceId,
        String(input.channelId),
        String(input.text),
        input.threadTs ? String(input.threadTs) : undefined,
      ),
  },
}

/**
 * Build the toolbelt for one agent.
 *
 * Intersects three things: what the registry says this agent may use, which
 * integrations the workspace has actually connected, and what is implemented.
 * An agent receives the tools for its own task and nothing else.
 */
export function buildToolbelt(
  agent: AgentDefinition,
  connected: readonly ConnectionProvider[],
): readonly ToolBinding[] {
  const bindings: ToolBinding[] = []

  for (const spec of availableTools(agent, connected)) {
    const impl = IMPLEMENTATIONS[spec.id]
    if (!impl) {
      console.warn(`[toolbelt] ${spec.id} is in the registry but not implemented; skipping`)
      continue
    }

    bindings.push({
      toolId: spec.id,
      claudeName: claudeName(spec.id),
      effect: spec.effect,
      definition: {
        name: claudeName(spec.id),
        description: impl.description,
        input_schema: impl.schema,
        // Guarantees arguments validate against the schema, so a tool never
        // receives a field it did not declare.
        strict: true,
      },
      run: impl.run,
    })
  }

  return bindings
}
