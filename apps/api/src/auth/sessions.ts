import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, lt } from 'drizzle-orm'
import { db, schema } from '../db/client.js'

/**
 * Session issue, lookup and revocation.
 *
 * The cookie holds a random opaque token. We store only its SHA-256, so a
 * leaked database gives an attacker hashes rather than working cookies - the
 * same reason passwords are not stored in plaintext, applied to the thing
 * that actually grants access.
 */

const SESSION_BYTES = 32
const SESSION_TTL_DAYS = 30

export const SESSION_COOKIE = 'aw_session'

export interface SessionContext {
  readonly userId: string
  /** Null only between signing up and joining a workspace. */
  readonly workspaceId: string | null
  readonly expiresAt: Date
}

const hash = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

export interface IssueSessionInput {
  readonly userId: string
  readonly workspaceId: string | null
  readonly userAgent?: string | undefined
  readonly ipAddress?: string | undefined
}

/** Create a session. Returns the raw token, which is shown exactly once. */
export async function issueSession(
  input: IssueSessionInput,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(SESSION_BYTES).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000)

  await db().insert(schema.sessions).values({
    tokenHash: hash(token),
    userId: input.userId,
    workspaceId: input.workspaceId,
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null,
    expiresAt,
  })

  return { token, expiresAt }
}

/** Resolve a cookie to a session, or null if absent, unknown or expired. */
export async function resolveSession(
  token: string | undefined,
): Promise<SessionContext | null> {
  if (!token) return null

  const [row] = await db()
    .select({
      userId: schema.sessions.userId,
      workspaceId: schema.sessions.workspaceId,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.tokenHash, hash(token)),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1)

  return row ?? null
}

export async function revokeSession(token: string): Promise<void> {
  await db().delete(schema.sessions).where(eq(schema.sessions.tokenHash, hash(token)))
}

/** Revoke every session for a user. The "sign out everywhere" control. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db().delete(schema.sessions).where(eq(schema.sessions.userId, userId))
}

/** Point a session at a different workspace. */
export async function switchWorkspace(
  token: string,
  workspaceId: string,
): Promise<void> {
  await db()
    .update(schema.sessions)
    .set({ workspaceId })
    .where(eq(schema.sessions.tokenHash, hash(token)))
}

/** Delete expired rows. Run on a schedule; expiry is already enforced on read. */
export async function pruneExpiredSessions(): Promise<number> {
  const deleted = await db()
    .delete(schema.sessions)
    .where(lt(schema.sessions.expiresAt, new Date()))
    .returning({ tokenHash: schema.sessions.tokenHash })
  return deleted.length
}
