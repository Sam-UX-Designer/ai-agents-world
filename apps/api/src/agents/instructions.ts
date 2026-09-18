import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/client.js'

/**
 * A workspace's own instructions for an agent.
 *
 * Read on every dispatch rather than cached in the process: an instruction
 * saved thirty seconds ago should apply to the very next run, and a stale
 * cache here would look exactly like the feature not working.
 */

export const MAX_INSTRUCTION_LENGTH = 4000

export async function getInstructions(
  workspaceId: string,
  agentKey: string,
): Promise<string | null> {
  const [row] = await db()
    .select({ instructions: schema.agentInstructions.instructions })
    .from(schema.agentInstructions)
    .where(
      and(
        eq(schema.agentInstructions.workspaceId, workspaceId),
        eq(schema.agentInstructions.agentKey, agentKey),
      ),
    )
    .limit(1)

  return row?.instructions ?? null
}

/** Every agent's instructions for a workspace, for the panel that edits them. */
export async function listInstructions(
  workspaceId: string,
): Promise<Record<string, string>> {
  const rows = await db()
    .select({
      agentKey: schema.agentInstructions.agentKey,
      instructions: schema.agentInstructions.instructions,
    })
    .from(schema.agentInstructions)
    .where(eq(schema.agentInstructions.workspaceId, workspaceId))

  return Object.fromEntries(rows.map((r) => [r.agentKey, r.instructions]))
}

/** Save, or clear the row when the text is emptied. */
export async function setInstructions(
  workspaceId: string,
  agentKey: string,
  instructions: string,
): Promise<void> {
  const text = instructions.trim()

  if (!text) {
    await db()
      .delete(schema.agentInstructions)
      .where(
        and(
          eq(schema.agentInstructions.workspaceId, workspaceId),
          eq(schema.agentInstructions.agentKey, agentKey),
        ),
      )
    return
  }

  await db()
    .insert(schema.agentInstructions)
    .values({ workspaceId, agentKey, instructions: text })
    .onConflictDoUpdate({
      target: [schema.agentInstructions.workspaceId, schema.agentInstructions.agentKey],
      set: { instructions: text, updatedAt: new Date() },
    })
}
