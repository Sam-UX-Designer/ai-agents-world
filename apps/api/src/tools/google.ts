import { accessTokenFor } from './connections.js'

/**
 * Gmail and Google Calendar.
 *
 * Each function is one tool from the agent registry. They return plain,
 * already-summarised shapes rather than raw API payloads: an agent that has
 * to wade through Gmail's nested MIME structure spends its context on parsing
 * instead of on the user's actual question.
 */

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const CALENDAR = 'https://www.googleapis.com/calendar/v3'

async function googleFetch<T>(
  workspaceId: string,
  url: string,
  scope: string,
  init?: RequestInit,
): Promise<T> {
  const token = await accessTokenFor(workspaceId, 'google', scope)
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google API ${res.status} on ${new URL(url).pathname}: ${body.slice(0, 400)}`)
  }

  return (await res.json()) as T
}

// ------------------------------------------------------------------ gmail --

export interface MessageSummary {
  readonly id: string
  readonly threadId: string
  readonly from: string
  readonly subject: string
  readonly receivedAt: string
  readonly snippet: string
  readonly unread: boolean
}

interface GmailListResponse {
  messages?: { id: string; threadId: string }[]
}

interface GmailMessage {
  id: string
  threadId: string
  snippet?: string
  labelIds?: string[]
  internalDate?: string
  payload?: { headers?: { name: string; value: string }[]; parts?: unknown[]; body?: { data?: string } }
}

const header = (msg: GmailMessage, name: string): string =>
  msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

/**
 * Search the mailbox.
 *
 * `query` is Gmail search syntax, which the agent already knows how to write
 * ("is:unread newer_than:7d"). Handing that through rather than inventing our
 * own filter language means the agent can express what it actually wants.
 */
export async function searchMessages(
  workspaceId: string,
  query: string,
  maxResults = 20,
): Promise<readonly MessageSummary[]> {
  const scope = 'https://www.googleapis.com/auth/gmail.readonly'
  const params = new URLSearchParams({ q: query, maxResults: String(Math.min(maxResults, 50)) })

  const list = await googleFetch<GmailListResponse>(
    workspaceId,
    `${GMAIL}/messages?${params}`,
    scope,
  )
  if (!list.messages?.length) return []

  // Gmail's list endpoint returns ids only, so each message costs a second
  // call. Fetched in parallel because a serial loop over 20 messages is the
  // difference between an agent that feels instant and one that does not.
  const messages = await Promise.all(
    list.messages.map((m) =>
      googleFetch<GmailMessage>(
        workspaceId,
        `${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        scope,
      ),
    ),
  )

  return messages.map((msg) => ({
    id: msg.id,
    threadId: msg.threadId,
    from: header(msg, 'From'),
    subject: header(msg, 'Subject') || '(no subject)',
    receivedAt: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : header(msg, 'Date'),
    snippet: msg.snippet ?? '',
    unread: msg.labelIds?.includes('UNREAD') ?? false,
  }))
}

/** Read one message in full, body decoded. */
export async function readMessage(
  workspaceId: string,
  messageId: string,
): Promise<MessageSummary & { body: string }> {
  const msg = await googleFetch<GmailMessage>(
    workspaceId,
    `${GMAIL}/messages/${messageId}?format=full`,
    'https://www.googleapis.com/auth/gmail.readonly',
  )

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: header(msg, 'From'),
    subject: header(msg, 'Subject') || '(no subject)',
    receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : '',
    snippet: msg.snippet ?? '',
    unread: msg.labelIds?.includes('UNREAD') ?? false,
    body: extractPlainText(msg.payload),
  }
}

/**
 * Pull readable text out of a Gmail payload.
 *
 * Gmail nests bodies inside multipart trees of arbitrary depth, so this walks
 * the tree preferring text/plain. Falls back to the HTML part with tags
 * stripped, because an agent reading raw HTML wastes context on markup.
 */
function extractPlainText(payload: GmailMessage['payload']): string {
  if (!payload) return ''

  const decode = (data?: string): string =>
    data ? Buffer.from(data, 'base64url').toString('utf8') : ''

  interface Part {
    mimeType?: string
    body?: { data?: string }
    parts?: Part[]
  }

  const walk = (part: Part, wanted: string): string => {
    if (part.mimeType === wanted && part.body?.data) return decode(part.body.data)
    for (const child of part.parts ?? []) {
      const found = walk(child, wanted)
      if (found) return found
    }
    return ''
  }

  const root = payload as Part
  const plain = walk(root, 'text/plain')
  if (plain) return plain

  const html = walk(root, 'text/html')
  if (html) return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  return decode(root.body?.data)
}

export interface DraftInput {
  readonly to: string
  readonly subject: string
  readonly body: string
  readonly threadId?: string
}

/** Build an RFC 2822 message, base64url encoded as Gmail expects. */
function encodeMime(input: DraftInput): string {
  const lines = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    input.body,
  ]
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url')
}

/** Create a draft. Autonomous: a draft has not reached anyone. */
export async function createDraft(
  workspaceId: string,
  input: DraftInput,
): Promise<{ draftId: string }> {
  const res = await googleFetch<{ id: string }>(
    workspaceId,
    `${GMAIL}/drafts`,
    'https://www.googleapis.com/auth/gmail.compose',
    {
      method: 'POST',
      body: JSON.stringify({
        message: {
          raw: encodeMime(input),
          ...(input.threadId ? { threadId: input.threadId } : {}),
        },
      }),
    },
  )
  return { draftId: res.id }
}

/**
 * Send a message.
 *
 * Reachable only after the permission gate approved it. The gate is enforced
 * in the runtime, not here, so that no tool can be written that accidentally
 * skips it - a tool function has no way to approve itself.
 */
export async function sendMessage(
  workspaceId: string,
  input: DraftInput,
): Promise<{ messageId: string }> {
  const res = await googleFetch<{ id: string }>(
    workspaceId,
    `${GMAIL}/messages/send`,
    'https://www.googleapis.com/auth/gmail.send',
    {
      method: 'POST',
      body: JSON.stringify({
        raw: encodeMime(input),
        ...(input.threadId ? { threadId: input.threadId } : {}),
      }),
    },
  )
  return { messageId: res.id }
}

// --------------------------------------------------------------- calendar --

export interface CalendarEvent {
  readonly id: string
  readonly title: string
  readonly start: string
  readonly end: string
  readonly allDay: boolean
  readonly location: string | null
  readonly attendees: readonly string[]
  readonly conferenceUrl: string | null
}

interface GoogleEvent {
  id: string
  summary?: string
  location?: string
  hangoutLink?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { email?: string }[]
}

/** Events in a window. Times come back in the requested timezone. */
export async function listEvents(
  workspaceId: string,
  timeMin: string,
  timeMax: string,
  timezone: string,
): Promise<readonly CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    timeZone: timezone,
    singleEvents: 'true', // expand recurring series into real occurrences
    orderBy: 'startTime',
    maxResults: '50',
  })

  const res = await googleFetch<{ items?: GoogleEvent[] }>(
    workspaceId,
    `${CALENDAR}/calendars/primary/events?${params}`,
    'https://www.googleapis.com/auth/calendar.readonly',
  )

  return (res.items ?? []).map((e) => ({
    id: e.id,
    title: e.summary ?? '(no title)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    // An all-day event has `date` and no `dateTime`. The distinction matters:
    // "you are free 09:00-17:00" is wrong if a full-day event covers it.
    allDay: !e.start?.dateTime,
    location: e.location ?? null,
    attendees: (e.attendees ?? []).map((a) => a.email ?? '').filter(Boolean),
    conferenceUrl: e.hangoutLink ?? null,
  }))
}

export interface FreeSlot {
  readonly start: string
  readonly end: string
}

/**
 * Gaps between events in a window.
 *
 * Computed here rather than asked of the model: arithmetic over timestamps is
 * something code does exactly right and a language model does approximately
 * right, and "approximately" is how you double-book someone.
 */
export function findFreeSlots(
  events: readonly CalendarEvent[],
  windowStart: string,
  windowEnd: string,
  minimumMinutes = 30,
): readonly FreeSlot[] {
  const busy = events
    .filter((e) => !e.allDay && e.start && e.end)
    .map((e) => ({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime() }))
    .sort((a, b) => a.start - b.start)

  const slots: FreeSlot[] = []
  const windowEndMs = new Date(windowEnd).getTime()
  const minimumMs = minimumMinutes * 60_000
  let cursor = new Date(windowStart).getTime()

  for (const period of busy) {
    if (period.start - cursor >= minimumMs) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(period.start).toISOString(),
      })
    }
    // Overlapping meetings are common; advance to the furthest end seen so
    // far rather than this event's end, or the overlap reads as free time.
    cursor = Math.max(cursor, period.end)
  }

  if (windowEndMs - cursor >= minimumMs) {
    slots.push({ start: new Date(cursor).toISOString(), end: new Date(windowEndMs).toISOString() })
  }

  return slots
}

export interface CreateEventInput {
  readonly title: string
  readonly start: string
  readonly end: string
  readonly timezone: string
  readonly attendees?: readonly string[]
  readonly description?: string
}

/** Create an event. Reachable only after approval - attendees get invited. */
export async function createEvent(
  workspaceId: string,
  input: CreateEventInput,
): Promise<{ eventId: string; htmlLink: string }> {
  const res = await googleFetch<{ id: string; htmlLink: string }>(
    workspaceId,
    `${CALENDAR}/calendars/primary/events?sendUpdates=all`,
    'https://www.googleapis.com/auth/calendar.events',
    {
      method: 'POST',
      body: JSON.stringify({
        summary: input.title,
        description: input.description,
        start: { dateTime: input.start, timeZone: input.timezone },
        end: { dateTime: input.end, timeZone: input.timezone },
        attendees: (input.attendees ?? []).map((email) => ({ email })),
      }),
    },
  )
  return { eventId: res.id, htmlLink: res.htmlLink }
}

/** Delete an event. Destructive: always requires approval, never waivable. */
export async function deleteEvent(workspaceId: string, eventId: string): Promise<void> {
  const token = await accessTokenFor(
    workspaceId,
    'google',
    'https://www.googleapis.com/auth/calendar.events',
  )
  const res = await fetch(
    `${CALENDAR}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
  )
  // 410 Gone means it was already deleted, which is the outcome we wanted.
  if (!res.ok && res.status !== 410) {
    throw new Error(`Google Calendar delete failed (${res.status}): ${await res.text()}`)
  }
}
