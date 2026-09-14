'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AgentInfo, type Me } from '@/lib/api'
import { WorldSocket } from '@/lib/socket'
import { useWorld } from '@/lib/store'
import { Chrome } from '@/components/world/Chrome'
import { ActiveAgents, CommandBar, TaskInProgress, World } from '@/components/world/World'
import { AgentPanel } from '@/components/ui/AgentPanel'
import { ApprovalSheet } from '@/components/ui/ApprovalSheet'
import { Results } from '@/components/ui/Results'

/**
 * Home - the Agent World.
 *
 * The page owns no layout of its own. The world is a fixed environment and
 * every child positions itself over it, which is what keeps the island
 * full-bleed rather than boxed inside a page shell.
 */
export default function HomePage() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [me, setMe] = useState<Me | null>(null)

  const socket = useRef<WorldSocket | null>(null)
  const selectedAgent = useWorld((s) => s.selectedAgent)
  const summary = useWorld((s) => s.summary)
  const goalId = useWorld((s) => s.goalId)
  const goalState = useWorld((s) => s.goalState)

  useEffect(() => {
    api.agents().then(setAgents).catch(() => undefined)
    api.me().then(setMe).catch(() => undefined)
  }, [])

  // One socket for the page's lifetime, closed on unmount so navigating away
  // does not leave a subscription open on the server.
  useEffect(() => {
    socket.current = new WorldSocket()
    return () => {
      socket.current?.disconnect()
      socket.current = null
    }
  }, [])

  const onStarted = useCallback((id: string) => socket.current?.connect(id), [])

  const showResult = Boolean(summary) || goalState === 'failed'

  return (
    <main>
      <World agents={agents} />

      <Chrome user={me ? { name: me.user.name, plan: 'Pro plan' } : null} />

      {/*
        Right side: the live agent roster while work is in flight, the result
        once it is done. The roster is the reference's panel - a separate task
        breakdown alongside it would be a dashboard section the design does not
        have, and the same information already reaches the user through the
        agents themselves and the progress card.
      */}
      {showResult ? (
        <div className="world-dock" aria-live="polite">
          <Results />
        </div>
      ) : (
        <ActiveAgents agents={agents} />
      )}

      {selectedAgent && (
        <div className="agent-dock">
          <AgentPanel agents={agents} />
        </div>
      )}

      <TaskInProgress />
      <CommandBar onStarted={onStarted} />
      <ApprovalSheet />
    </main>
  )
}
