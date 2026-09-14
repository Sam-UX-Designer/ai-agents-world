import type { WorldEvent } from '@agents-world/shared'

/**
 * The event bus: the one road from backend state to the 3D world.
 *
 * Everything the island shows arrives through here. Two guarantees it exists
 * to provide:
 *
 *  - Ordering. Sequence numbers are assigned here, one at a time per goal, so
 *    two agents finishing in the same millisecond still produce a total order
 *    every client agrees on.
 *
 *  - Durability before delivery. An event is persisted, then broadcast. A
 *    client that misses a frame can always replay it; a client that receives
 *    a frame can always be sure it survived. Doing this the other way round
 *    means a crash between send and save leaves clients ahead of the truth,
 *    showing work the server has no record of.
 */

/**
 * What a payload looks like before the bus stamps it with seq and time.
 *
 * Distributes over the union deliberately. A bare `Omit<WorldEvent, ...>`
 * collapses a discriminated union to the keys every member shares, which
 * would silently erase `agentKey`, `taskId` and the rest - every event would
 * typecheck as the empty intersection and every real field would be rejected.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

export type EventDraft = DistributiveOmit<WorldEvent, 'seq' | 'at'>

export interface EventStore {
  /**
   * Reserve the next sequence number for a goal and persist the event.
   * Must be atomic: two concurrent agents must never receive the same seq.
   */
  append(goalId: string, draft: EventDraft): Promise<WorldEvent>
  /** Events after `sinceSeq`, in order. The reconnect path. */
  replay(goalId: string, sinceSeq: number): Promise<readonly WorldEvent[]>
}

export type Subscriber = (event: WorldEvent) => void

export class EventBus {
  readonly #store: EventStore
  readonly #subscribers = new Map<string, Set<Subscriber>>()

  constructor(store: EventStore) {
    this.#store = store
  }

  /**
   * Persist an event, then deliver it to everyone watching the goal.
   *
   * A subscriber that throws is isolated: one browser with a broken handler
   * must not stop the other viewers of the same goal from seeing the world
   * move, and must never fail the agent run that emitted the event.
   */
  async emit(draft: EventDraft): Promise<WorldEvent> {
    const event = await this.#store.append(draft.goalId, draft)

    for (const subscriber of this.#subscribers.get(draft.goalId) ?? []) {
      try {
        subscriber(event)
      } catch (err) {
        console.error('[bus] subscriber threw, dropping it for this frame', err)
      }
    }

    return event
  }

  /**
   * Watch a goal from `sinceSeq`.
   *
   * The backlog is replayed before the subscriber is registered for live
   * frames, so a reconnecting client sees every event exactly once and in
   * order. Registering first would let a live frame arrive mid-replay and
   * land out of order.
   */
  async subscribe(
    goalId: string,
    sinceSeq: number,
    subscriber: Subscriber,
  ): Promise<() => void> {
    for (const event of await this.#store.replay(goalId, sinceSeq)) {
      subscriber(event)
    }

    let set = this.#subscribers.get(goalId)
    if (!set) {
      set = new Set()
      this.#subscribers.set(goalId, set)
    }
    set.add(subscriber)

    return () => {
      const current = this.#subscribers.get(goalId)
      if (!current) return
      current.delete(subscriber)
      if (current.size === 0) this.#subscribers.delete(goalId)
    }
  }

  /** Live watchers of a goal. Used by tests and the health endpoint. */
  subscriberCount(goalId: string): number {
    return this.#subscribers.get(goalId)?.size ?? 0
  }
}
