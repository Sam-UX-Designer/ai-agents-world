import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/client.js'

/**
 * A workspace's own settings for an agent.
 *
 * Two things live here: what this workspace calls the agent, and what it has
 * told the agent that the registry could not know. Both are per workspace and
 * per agent, and both are read fresh rather than cached in the process - a
 * name changed thirty seconds ago should be on the island now, and an
 * instruction saved thirty seconds ago should apply to the very next run. A
 * stale cache in either place looks exactly like the feature not working.
 *
 * One row carries both, so renaming an agent you have never written
 * instructions for writes one row rather than inventing a second table.
 */

export const MAX_INSTRUCTION_LENGTH = 4000

/**
 * How long a name may be.
 *
 * Not an arbitrary round number: the name is rendered on a card floating over
 * the island, and the longest built-in one - "Development Agent" - is 17
 * characters. 32 leaves room for a real name without the card growing wide
 * enough to cover the agent standing next to it.
 */
export const MAX_AGENT_NAME_LENGTH = 32

/**
 * Tidy a name the way a person would expect.
 *
 * Trimmed, and inner runs of whitespace collapsed to single spaces, so a name
 * pasted out of a document does not arrive with a newline in the middle of it
 * and break the card it is drawn in. Control characters go entirely; they are
 * invisible in the input and would make two names that look identical compare
 * as different.
 *
 * Returns null for anything that is empty once tidied, which is how the caller
 * says "back to the built-in name".
 */
export function normaliseAgentName(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : null
}

interface Override {
  instructions: string
  displayName: string | null
}

async function read(workspaceId: string, agentKey: string): Promise<Override | null> {
  const [row] = await db()
    .select({
      instructions: schema.agentInstructions.instructions,
      displayName: schema.agentInstructions.displayName,
    })
    .from(schema.agentInstructions)
    .where(
      and(
        eq(schema.agentInstructions.workspaceId, workspaceId),
        eq(schema.agentInstructions.agentKey, agentKey),
      ),
    )
    .limit(1)

  return row ?? null
}

/**
 * Write the row, or delete it once it holds nothing.
 *
 * A row with no instructions and no name is not a setting, it is a leftover,
 * and leaving it behind would mean "cleared" and "never set" looked different
 * in the database while looking identical on screen.
 */
async function write(workspaceId: string, agentKey: string, next: Override): Promise<void> {
  if (!next.instructions && next.displayName === null) {
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
    .values({ workspaceId, agentKey, ...next })
    .onConflictDoUpdate({
      target: [schema.agentInstructions.workspaceId, schema.agentInstructions.agentKey],
      set: { ...next, updatedAt: new Date() },
    })
}

export async function getInstructions(
  workspaceId: string,
  agentKey: string,
): Promise<string | null> {
  const row = await read(workspaceId, agentKey)
  return row?.instructions || null
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

  // Rows that exist only to carry a name have no instructions to report, and
  // an empty string in this map would show the panel a saved-but-blank field.
  return Object.fromEntries(rows.filter((r) => r.instructions).map((r) => [r.agentKey, r.instructions]))
}

/** Save instructions, keeping whatever name this workspace has chosen. */
export async function setInstructions(
  workspaceId: string,
  agentKey: string,
  instructions: string,
): Promise<void> {
  const existing = await read(workspaceId, agentKey)
  await write(workspaceId, agentKey, {
    instructions: instructions.trim(),
    displayName: existing?.displayName ?? null,
  })
}

/**
 * Every name this workspace has chosen, keyed by agent.
 *
 * Only the agents that were actually renamed appear. The caller falls back to
 * the registry for the rest, which is what keeps a renamed registry reaching
 * workspaces that never touched that agent.
 */
export async function listAgentNames(
  workspaceId: string,
): Promise<Record<string, string>> {
  const rows = await db()
    .select({
      agentKey: schema.agentInstructions.agentKey,
      displayName: schema.agentInstructions.displayName,
    })
    .from(schema.agentInstructions)
    .where(eq(schema.agentInstructions.workspaceId, workspaceId))

  return Object.fromEntries(
    rows.filter((r): r is { agentKey: string; displayName: string } => !!r.displayName)
      .map((r) => [r.agentKey, r.displayName]),
  )
}

/**
 * Rename an agent, or hand it back its built-in name.
 *
 * `name` is what the user typed. A name that is empty once tidied clears the
 * override rather than saving a blank, because a blank name would render as a
 * card with nothing on it and no way to get the old one back.
 */
export async function setAgentName(
  workspaceId: string,
  agentKey: string,
  name: string,
): Promise<string | null> {
  const displayName = normaliseAgentName(name)
  const existing = await read(workspaceId, agentKey)
  await write(workspaceId, agentKey, {
    instructions: existing?.instructions ?? '',
    displayName,
  })
  return displayName
}
