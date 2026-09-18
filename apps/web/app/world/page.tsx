'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AgentInfo, type Me } from '@/lib/api'
import { WorldSocket } from '@/lib/socket'
import { useWorld } from '@/lib/store'
import { Chrome } from '@/components/world/Chrome'
import { ActiveAgents, CommandBar, TaskInProgress, World } from '@/components/world/World'
import { AgentPanel } from '@/components/ui/AgentPanel'
import { TaskDetail } from '@/components/ui/TaskDetail'
import { ApprovalSheet } from '@/components/ui/ApprovalSheet'
import { Answer } from '@/components/ui/Answer'

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
  const [taskOpen, setTaskOpen] = useState(false)

  const socket = useRef<WorldSocket | null>(null)
  const selectedAgent = useWorld((s) => s.selectedAgent)

  useEffect(() => {
    api.agents().then(setAgents).catch(() => undefined)
    api.me().then(setMe).catch(() => undefined)
  }, [])

  // One socket for the page's lifetime, closed on unmount so navigating away
  // does not leave a subscription open on the server.
  useEffect(() => {
    socket.current = new WorldSocket()

    // A goal can be started from Tools or History, which then navigates here.
    // Reconnect to whatever is already in flight rather than showing an idle
    // world while agents are running.
    const existing = useWorld.getState().goalId
    if (existing) {
      socket.current.connect(existing)
      // The prompt lives in whichever tab submitted it. Arriving from Tools or
      // History, or after a refresh, it has to come back from the server or
      // the progress card cannot say what is running.
      if (!useWorld.getState().goalPrompt) {
        api
          .goal(existing)
          .then(({ goal }) => useWorld.getState().setGoalPrompt(goal.prompt))
          .catch(() => undefined)
      }
    }

    return () => {
      socket.current?.disconnect()
      socket.current = null
    }
  }, [])

  const onStarted = useCallback((id: string) => socket.current?.connect(id), [])

  return (
    <main>
      <World agents={agents} />

      <Chrome user={me ? { name: me.user.name, plan: 'Pro plan' } : null} />

      {/*
        Right side: who is working, or the one agent you asked about. The
        roster is the reference's panel - a separate task breakdown alongside
        it would be a dashboard section the design does not have, and the same
        information already reaches the user through the agents themselves and
        the progress card.
      */}
      {selectedAgent ? (
        /*
         * One right-hand rail, one panel in it.
         *
         * The agent detail used to open on the left, over the navigation, and
         * glass on top of glass on top of the island was three translucent
         * layers deep - unreadable. It lives on the right now, and takes the
         * rail rather than stacking under the roster: the roster is how you
         * reach the detail, so showing both would be showing the same agent
         * twice in one column.
         */
        <div className="agent-dock">
          <AgentPanel agents={agents} />
        </div>
      ) : (
        <ActiveAgents agents={agents} />
      )}

      {taskOpen && <TaskDetail agents={agents} onClose={() => setTaskOpen(false)} />}

      {/*
        The bottom of the screen, as one column.

        The reply sits with the thing that was typed into, not off in the rail
        - the rail keeps showing who is working, which is the question the
        roster answers and the answer does not.

        The progress card is in here too. On a wide screen it pulls itself out
        to the bottom-right corner where it has always been; on a phone there
        is no corner to spare, so it stays in the column and the three panels
        stack instead of landing on top of each other.
      */}
      <div className="composer">
        <TaskInProgress onOpen={() => setTaskOpen(true)} />
        <Answer />
        <CommandBar onStarted={onStarted} />
      </div>
      <ApprovalSheet />
    </main>
  )
}
