import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/client.js'
import type { AutonomyLevel } from '@agents-world/shared'

/**
 * Workspaces, membership, and the tenant guard.
 *
 * Every request that touches user data resolves its workspace through
 * `requireMembership`. That function is the only place a caller is granted a
 * workspace id, so a handler cannot accidentally trust one that arrived in a
 * query string.
 */

export type WorkspaceRole = 'owner' | 'admin' | 'member'

const ROLE_RANK: Record<WorkspaceRole, number> = { member: 0, admin: 1, owner: 2 }

export interface Membership {
  readonly workspaceId: string
  readonly userId: string
  readonly role: WorkspaceRole
}

export class NotAMemberError extends Error {
  constructor(workspaceId: string) {
    super(`Not a member of workspace ${workspaceId}`)
    this.name = 'NotAMemberError'
  }
}

export class InsufficientRoleError extends Error {
  constructor(required: WorkspaceRole, actual: WorkspaceRole) {
    super(`This action needs the ${required} role; you have ${actual}.`)
    this.name = 'InsufficientRoleError'
  }
}

/**
 * The tenant guard.
 *
 * Throws rather than returning null: a caller who forgets to check a null is
 * a caller who just served one customer's data to another. An exception
 * cannot be ignored by accident.
 */
export async function requireMembership(
  userId: string,
  workspaceId: string,
  minimumRole: WorkspaceRole = 'member',
): Promise<Membership> {
  const [row] = await db()
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.userId, userId),
        eq(schema.workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1)

  if (!row) throw new NotAMemberError(workspaceId)

  const role = row.role as WorkspaceRole
  if (ROLE_RANK[role] < ROLE_RANK[minimumRole]) {
    throw new InsufficientRoleError(minimumRole, role)
  }

  return { workspaceId, userId, role }
}

/** Create a workspace and make its creator the owner, atomically. */
export async function createWorkspace(
  userId: string,
  name: string,
): Promise<{ workspaceId: string }> {
  return db().transaction(async (tx) => {
    const [workspace] = await tx
      .insert(schema.workspaces)
      .values({ name })
      .returning({ id: schema.workspaces.id })

    if (!workspace) throw new Error('Failed to create workspace')

    await tx.insert(schema.workspaceMembers).values({
      workspaceId: workspace.id,
      userId,
      role: 'owner',
    })

    return { workspaceId: workspace.id }
  })
}

export interface WorkspaceSettings {
  readonly id: string
  readonly name: string
  readonly autonomyLevel: AutonomyLevel
  readonly grantedActionTypes: readonly string[]
}

export async function getWorkspace(workspaceId: string): Promise<WorkspaceSettings | null> {
  const [row] = await db()
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    autonomyLevel: row.autonomyLevel as AutonomyLevel,
    grantedActionTypes: row.grantedActionTypes,
  }
}

export async function listWorkspacesForUser(userId: string): Promise<
  readonly { workspaceId: string; name: string; role: WorkspaceRole }[]
> {
  const rows = await db()
    .select({
      workspaceId: schema.workspaces.id,
      name: schema.workspaces.name,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId))

  return rows.map((r) => ({ ...r, role: r.role as WorkspaceRole }))
}

/**
 * Remember an approval so the workspace stops being asked about it.
 *
 * Only reachable for effects that are waivable. Financial and destructive
 * actions are refused by the permission gate before they ever reach here, so
 * "don't ask again" cannot be attached to a payment or a deletion.
 */
export async function grantActionType(
  workspaceId: string,
  actionType: string,
): Promise<void> {
  const workspace = await getWorkspace(workspaceId)
  if (!workspace) throw new Error(`Unknown workspace ${workspaceId}`)
  if (workspace.grantedActionTypes.includes(actionType)) return

  await db()
    .update(schema.workspaces)
    .set({ grantedActionTypes: [...workspace.grantedActionTypes, actionType] })
    .where(eq(schema.workspaces.id, workspaceId))
}

export async function setAutonomyLevel(
  workspaceId: string,
  level: AutonomyLevel,
): Promise<void> {
  await db()
    .update(schema.workspaces)
    .set({ autonomyLevel: level })
    .where(eq(schema.workspaces.id, workspaceId))
}
