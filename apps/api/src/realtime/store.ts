import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { parseWorldEvent, type WorldEvent } from '@agents-world/shared'
import { db, schema } from '../db/client.js'
import type { EventDraft, EventStore } from './bus.js'

/**
 * Postgres-backed event store.
 *
 * The sequence number is allocated by the database, not by the process, in
 * the same transaction that writes the row. Two agents finishing in the same
 * millisecond on two different API instances therefore still get distinct,
 * ordered sequence numbers - which an in-memory counter could not promise the
 * moment we run more than one instance.
 */
export class PostgresEventStore implements EventStore {
  async append(goalId: string, draft: EventDraft): Promise<WorldEvent> {
    return db().transaction(async (tx) => {
      // Atomic read-and-increment. The UPDATE takes a row lock, so concurrent
      // emitters for the same goal queue here rather than racing.
      const [goal] = await tx
        .update(schema.goals)
        .set({ nextSeq: sql`${schema.goals.nextSeq} + 1` })
        .where(eq(schema.goals.id, goalId))
        .returning({ nextSeq: schema.goals.nextSeq })

      if (!goal) throw new Error(`Cannot emit event: unknown goal ${goalId}`)

      const seq = goal.nextSeq - 1
      const event = { ...draft, seq, at: new Date().toISOString() } as WorldEvent

      await tx.insert(schema.worldEvents).values({
        goalId,
        workspaceId: draft.workspaceId,
        seq,
        type: draft.type,
        payload: event as unknown as Record<string, unknown>,
      })

      return event
    })
  }

  async replay(goalId: string, sinceSeq: number): Promise<readonly WorldEvent[]> {
    const rows = await db()
      .select({ payload: schema.worldEvents.payload })
      .from(schema.worldEvents)
      .where(
        and(eq(schema.worldEvents.goalId, goalId), gt(schema.worldEvents.seq, sinceSeq - 1)),
      )
      .orderBy(asc(schema.worldEvents.seq))

    // A row that no longer parses means the protocol changed under a stored
    // event. Drop it rather than crash the reconnect: a client missing one
    // old frame recovers, a client that cannot reconnect at all does not.
    return rows
      .map((r) => parseWorldEvent(r.payload))
      .filter((e): e is WorldEvent => e !== null)
  }
}

/**
 * In-memory store, for tests and local runs without Postgres.
 *
 * Same contract, no durability. Deliberately simple so a test that exercises
 * ordering is testing the bus, not a database.
 */
export class MemoryEventStore implements EventStore {
  readonly #events = new Map<string, WorldEvent[]>()

  async append(goalId: string, draft: EventDraft): Promise<WorldEvent> {
    const log = this.#events.get(goalId) ?? []
    const event = { ...draft, seq: log.length, at: new Date().toISOString() } as WorldEvent
    log.push(event)
    this.#events.set(goalId, log)
    return event
  }

  async replay(goalId: string, sinceSeq: number): Promise<readonly WorldEvent[]> {
    return (this.#events.get(goalId) ?? []).filter((e) => e.seq >= sinceSeq)
  }

  all(goalId: string): readonly WorldEvent[] {
    return this.#events.get(goalId) ?? []
  }
}
