'use client'

import { create } from 'zustand'
import type {
  AgentState,
  ProgressConfidence,
  TaskState,
  WorldEvent,
} from '@agents-world/shared'

/**
 * The world state the 3D island renders.
 *
 * This store is a projection of the backend's event log and nothing else.
 * There is deliberately no action here that sets an agent to `working` - the
 * only way an agent changes state is `apply(event)`. That is the structural
 * version of "the 3D world never invents state": a component that wanted to
 * fake activity would have to fabricate an event, and there is no function
 * that lets it.
 */

export interface AgentView {
  readonly key: string
  readonly state: AgentState
  /** Plain language, shown on the island label and in the detail panel. */
  readonly activity: string
  readonly taskId: string | null
  readonly error: string | null
  /** Server time of the last change, for "working for 12s" style readouts. */
  readonly since: number
}

export interface TaskView {
  readonly id: string
  readonly title: string
  readonly agentKey: string
  readonly state: TaskState
  readonly dependsOn: readonly string[]
  readonly completedSteps: number
  readonly totalSteps: number | null
  readonly confidence: ProgressConfidence
  readonly error: string | null
}

export interface ActivityEntry {
  readonly seq: number
  readonly agentKey: string
  readonly toolId: string
  readonly summary: string
  readonly outcome: 'succeeded' | 'failed' | 'denied'
  readonly at: string
}

export interface ApprovalView {
  readonly id: string
  readonly taskId: string
  readonly agentKey: string
  readonly actionType: string
  readonly description: string
  readonly preview: string | null
}

export interface WorldState {
  goalId: string | null
  goalState: string
  goalError: string | null
  interpretation: string | null
  summary: string | null
  agents: Record<string, AgentView>
  tasks: Record<string, TaskView>
  activity: ActivityEntry[]
  approvals: ApprovalView[]
  artifacts: { artifactId: string; title: string; kind: string }[]
  /** Highest seq applied. Sent on reconnect to ask for exactly the gap. */
  lastSeq: number
  connection: 'connecting' | 'live' | 'reconnecting' | 'offline'
  /** Which agent the detail panel is showing. Client-only - never from an event. */
  selectedAgent: string | null

  apply: (event: WorldEvent) => void
  beginGoal: (goalId: string, sinceSeq: number) => void
  setConnection: (status: WorldState['connection']) => void
  selectAgent: (agentKey: string | null) => void
  reset: () => void
}

const idleAgent = (key: string): AgentView => ({
  key,
  state: 'idle',
  activity: 'Waiting for work',
  taskId: null,
  error: null,
  since: Date.now(),
})

const EMPTY = {
  goalId: null,
  goalState: 'submitted',
  goalError: null,
  interpretation: null,
  summary: null,
  agents: {} as Record<string, AgentView>,
  tasks: {} as Record<string, TaskView>,
  activity: [] as ActivityEntry[],
  approvals: [] as ApprovalView[],
  artifacts: [] as { artifactId: string; title: string; kind: string }[],
  lastSeq: -1,
  connection: 'offline' as const,
  selectedAgent: null,
}

export const useWorld = create<WorldState>((set) => ({
  ...EMPTY,

  beginGoal: (goalId, sinceSeq) =>
    set({ ...EMPTY, goalId, lastSeq: sinceSeq - 1, connection: 'connecting' }),

  setConnection: (connection) => set({ connection }),

  selectAgent: (selectedAgent) => set({ selectedAgent }),

  reset: () => set({ ...EMPTY }),

  apply: (event) =>
    set((current) => {
      // Ordering is enforced here, once, rather than trusted at every call
      // site. A frame that arrives late - a duplicate after a reconnect, or a
      // packet overtaken in flight - is dropped, never applied. Without this
      // a stale packet could resurrect an agent that has already finished.
      if (event.seq <= current.lastSeq) return current

      const base = { lastSeq: event.seq }

      switch (event.type) {
        case 'goal.state_changed':
          return { ...base, goalState: event.state, goalError: event.error }

        case 'plan.created': {
          const tasks = { ...current.tasks }
          const agents = { ...current.agents }

          for (const task of event.tasks) {
            tasks[task.taskId] = {
              id: task.taskId,
              title: task.title,
              agentKey: task.agentKey,
              state: 'pending',
              dependsOn: task.dependsOn,
              completedSteps: 0,
              totalSteps: null,
              confidence: 'measured',
              error: null,
            }
            agents[task.agentKey] ??= idleAgent(task.agentKey)
          }

          return { ...base, interpretation: event.interpretation, tasks, agents }
        }

        case 'agent.state_changed': {
          const previous = current.agents[event.agentKey] ?? idleAgent(event.agentKey)
          return {
            ...base,
            agents: {
              ...current.agents,
              [event.agentKey]: {
                ...previous,
                state: event.state,
                activity: event.activity,
                taskId: event.taskId,
                error: event.error,
                // Only restamped on a real transition, so an agent that keeps
                // reporting the same state still shows how long it has been in it.
                since: previous.state === event.state ? previous.since : Date.parse(event.at),
              },
            },
          }
        }

        case 'task.state_changed': {
          const task = current.tasks[event.taskId]
          if (!task) return { ...base }
          return {
            ...base,
            tasks: {
              ...current.tasks,
              [event.taskId]: { ...task, state: event.state, error: event.error },
            },
          }
        }

        case 'task.progress': {
          const task = current.tasks[event.taskId]
          if (!task) return { ...base }
          return {
            ...base,
            tasks: {
              ...current.tasks,
              [event.taskId]: {
                ...task,
                completedSteps: event.completedSteps,
                totalSteps: event.totalSteps,
                // Carried through rather than flattened, so the UI can render
                // a measured bar and an estimated one differently.
                confidence: event.confidence,
              },
            },
          }
        }

        case 'tool.called':
          return {
            ...base,
            activity: [
              {
                seq: event.seq,
                agentKey: event.agentKey,
                toolId: event.toolId,
                summary: event.summary,
                outcome: event.outcome,
                at: event.at,
              },
              // Newest first, capped. A long-running goal can produce hundreds
              // of calls and the panel only ever shows the recent ones.
              ...current.activity,
            ].slice(0, 200),
          }

        case 'approval.requested':
          return {
            ...base,
            approvals: [
              ...current.approvals,
              {
                id: event.approvalId,
                taskId: event.taskId,
                agentKey: event.agentKey,
                actionType: event.actionType,
                description: event.description,
                preview: event.preview,
              },
            ],
          }

        case 'approval.resolved':
          return {
            ...base,
            approvals: current.approvals.filter((a) => a.id !== event.approvalId),
          }

        case 'goal.completed':
          return {
            ...base,
            goalState: 'completed',
            summary: event.summary,
            artifacts: [...event.artifacts],
          }
      }
    }),
}))

/** Agents that are genuinely doing something right now. */
export const activeAgents = (state: WorldState): AgentView[] =>
  Object.values(state.agents).filter((a) =>
    ['planning', 'spawning', 'working'].includes(a.state),
  )
