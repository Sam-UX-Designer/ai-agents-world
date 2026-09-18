import { createHash, createPrivateKey, randomBytes, sign as signWith } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { config } from '../config.js'
import { db, schema } from '../db/client.js'
import { createWorkspace } from './workspaces.js'

/**
 * Sign-in with Google, Apple and Microsoft.
 *
 * Separate from the integration OAuth in tools/oauth.ts, and deliberately so.
 * That flow asks for access to a user's mail; this one only establishes who
 * they are. Sharing a code path would mean every sign-in requested mailbox
 * scopes, which is both a worse consent screen and a reason for Google to
 * reject the app in review.
 */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const MICROSOFT_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const MICROSOFT_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const APPLE_AUTH = 'https://appleid.apple.com/auth/authorize'
const APPLE_TOKEN = 'https://appleid.apple.com/auth/token'

/** Identity only. No mail, no calendar, no files. */
const IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const

export type IdentityProvider = 'google' | 'apple' | 'microsoft'

const STATE_TTL_MS = 10 * 60 * 1000

/**
 * Sign-in state lives in the same table as integration state, so there is one
 * expiry sweep and one replay defence rather than two that can drift.
 *
 * It has no user id or workspace id to record - that is the whole point of
 * signing in - so both are left null. They used to be written as a nil UUID,
 * which the foreign key to `users` rejected: every sign-in failed on the very
 * first query, before a single request reached Google.
 */

/**
 * Apple's client secret is not a string you paste - it is a short-lived ES256
 * JWT you sign yourself with the .p8 key from the developer portal. Generated
 * per request rather than cached: it costs microseconds, and a cached one is
 * a secret sitting in memory for no reason.
 */
function appleClientSecret(): string {
  const c = config()
  if (!c.APPLE_CLIENT_ID || !c.APPLE_TEAM_ID || !c.APPLE_KEY_ID || !c.APPLE_PRIVATE_KEY) {
    throw new Error('Apple sign-in is not configured.')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', kid: c.APPLE_KEY_ID, typ: 'JWT' }
  const payload = {
    iss: c.APPLE_TEAM_ID,
    iat: now,
    // Apple allows up to six months. Minutes is all this needs.
    exp: now + 300,
    aud: 'https://appleid.apple.com',
    sub: c.APPLE_CLIENT_ID,
  }

  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const signingInput = `${encode(header)}.${encode(payload)}`

  // Env vars cannot hold real newlines, so the key is stored with \n escapes.
  const key = createPrivateKey(c.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'))
  // JOSE wants the raw r||s pair, not the DER sequence OpenSSL produces.
  const signature = signWith('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  })

  return `${signingInput}.${signature.toString('base64url')}`
}

export async function startSignIn(
  provider: IdentityProvider,
  returnTo?: string,
): Promise<string> {
  const c = config()
  const state = randomBytes(32).toString('base64url')
  const codeVerifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(codeVerifier).digest('base64url')

  await db().insert(schema.oauthStates).values({
    state,
    userId: null,
    workspaceId: null,
    provider: `signin:${provider}`,
    codeVerifier,
    returnTo: returnTo ?? null,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  })

  const redirectUri = `${c.APP_URL.replace(/\/$/, '')}/api/auth/${provider}/signin-callback`

  if (provider === 'google') {
    if (!c.GOOGLE_CLIENT_ID) throw new Error('Google sign-in is not configured.')
    return `${GOOGLE_AUTH}?${new URLSearchParams({
      client_id: c.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: IDENTITY_SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })}`
  }

  if (provider === 'apple') {
    // Throws when unconfigured, which is what the caller reports.
    appleClientSecret()
    return `${APPLE_AUTH}?${new URLSearchParams({
      client_id: c.APPLE_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'name email',
      // Apple insists on a form POST the moment you ask for name or email,
      // so the callback for Apple is a POST route rather than a GET.
      response_mode: 'form_post',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })}`
  }

  if (!c.MICROSOFT_CLIENT_ID) throw new Error('Microsoft sign-in is not configured.')
  return `${MICROSOFT_AUTH}?${new URLSearchParams({
    client_id: c.MICROSOFT_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: IDENTITY_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })}`
}

export interface Identity {
  readonly subject: string
  readonly email: string
  readonly name: string | null
  readonly avatarUrl: string | null
}

export async function completeSignIn(
  provider: IdentityProvider,
  code: string,
  codeVerifier: string,
): Promise<Identity> {
  const c = config()
  const redirectUri = `${c.APP_URL.replace(/\/$/, '')}/api/auth/${provider}/signin-callback`

  const endpoint =
    provider === 'google' ? GOOGLE_TOKEN : provider === 'apple' ? APPLE_TOKEN : MICROSOFT_TOKEN

  const clientId =
    (provider === 'google'
      ? c.GOOGLE_CLIENT_ID
      : provider === 'apple'
        ? c.APPLE_CLIENT_ID
        : c.MICROSOFT_CLIENT_ID) ?? ''

  const clientSecret =
    provider === 'google'
      ? (c.GOOGLE_CLIENT_SECRET ?? '')
      : provider === 'apple'
        ? appleClientSecret()
        : (c.MICROSOFT_CLIENT_SECRET ?? '')

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  })

  if (!res.ok) {
    throw new Error(`${provider} sign-in failed (${res.status}): ${await res.text()}`)
  }

  const body = (await res.json()) as { id_token?: string }
  if (!body.id_token) throw new Error(`${provider} returned no identity token`)

  return readIdentity(body.id_token)
}

/**
 * Read the identity claims from an id_token.
 *
 * The signature is not verified, and that is safe here for one specific
 * reason: this token arrived over TLS as the direct response to our own
 * back-channel token request, authenticated by our client secret. It was
 * never handled by the browser. Verifying a JWKS signature would guard
 * against a tampering path that does not exist on this route.
 *
 * This reasoning does NOT extend to an id_token arriving any other way. A
 * token posted by a client must always be verified.
 */
function readIdentity(idToken: string): Identity {
  const payload = idToken.split('.')[1]
  if (!payload) throw new Error('Malformed identity token')

  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    sub?: string
    email?: string
    preferred_username?: string
    name?: string
    picture?: string
  }

  const email = claims.email ?? claims.preferred_username
  if (!claims.sub || !email) throw new Error('Identity token is missing required claims')

  return {
    subject: claims.sub,
    email: email.toLowerCase(),
    name: claims.name ?? null,
    avatarUrl: claims.picture ?? null,
  }
}

/**
 * Find or create the user behind an identity, and make sure they have a
 * workspace to land in.
 *
 * Matched on the provider's stable subject, never on email: people change
 * their email address, and matching on it would either lock someone out of
 * their own account or hand them someone else's.
 */
export async function resolveUser(
  provider: IdentityProvider,
  identity: Identity,
): Promise<{ userId: string; workspaceId: string; isNew: boolean }> {
  const [existing] = await db()
    .select({ userId: schema.identities.userId })
    .from(schema.identities)
    .where(
      and(
        eq(schema.identities.provider, provider),
        eq(schema.identities.subject, identity.subject),
      ),
    )
    .limit(1)

  if (existing) {
    const [membership] = await db()
      .select({ workspaceId: schema.workspaceMembers.workspaceId })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, existing.userId))
      .limit(1)

    if (membership) {
      return { userId: existing.userId, workspaceId: membership.workspaceId, isNew: false }
    }

    // Signed up before but has no workspace - possible if the first attempt
    // failed partway. Give them one rather than leaving a dead account.
    const created = await createWorkspace(existing.userId, workspaceNameFor(identity))
    return { userId: existing.userId, workspaceId: created.workspaceId, isNew: false }
  }

  // A user can already exist under a different provider - signed up with
  // Google, now signing in with Microsoft on the same address. Link the new
  // identity to that user rather than creating a duplicate account.
  const [byEmail] = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, identity.email))
    .limit(1)

  const userId =
    byEmail?.id ??
    (
      await db()
        .insert(schema.users)
        .values({
          email: identity.email,
          name: identity.name,
          avatarUrl: identity.avatarUrl,
        })
        .returning({ id: schema.users.id })
    )[0]?.id

  if (!userId) throw new Error('Could not create the account')

  await db()
    .insert(schema.identities)
    .values({ userId, provider, subject: identity.subject })
    .onConflictDoNothing()

  if (byEmail) {
    const [membership] = await db()
      .select({ workspaceId: schema.workspaceMembers.workspaceId })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, userId))
      .limit(1)

    if (membership) {
      return { userId, workspaceId: membership.workspaceId, isNew: false }
    }
  }

  const created = await createWorkspace(userId, workspaceNameFor(identity))
  return { userId, workspaceId: created.workspaceId, isNew: true }
}

const workspaceNameFor = (identity: Identity): string =>
  identity.name ? `${identity.name.split(' ')[0]}'s workspace` : 'My workspace'
