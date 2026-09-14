import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { setDatabase, type Database } from '../db/client.js'
import * as schema from '../db/schema.js'

/**
 * A real Postgres for each test, in-process.
 *
 * PGlite is Postgres compiled to WebAssembly, so these tests run against the
 * actual schema - real foreign keys, real unique constraints, real
 * transactions. A hand-written fake would agree with whatever the code does,
 * which is the opposite of what a test is for.
 */
export async function freshDatabase(): Promise<Database> {
  const pg = new PGlite()
  const database = drizzle(pg, { schema }) as unknown as Database

  const dir = join(process.cwd(), 'drizzle')
  const migrations = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of migrations) {
    const sql = readFileSync(join(dir, file), 'utf8')
    // Drizzle separates statements with this marker; PGlite's exec runs one
    // statement at a time, so the file has to be split the same way.
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim()
      if (trimmed) await pg.exec(trimmed)
    }
  }

  setDatabase(database)
  return database
}

/** A workspace with one member, the starting point for most tests. */
export async function seedWorkspace(database: Database): Promise<{
  workspaceId: string
  userId: string
}> {
  const [user] = await database
    .insert(schema.users)
    .values({ email: `user-${Math.random().toString(36).slice(2)}@example.com`, name: 'Test User' })
    .returning({ id: schema.users.id })

  const [workspace] = await database
    .insert(schema.workspaces)
    .values({ name: 'Test Workspace' })
    .returning({ id: schema.workspaces.id })

  if (!user || !workspace) throw new Error('seed failed')

  await database.insert(schema.workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
  })

  return { workspaceId: workspace.id, userId: user.id }
}

export async function seedGoal(
  database: Database,
  workspaceId: string,
  userId: string,
  prompt = 'Summarise my week',
): Promise<string> {
  const [goal] = await database
    .insert(schema.goals)
    .values({ workspaceId, userId, prompt })
    .returning({ id: schema.goals.id })
  if (!goal) throw new Error('seed goal failed')
  return goal.id
}

export { schema }
