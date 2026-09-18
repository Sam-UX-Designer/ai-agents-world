import { createHash, randomBytes } from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import type { ConnectionProvider } from '@agents-world/shared'
import { config } from '../config.js'
import { db, schema } from '../db/client.js'

/**
 * OAuth authorisation flows for Google and Slack.
 *
 * Two things this module refuses to compromise on:
 *
 *  - `state` is generated and stored server-side, then checked and consumed on
 *    callback. A one-use row rather than a cookie, so an attacker who can set
 *    cookies in the victim's browser still cannot forge a callback.
 *
 *  - Scopes are requested at the narrowest level each agent actually needs.
 *    Asking for full mailbox access when the Email Agent reads and drafts is
 *    both a security liability and, in Google's review, a reason for refusal.
 */

const STATE_TTL_MS = 10 * 60 * 1000

/**
 * Google scopes, narrowest first.
 *
 * `gmail.modify` is deliberately absent: the Email Agent reads, drafts and
 * sends, and never needs to mutate arbitrary messages or labels.
 */
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
] as const

/** Slack user-token scopes. The agent acts as the user, not as a bot. */
const SLACK_SCOPES = [
  'channels:read',
  'channels:history',
  'groups:read',
  'groups:history',
  'chat:write',
  'users:read',
] as const

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize'
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access'

export interface StartAuthInput {
  readonly provider: ConnectionProvider
  readonly userId: string
  readonly workspaceId: string
  readonly returnTo?: string | undefined
}

/** Build the URL to send the user to, and record the state that proves they came back. */
export async function startAuthorisation(input: StartAuthInput): Promise<string> {
  const c = config()
  const state = randomBytes(32).toString('base64url')
  const codeVerifier = randomBytes(32).toString('base64url')

  await db().insert(schema.oauthStates).values({
    state,
    userId: input.userId,
    workspaceId: input.workspaceId,
    provider: input.provider,
    codeVerifier,
    returnTo: input.returnTo ?? null,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  })

  if (input.provider === 'google') {
    if (!c.GOOGLE_CLIENT_ID || !c.GOOGLE_REDIRECT_URI) {
      throw new Error('Google OAuth is not configured on this deployment.')
    }
    const challenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const params = new URLSearchParams({
      client_id: c.GOOGLE_CLIENT_ID,
      redirect_uri: c.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // Required to receive a refresh token: without `offline` the agent
      // stops working the moment the first access token expires.
      access_type: 'offline',
      // Forces the consent screen, which is the only way Google reissues a
      // refresh token for a user who has already granted access once.
      prompt: 'consent',
    })
    return `${GOOGLE_AUTH_URL}?${params.toString()}`
  }

  if (!c.SLACK_CLIENT_ID || !c.SLACK_REDIRECT_URI) {
    throw new Error('Slack OAuth is not configured on this deployment.')
  }
  const params = new URLSearchParams({
    client_id: c.SLACK_CLIENT_ID,
    redirect_uri: c.SLACK_REDIRECT_URI,
    user_scope: SLACK_SCOPES.join(','),
    state,
  })
  return `${SLACK_AUTH_URL}?${params.toString()}`
}

export interface ConsumedState {
  /**
   * Null when the state was created by a sign-in, which has no account yet.
   * A connect callback must check rather than assume: the two flows share
   * this table, and a sign-in state arriving on the connect route is exactly
   * the confusion worth refusing.
   */
  readonly userId: string | null
  readonly workspaceId: string | null
  readonly provider: ConnectionProvider
  readonly codeVerifier: string
  readonly returnTo: string | null
}

/**
 * Validate and consume a `state`.
 *
 * Deleted as it is read, inside the same statement, so a replayed callback
 * finds nothing. Returns null for unknown, expired or already-used state -
 * all three mean the same thing to the caller: do not continue.
 */
export async function consumeState(state: string): Promise<ConsumedState | null> {
  const [row] = await db()
    .delete(schema.oauthStates)
    .where(eq(schema.oauthStates.state, state))
    .returning()

  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) return null

  return {
    userId: row.userId,
    workspaceId: row.workspaceId,
    provider: row.provider as ConnectionProvider,
    codeVerifier: row.codeVerifier,
    returnTo: row.returnTo,
  }
}

export interface TokenGrant {
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly expiresAt: Date | null
  readonly scopes: readonly string[]
  /** Which account was connected, shown so a user with two Gmails can tell. */
  readonly accountLabel: string
}

/** Exchange an authorisation code for tokens. */
export async function exchangeCode(
  provider: ConnectionProvider,
  code: string,
  codeVerifier: string,
): Promise<TokenGrant> {
  return provider === 'google'
    ? exchangeGoogle(code, codeVerifier)
    : exchangeSlack(code)
}

async function exchangeGoogle(code: string, codeVerifier: string): Promise<TokenGrant> {
  const c = config()
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.GOOGLE_CLIENT_ID ?? '',
      client_secret: c.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: c.GOOGLE_REDIRECT_URI ?? '',
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  })

  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`)
  }

  const body = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    id_token?: string
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null,
    // Google returns what it actually granted, which can be narrower than
    // what we asked for. Store the real answer so dispatch can check it.
    scopes: body.scope?.split(' ') ?? [],
    accountLabel: emailFromIdToken(body.id_token) ?? 'Google account',
  }
}

async function exchangeSlack(code: string): Promise<TokenGrant> {
  const c = config()
  const res = await fetch(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.SLACK_CLIENT_ID ?? '',
      client_secret: c.SLACK_CLIENT_SECRET ?? '',
      redirect_uri: c.SLACK_REDIRECT_URI ?? '',
    }),
  })

  const body = (await res.json()) as {
    ok: boolean
    error?: string
    team?: { name?: string }
    authed_user?: { access_token?: string; scope?: string }
  }

  // Slack answers 200 with ok:false for real failures, so the status code
  // alone is not enough to know the exchange worked.
  if (!body.ok || !body.authed_user?.access_token) {
    throw new Error(`Slack token exchange failed: ${body.error ?? 'unknown error'}`)
  }

  return {
    accessToken: body.authed_user.access_token,
    // Slack user tokens do not expire, so there is nothing to refresh.
    refreshToken: null,
    expiresAt: null,
    scopes: body.authed_user.scope?.split(',') ?? [],
    accountLabel: body.team?.name ?? 'Slack workspace',
  }
}

/**
 * Read the email claim out of a Google id_token.
 *
 * The signature is not verified, and deliberately so: this token arrived over
 * TLS directly from Google's token endpoint in response to our own request,
 * so it is already authenticated by the channel. The value is used as a
 * display label and nothing else - never for authorisation.
 */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: string
    }
    return claims.email ?? null
  } catch {
    return null
  }
}

/** Refresh an expired Google access token. */
export async function refreshGoogleToken(refreshToken: string): Promise<{
  accessToken: string
  expiresAt: Date | null
}> {
  const c = config()
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: c.GOOGLE_CLIENT_ID ?? '',
      client_secret: c.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status}): ${await res.text()}`)
  }

  const body = (await res.json()) as { access_token: string; expires_in?: number }
  return {
    accessToken: body.access_token,
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null,
  }
}

/** Delete expired authorisation attempts. */
export async function pruneExpiredStates(): Promise<number> {
  const deleted = await db()
    .delete(schema.oauthStates)
    .where(lt(schema.oauthStates.expiresAt, new Date()))
    .returning({ state: schema.oauthStates.state })
  return deleted.length
}

/** Scopes this deployment requests, for the permissions screen. */
export function scopesFor(provider: ConnectionProvider): readonly string[] {
  return provider === 'google' ? GOOGLE_SCOPES : SLACK_SCOPES
}

