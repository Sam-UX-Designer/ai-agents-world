import { and, eq, isNull } from 'drizzle-orm'
import type { ConnectionProvider } from '@agents-world/shared'
import { config } from '../config.js'
import { db, schema } from '../db/client.js'
import { decryptToken, encryptToken } from '../db/crypto.js'
import { refreshGoogleToken, type TokenGrant } from './oauth.js'

/**
 * Stored integration credentials.
 *
 * Nothing outside this module ever sees a decrypted token. Tools ask for an
 * access token by connection id, get one that is known-fresh, and never learn
 * where it came from or how it is stored. That is what keeps credentials out
 * of the 3D client - there is no code path that could put one there.
 */

/** Refresh this long before actual expiry, so a token cannot die mid-request. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface ConnectionSummary {
  readonly id: string
  readonly provider: ConnectionProvider
  readonly accountLabel: string
  readonly scopes: readonly string[]
  readonly connectedAt: Date
}

/** Save a new connection, or replace the one for the same account. */
export async function saveConnection(
  workspaceId: string,
  userId: string,
  provider: ConnectionProvider,
  grant: TokenGrant,
): Promise<{ connectionId: string }> {
  const key = config().TOKEN_ENCRYPTION_KEY

  const [row] = await db()
    .insert(schema.connections)
    .values({
      workspaceId,
      userId,
      provider,
      accountLabel: grant.accountLabel,
      accessTokenEnc: encryptToken(grant.accessToken, key),
      refreshTokenEnc: grant.refreshToken ? encryptToken(grant.refreshToken, key) : null,
      expiresAt: grant.expiresAt,
      scopes: [...grant.scopes],
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [
        schema.connections.workspaceId,
        schema.connections.userId,
        schema.connections.provider,
        schema.connections.accountLabel,
      ],
      set: {
        accessTokenEnc: encryptToken(grant.accessToken, key),
        // A re-auth that returns no refresh token must not wipe the one we
        // already hold, or the connection silently stops surviving expiry.
        ...(grant.refreshToken
          ? { refreshTokenEnc: encryptToken(grant.refreshToken, key) }
          : {}),
        expiresAt: grant.expiresAt,
        scopes: [...grant.scopes],
        revokedAt: null,
      },
    })
    .returning({ id: schema.connections.id })

  if (!row) throw new Error('Failed to save connection')
  return { connectionId: row.id }
}

/** Live connections for a workspace. Safe to send to a client: no secrets. */
export async function listConnections(
  workspaceId: string,
): Promise<readonly ConnectionSummary[]> {
  const rows = await db()
    .select({
      id: schema.connections.id,
      provider: schema.connections.provider,
      accountLabel: schema.connections.accountLabel,
      scopes: schema.connections.scopes,
      createdAt: schema.connections.createdAt,
    })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.workspaceId, workspaceId),
        isNull(schema.connections.revokedAt),
      ),
    )

  return rows.map((r) => ({
    id: r.id,
    provider: r.provider as ConnectionProvider,
    accountLabel: r.accountLabel,
    scopes: r.scopes,
    connectedAt: r.createdAt,
  }))
}

/** Which providers a workspace has connected. Feeds the Orchestrator's roster. */
export async function connectedProviders(
  workspaceId: string,
): Promise<readonly ConnectionProvider[]> {
  const connections = await listConnections(workspaceId)
  return [...new Set(connections.map((c) => c.provider))]
}

export class NoConnectionError extends Error {
  constructor(provider: ConnectionProvider) {
    super(`No ${provider} account is connected to this workspace.`)
    this.name = 'NoConnectionError'
  }
}

export class MissingScopeError extends Error {
  constructor(provider: ConnectionProvider, scope: string) {
    super(
      `The connected ${provider} account did not grant "${scope}". ` +
        'Reconnect it and accept that permission.',
    )
    this.name = 'MissingScopeError'
  }
}

/**
 * Get a usable access token, refreshing it first if it is close to expiry.
 *
 * Refreshing on a margin rather than on failure means a long agent run cannot
 * have a token expire between two of its own tool calls - a failure mode that
 * would otherwise show up as a mysterious 401 halfway through a task.
 */
export async function accessTokenFor(
  workspaceId: string,
  provider: ConnectionProvider,
  requiredScope?: string,
): Promise<string> {
  const key = config().TOKEN_ENCRYPTION_KEY

  const [row] = await db()
    .select()
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.workspaceId, workspaceId),
        eq(schema.connections.provider, provider),
        isNull(schema.connections.revokedAt),
      ),
    )
    .limit(1)

  if (!row) throw new NoConnectionError(provider)

  if (requiredScope && !row.scopes.includes(requiredScope)) {
    throw new MissingScopeError(provider, requiredScope)
  }

  const expiringSoon =
    row.expiresAt !== null && row.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS

  if (!expiringSoon) return decryptToken(row.accessTokenEnc, key)

  if (!row.refreshTokenEnc) {
    throw new Error(
      `The ${provider} connection has expired and cannot be refreshed. Reconnect it.`,
    )
  }

  const refreshed = await refreshGoogleToken(decryptToken(row.refreshTokenEnc, key))

  await db()
    .update(schema.connections)
    .set({
      accessTokenEnc: encryptToken(refreshed.accessToken, key),
      expiresAt: refreshed.expiresAt,
    })
    .where(eq(schema.connections.id, row.id))

  return refreshed.accessToken
}

/**
 * Disconnect an integration.
 *
 * Marked revoked rather than deleted: the tool_calls that used it still
 * reference this connection, and an audit trail that loses its subject when
 * a user disconnects an account is not an audit trail.
 */
export async function revokeConnection(
  workspaceId: string,
  connectionId: string,
): Promise<void> {
  await db()
    .update(schema.connections)
    .set({ revokedAt: new Date(), accessTokenEnc: '', refreshTokenEnc: null })
    .where(
      and(
        eq(schema.connections.id, connectionId),
        eq(schema.connections.workspaceId, workspaceId),
      ),
    )
}
