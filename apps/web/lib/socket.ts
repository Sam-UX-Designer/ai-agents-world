'use client'

import { parseWorldEvent } from '@agents-world/shared'
import { useWorld } from './store'

/**
 * The live connection to the backend.
 *
 * Reconnect is the whole job here. A user watching six agents work will lose
 * their connection - phone sleeps, wifi drops, laptop lid closes - and the
 * island must come back showing the truth rather than whatever it was frozen
 * on. On every reconnect we resubscribe from the last sequence number the
 * store applied, so the gap is replayed and nothing is missed or doubled.
 */

const MAX_BACKOFF_MS = 15_000
const BASE_BACKOFF_MS = 500

export class WorldSocket {
  #socket: WebSocket | null = null
  #goalId: string | null = null
  #attempt = 0
  #closedByUs = false
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null

  connect(goalId: string): void {
    this.#goalId = goalId
    this.#closedByUs = false
    this.#open()
  }

  #open(): void {
    const { protocol, host } = window.location
    const scheme = protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${scheme}//${host}/api/ws`)
    this.#socket = socket

    useWorld.getState().setConnection(this.#attempt === 0 ? 'connecting' : 'reconnecting')

    socket.addEventListener('open', () => {
      this.#attempt = 0
      this.#subscribe()
    })

    socket.addEventListener('message', (message) => {
      let payload: unknown
      try {
        payload = JSON.parse(message.data as string)
      } catch {
        return
      }

      const frame = payload as { type?: string }

      if (frame.type === 'ready') {
        this.#subscribe()
        return
      }
      if (frame.type === 'subscribed') {
        useWorld.getState().setConnection('live')
        return
      }
      if (frame.type === 'error' || frame.type === 'pong') return

      // Anything else must validate against the protocol before it is allowed
      // to change what the user sees. A frame we do not understand is dropped,
      // not guessed at.
      const event = parseWorldEvent(payload)
      if (event) useWorld.getState().apply(event)
    })

    socket.addEventListener('close', () => {
      if (this.#closedByUs) {
        useWorld.getState().setConnection('offline')
        return
      }
      this.#scheduleReconnect()
    })

    socket.addEventListener('error', () => socket.close())
  }

  #subscribe(): void {
    if (!this.#goalId || this.#socket?.readyState !== WebSocket.OPEN) return

    // lastSeq is the last frame actually applied, so the server replays from
    // the next one. Reading it at send time rather than caching it means a
    // reconnect mid-replay still asks for the right place.
    const sinceSeq = useWorld.getState().lastSeq + 1
    this.#socket.send(
      JSON.stringify({ type: 'subscribe', goalId: this.#goalId, sinceSeq }),
    )
  }

  #scheduleReconnect(): void {
    useWorld.getState().setConnection('reconnecting')

    // Exponential backoff with jitter. Without the jitter, every client that
    // dropped during a deploy comes back in the same millisecond and knocks
    // the API over a second time.
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** this.#attempt, MAX_BACKOFF_MS)
    const jittered = backoff * (0.5 + Math.random() * 0.5)
    this.#attempt++

    this.#reconnectTimer = setTimeout(() => this.#open(), jittered)
  }

  disconnect(): void {
    this.#closedByUs = true
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#socket?.close()
    this.#socket = null
    this.#goalId = null
    this.#attempt = 0
  }
}
