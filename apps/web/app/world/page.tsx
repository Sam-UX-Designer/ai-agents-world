'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentInfo } from '@/lib/api'
import { api } from '@/lib/api'
import { WorldSocket } from '@/lib/socket'
import { useWorld } from '@/lib/store'
import { Hero } from '@/components/hero/Hero'
import { AgentPanel } from '@/components/ui/AgentPanel'
import { ApprovalSheet } from '@/components/ui/ApprovalSheet'

/**
 * The Agent World.
 *
 * The hero is the whole experience: the island, the agents on it, and the one
 * field where a goal is stated. Everything else - the detail panel, the
 * approval sheet - appears over it when there is something to show.
 */
export default function WorldPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const socket = useRef<WorldSocket | null>(null)
  const selectedAgent = useWorld((s) => s.selectedAgent)
  const setSelected = useWorld((s) => s.selectAgent)
  const summary = useWorld((s) => s.summary)

  useEffect(() => {
    api
      .agents()
      .then(setAgents)
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : 'Could not load the agents'),
      )
  }, [])

  // One socket for the page's lifetime, torn down on unmount so navigating
  // away does not leave a subscription open on the server.
  useEffect(() => {
    socket.current = new WorldSocket()
    return () => {
      socket.current?.disconnect()
      socket.current = null
    }
  }, [])

  const onGoalStarted = useCallback((event: Event) => {
    const { goalId } = (event as CustomEvent<{ goalId: string }>).detail
    socket.current?.connect(goalId)
  }, [])

  useEffect(() => {
    window.addEventListener('goal:started', onGoalStarted)
    return () => window.removeEventListener('goal:started', onGoalStarted)
  }, [onGoalStarted])

  if (loadError) {
    return (
      <main style={{ display: 'grid', placeItems: 'center', height: '100dvh', padding: 24 }}>
        <div className="glass" style={{ padding: 24, maxWidth: 380, textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 17 }}>Could not load the world</h1>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-dim)' }}>{loadError}</p>
          <a className="btn btn--primary" href="/signin">Sign in</a>
        </div>
      </main>
    )
  }

  return (
    <main style={{ position: 'relative', minHeight: '100dvh' }}>
      {agents.length > 0 && <Hero agents={agents} />}

      {selectedAgent && (
        <div
          style={{
            position: 'fixed', right: 16, top: 76, zIndex: 40,
            width: 'min(340px, calc(100vw - 32px))',
            maxHeight: 'calc(100dvh - 100px)', overflowY: 'auto',
          }}
        >
          <AgentPanel agents={agents} />
        </div>
      )}

      {summary && (
        <div
          style={{
            position: 'fixed', left: 16, bottom: 100, zIndex: 40,
            width: 'min(400px, calc(100vw - 32px))',
            maxHeight: '45dvh', overflowY: 'auto',
          }}
        >
          <section className="glass" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--color-ok)' }} />
              <h2 style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--color-ok)' }}>
                Done
              </h2>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {summary}
            </p>
            <button className="btn btn--ghost" style={{ width: '100%' }} onClick={() => useWorld.getState().reset()}>
              New goal
            </button>
          </section>
        </div>
      )}

      <ApprovalSheet />
    </main>
  )
}
