import { accessTokenFor } from './connections.js'

/**
 * Slack.
 *
 * Every call goes out as the user's own token, so an agent can only ever see
 * what the user could already see. There is no bot identity with wider reach -
 * that removes a whole class of "the agent read a channel I am not in" bug.
 */

const SLACK_API = 'https://slack.com/api'

/**
 * Slack answers 200 with `ok: false` for real failures, so the HTTP status is
 * not a reliable signal on its own and every response has to be unwrapped.
 */
async function slackFetch<T>(
  workspaceId: string,
  method: string,
  scope: string,
  params: Record<string, string> = {},
  httpMethod: 'GET' | 'POST' = 'GET',
): Promise<T> {
  const token = await accessTokenFor(workspaceId, 'slack', scope)

  const url =
    httpMethod === 'GET'
      ? `${SLACK_API}/${method}?${new URLSearchParams(params)}`
      : `${SLACK_API}/${method}`

  const res = await fetch(url, {
    method: httpMethod,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type':
        httpMethod === 'POST'
          ? 'application/x-www-form-urlencoded'
          : 'application/json',
    },
    ...(httpMethod === 'POST' ? { body: new URLSearchParams(params) } : {}),
  })

  const body = (await res.json()) as { ok: boolean; error?: string } & T
  if (!body.ok) {
    throw new Error(`Slack ${method} failed: ${body.error ?? 'unknown error'}`)
  }
  return body
}

export interface Channel {
  readonly id: string
  readonly name: string
  readonly isPrivate: boolean
  readonly memberCount: number
}

/** Channels the user belongs to. */
export async function listChannels(
  workspaceId: string,
  limit = 100,
): Promise<readonly Channel[]> {
  const body = await slackFetch<{
    channels?: { id: string; name: string; is_private?: boolean; num_members?: number }[]
  }>(workspaceId, 'conversations.list', 'channels:read', {
    types: 'public_channel,private_channel',
    exclude_archived: 'true',
    limit: String(Math.min(limit, 200)),
  })

  return (body.channels ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    isPrivate: c.is_private ?? false,
    memberCount: c.num_members ?? 0,
  }))
}

export interface SlackMessage {
  readonly ts: string
  readonly userId: string
  readonly text: string
  readonly threadTs: string | null
  readonly replyCount: number
  readonly sentAt: string
}

/** Recent messages in a channel. */
export async function readMessages(
  workspaceId: string,
  channelId: string,
  options: { oldest?: string; limit?: number } = {},
): Promise<readonly SlackMessage[]> {
  const body = await slackFetch<{
    messages?: {
      ts: string
      user?: string
      text?: string
      thread_ts?: string
      reply_count?: number
    }[]
  }>(workspaceId, 'conversations.history', 'channels:history', {
    channel: channelId,
    limit: String(Math.min(options.limit ?? 50, 200)),
    ...(options.oldest ? { oldest: options.oldest } : {}),
  })

  return (body.messages ?? []).map((m) => ({
    ts: m.ts,
    userId: m.user ?? '',
    text: m.text ?? '',
    // thread_ts equals ts on a thread parent, so only treat it as a reply
    // when the two differ.
    threadTs: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : null,
    replyCount: m.reply_count ?? 0,
    // Slack timestamps are seconds with microsecond precision, not millis.
    sentAt: new Date(Number(m.ts) * 1000).toISOString(),
  }))
}

/** Every message in one thread, parent first. */
export async function readThread(
  workspaceId: string,
  channelId: string,
  threadTs: string,
): Promise<readonly SlackMessage[]> {
  const body = await slackFetch<{
    messages?: { ts: string; user?: string; text?: string; reply_count?: number }[]
  }>(workspaceId, 'conversations.replies', 'channels:history', {
    channel: channelId,
    ts: threadTs,
    limit: '100',
  })

  return (body.messages ?? []).map((m) => ({
    ts: m.ts,
    userId: m.user ?? '',
    text: m.text ?? '',
    threadTs,
    replyCount: m.reply_count ?? 0,
    sentAt: new Date(Number(m.ts) * 1000).toISOString(),
  }))
}

/**
 * Resolve user ids to display names.
 *
 * Slack messages carry ids like U024BE7LH, which are meaningless in a summary.
 * Batched and deduplicated because a busy channel can mention the same twenty
 * people a hundred times.
 */
export async function resolveUserNames(
  workspaceId: string,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))]
  const names = new Map<string, string>()

  await Promise.all(
    unique.map(async (id) => {
      try {
        const body = await slackFetch<{
          user?: { real_name?: string; profile?: { display_name?: string } }
        }>(workspaceId, 'users.info', 'users:read', { user: id })
        const name = body.user?.profile?.display_name || body.user?.real_name
        if (name) names.set(id, name)
      } catch {
        // One unresolvable user must not fail the whole summary; the id is a
        // poor label but a usable one.
      }
    }),
  )

  return names
}

/** Post a message. Reachable only after approval - colleagues see this at once. */
export async function postMessage(
  workspaceId: string,
  channelId: string,
  text: string,
  threadTs?: string,
): Promise<{ ts: string }> {
  const body = await slackFetch<{ ts?: string }>(
    workspaceId,
    'chat.postMessage',
    'chat:write',
    {
      channel: channelId,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    },
    'POST',
  )
  return { ts: body.ts ?? '' }
}

/** Permalink for a message, so a summary can cite the thread it came from. */
export async function permalink(
  workspaceId: string,
  channelId: string,
  messageTs: string,
): Promise<string | null> {
  try {
    const body = await slackFetch<{ permalink?: string }>(
      workspaceId,
      'chat.getPermalink',
      'channels:read',
      { channel: channelId, message_ts: messageTs },
    )
    return body.permalink ?? null
  } catch {
    return null
  }
}
