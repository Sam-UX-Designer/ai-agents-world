import { and, eq, sql } from 'drizzle-orm'
import { requiresApprovalAlways, type ToolEffect } from '@agents-world/shared'
import { grantActionType } from '../auth/workspaces.js'
import { db, schema } from '../db/client.js'
import { resumeGoal, type OrchestrationDeps } from './orchestration.js'

/**
 * Resolving an approval, and restarting the work it was blocking.
 *
 * The important detail is what "approved" grants: this tool, on this run,
 * once. Approving an email does not leave the Email Agent free to send the
 * next one. Broadening that is a separate, explicit choice ("don't ask
 * again"), and even then it cannot cover money or deletion.
 */

export type Decision = 'approved' | 'rejected'

export interface ResolveInput {
  readonly approvalId: string
  readonly workspaceId: string
  readonly userId: string
  readonly decision: Decision
  /** Stop asking about this action type in future. Ignored for non-waivable effects. */
  readonly remember?: boolean
}

export class ApprovalNotFoundError extends Error {
  constructor(id: string) {
    super(`No pending approval ${id}`)
    this.name = 'ApprovalNotFoundError'
  }
}

/**
 * Record the user's decision, then resume if nothing else is outstanding.
 *
 * The state filter in the WHERE clause is what makes this safe to call twice:
 * a double-clicked Approve button updates one row the first time and zero the
 * second, rather than re-running a send.
 */
export async function resolveApproval(
  deps: OrchestrationDeps,
  input: ResolveInput,
): Promise<{ resumed: boolean }> {
  const [approval] = await db()
    .update(schema.approvals)
    .set({
      state: input.decision,
      decidedByUserId: input.userId,
      decidedAt: new Date(),
      remembered: input.remember ?? false,
    })
    .where(
      and(
        eq(schema.approvals.id, input.approvalId),
        eq(schema.approvals.workspaceId, input.workspaceId),
        eq(schema.approvals.state, 'pending'),
      ),
    )
    .returning()

  if (!approval) throw new ApprovalNotFoundError(input.approvalId)

  await deps.bus.emit({
    goalId: approval.goalId,
    workspaceId: approval.workspaceId,
    type: 'approval.resolved',
    approvalId: approval.id,
    taskId: approval.taskId,
    decision: input.decision,
    remembered: input.remember ?? false,
  })

  if (input.decision === 'approved') {
    // Scoped to this run. The next run starts from the workspace's standing
    // policy again, so one approval never silently becomes a standing one.
    await db()
      .update(schema.agentRuns)
      .set({
        approvedToolIds: sql`${schema.agentRuns.approvedToolIds} || ${JSON.stringify([approval.actionType])}::jsonb`,
      })
      .where(
        and(
          eq(schema.agentRuns.taskId, approval.taskId),
          eq(schema.agentRuns.state, 'needs_input'),
        ),
      )

    if (input.remember && !isNonWaivable(approval.actionType)) {
      await grantActionType(approval.workspaceId, approval.actionType)
    }
  } else {
    await db()
      .update(schema.tasks)
      .set({ state: 'cancelled', error: 'You declined this action.' })
      .where(eq(schema.tasks.id, approval.taskId))

    await deps.bus.emit({
      goalId: approval.goalId,
      workspaceId: approval.workspaceId,
      type: 'task.state_changed',
      taskId: approval.taskId,
      state: 'cancelled',
      error: 'You declined this action.',
    })
  }

  // resumeGoal checks for other outstanding approvals itself and no-ops if any
  // remain, so this is safe to call after every decision in a batch.
  await resumeGoal(deps, approval.goalId)
  return { resumed: input.decision === 'approved' }
}

/**
 * Whether "don't ask again" may cover this action.
 *
 * Mirrors the shared permission gate. Duplicated deliberately as a second
 * check at the point of granting: the gate stops the action, and this stops a
 * standing grant ever existing for it in the first place.
 */
function isNonWaivable(actionType: string): boolean {
  const effects: Record<string, ToolEffect> = {
    'gcal.delete_event': 'destructive',
  }
  const effect = effects[actionType]
  return effect ? requiresApprovalAlways(effect) : false
}

export async function listPendingApprovals(workspaceId: string): Promise<
  readonly {
    id: string
    goalId: string
    taskId: string
    agentKey: string
    actionType: string
    description: string
    preview: string | null
    createdAt: Date
  }[]
> {
  return db()
    .select({
      id: schema.approvals.id,
      goalId: schema.approvals.goalId,
      taskId: schema.approvals.taskId,
      agentKey: schema.approvals.agentKey,
      actionType: schema.approvals.actionType,
      description: schema.approvals.description,
      preview: schema.approvals.preview,
      createdAt: schema.approvals.createdAt,
    })
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.workspaceId, workspaceId),
        eq(schema.approvals.state, 'pending'),
      ),
    )
}
