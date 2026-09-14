'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentInfo } from '@/lib/api'
import { api } from '@/lib/api'
import { WorldSocket } from '@/lib/socket'
import { useWorld } from '@/lib/store'
import { Hero } from '@/components/hero/Hero'
import { AgentPanel } from '@/components/ui/AgentPanel'
import { ApprovalSheet } from '@/components/ui/ApprovalSheet'
import { Results } from '@/components/ui/Results'
import { TaskProgress } from '@/components/ui/TaskProgress'

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
  const dockRef = useRef<HTMLDivElement>(null)
  const selectedAgent = useWorld((s) => s.selectedAgent)
  const setSelected = useWorld((s) => s.selectAgent)
  const summary = useWorld((s) => s.summary)
  const goalId = useWorld((s) => s.goalId)
  const goalState = useWorld((s) => s.goalState)

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

  // On a phone the dock sits below the prompt in the flow, so a result that
  // arrives while the user is looking at the island lands off screen. Bring it
  // into view once, when it first appears - and only where it is actually out
  // of view, so the desktop layout is left alone.
  useEffect(() => {
    if (!summary && goalState !== 'failed') return
    const dock = dockRef.current
    if (!dock) return
    if (window.matchMedia('(min-width: 901px)').matches) return
    dock.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [summary, goalState])

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
        <div className="agent-dock">
          <AgentPanel agents={agents} />
        </div>
      )}

      {/* Progress while it runs, the result when it finishes. Never both:
          once the answer exists, the breakdown is history. */}
      <div className="world-dock" aria-live="polite" ref={dockRef}>
        {goalId && !summary && goalState !== 'failed' && <TaskProgress agents={agents} />}
        {(summary || goalState === 'failed') && <Results />}
      </div>

      <ApprovalSheet />
    </main>
  )
}
