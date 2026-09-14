import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from '../config.js'
import * as schema from './schema.js'

/**
 * The database handle.
 *
 * One pool for the process, created lazily so importing this module in a test
 * that never touches Postgres does not try to open a connection.
 */

export type Database = ReturnType<typeof drizzle<typeof schema>>

let client: postgres.Sql | null = null
let database: Database | null = null
let override: Database | null = null

/**
 * Point every caller at a different database.
 *
 * Used by the integration tests, which run against an in-process Postgres so
 * they exercise the real schema, real constraints and real transactions
 * rather than a hand-written fake that agrees with whatever the code does.
 * Pass null to restore normal behaviour.
 */
export function setDatabase(instance: Database | null): void {
  override = instance
}

export function db(): Database {
  if (override) return override
  if (database) return database

  client = postgres(config().DATABASE_URL, {
    // Agent runs are bursty: a wave of four agents opens four connections at
    // once, then nothing for a minute. Keep the ceiling modest and let
    // idle connections close rather than holding them open.
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
  })

  database = drizzle(client, { schema })
  return database
}

/** Close the pool. Called on shutdown so in-flight queries drain cleanly. */
export async function closeDb(): Promise<void> {
  if (!client) return
  await client.end({ timeout: 5 })
  client = null
  database = null
}

export { schema }
