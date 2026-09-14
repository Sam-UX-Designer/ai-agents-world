'use client'

import { useMemo } from 'react'
import type { AgentInfo } from '@/lib/api'
import { useWorld, type TaskView } from '@/lib/store'

/**
 * Task progress: what the Orchestrator is doing, and how far each department
 * has got.
 *
 * The stages below are not invented UI steps. Each one maps to a real goal
 * state the backend reports, so a tick here means the backend actually
 * finished that phase. Inventing a five-step checklist and advancing it on a
 * timer is the exact thing this product is supposed to not be.
 */

type StageState = 'pending' | 'active' | 'done' | 'blocked' | 'failed'

interface Stage {
  readonly id: string
  readonly label: string
  readonly state: StageState
  /** Shown under the label when there is something real to say. */
  readonly detail: string | null
}

/** Order the backend actually moves through. */
const GOAL_ORDER = ['submitted', 'planning', 'executing', 'synthesising', 'completed']

function stageStateFor(
  stageIndex: number,
  currentIndex: number,
  goalState: string,
): StageState {
  if (goalState === 'failed') return stageIndex <= currentIndex ? 'failed' : 'pending'
  if (goalState === 'awaiting_approval' && stageIndex === 2) return 'blocked'
  if (stageIndex < currentIndex) return 'done'
  if (stageIndex === currentIndex) return goalState === 'completed' ? 'done' : 'active'
  return 'pending'
}

export function TaskProgress({ agents }: { agents: readonly AgentInfo[] }) {
  const goalId = useWorld((s) => s.goalId)
  const goalState = useWorld((s) => s.goalState)
  const goalError = useWorld((s) => s.goalError)
  const interpretation = useWorld((s) => s.interpretation)
  const tasks = useWorld((s) => s.tasks)
  const agentStates = useWorld((s) => s.agents)
  const approvals = useWorld((s) => s.approvals)
  const selectAgent = useWorld((s) => s.selectAgent)

  const taskList = useMemo(() => Object.values(tasks), [tasks])
  const done = taskList.filter((t) => t.state === 'succeeded').length

  const stages = useMemo<Stage[]>(() => {
    // awaiting_approval is a pause inside execution, not a phase of its own,
    // so it reports at the execution index rather than advancing past it.
    const effective = goalState === 'awaiting_approval' ? 'executing' : goalState
    const currentIndex = Math.max(GOAL_ORDER.indexOf(effective), 0)

    const assigned = new Set(taskList.map((t) => t.agentKey))
    const names = [...assigned]
      .map((key) => agents.find((a) => a.key === key)?.name.replace(' Agent', '') ?? key)
      .join(', ')

    return [
      {
        id: 'understand',
        label: 'Understand the goal',
        state: stageStateFor(1, currentIndex, goalState),
        detail: interpretation,
      },
      {
        id: 'assign',
        label: 'Choose the departments',
        state: taskList.length > 0 ? 'done' : stageStateFor(1, currentIndex, goalState),
        detail: names || null,
      },
      {
        id: 'work',
        label: 'Departments do the work',
        state: stageStateFor(2, currentIndex, goalState),
        detail:
          taskList.length > 0
            ? approvals.length > 0
              ? `Paused - ${approvals.length} action${approvals.length === 1 ? '' : 's'} need you`
              : `${done} of ${taskList.length} tasks done`
            : null,
      },
      {
        id: 'combine',
        label: 'Combine the results',
        state: stageStateFor(3, currentIndex, goalState),
        detail: null,
      },
    ]
  }, [goalState, taskList, interpretation, agents, done, approvals.length])

  if (!goalId) return null

  return (
    <section className="glass" style={{ padding: 18 }} aria-label="Task progress">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--color-text-dim)' }}>
          Task breakdown
        </h2>
        {taskList.length > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--color-text-dim)' }}>
            {done}/{taskList.length}
          </span>
        )}
      </header>

      {goalError && (
        <p
          role="alert"
          style={{
            margin: '0 0 14px', padding: 11, borderRadius: 10, fontSize: 12.5,
            background: 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-danger) 32%, transparent)',
            color: 'var(--color-danger)',
          }}
        >
          {goalError}
        </p>
      )}

      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 11 }}>
        {stages.map((stage) => (
          <li key={stage.id} style={{ display: 'flex', gap: 10 }}>
            <StageMark state={stage.state} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p
                style={{
                  margin: 0, fontSize: 13,
                  fontWeight: stage.state === 'active' ? 600 : 500,
                  color: stage.state === 'pending' ? 'var(--color-text-dim)' : 'var(--color-text)',
                }}
              >
                {stage.label}
              </p>
              {stage.detail && (
                <p
                  style={{
                    margin: '2px 0 0', fontSize: 11.5, lineHeight: 1.45,
                    color: stage.state === 'blocked' ? 'var(--color-warn)' : 'var(--color-text-dim)',
                    // An interpretation can be a paragraph; clamp it rather
                    // than letting one stage push the rest off screen.
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {stage.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {taskList.length > 0 && (
        <>
          <h3
            style={{
              margin: '18px 0 9px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em',
              textTransform: 'uppercase', color: 'var(--color-text-dim)',
            }}
          >
            By department
          </h3>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {taskList.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                agent={agents.find((a) => a.key === task.agentKey)}
                activity={agentStates[task.agentKey]?.activity}
                onSelect={() => selectAgent(task.agentKey)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function TaskRow({
  task,
  agent,
  activity,
  onSelect,
}: {
  task: TaskView
  agent: AgentInfo | undefined
  activity: string | undefined
  onSelect: () => void
}) {
  const running = task.state === 'running'

  return (
    <li>
      <button
        onClick={onSelect}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 9,
          padding: '8px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
          fontFamily: 'inherit', color: 'var(--color-text)',
          background: 'color-mix(in srgb, var(--color-ink-900) 45%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-accent) 12%, transparent)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: taskColour(task.state, agent?.accent ?? '#4DA3FF'),
          }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {task.title}
          </span>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {agent?.name.replace(' Agent', '') ?? task.agentKey}
            {running && activity ? ` · ${activity}` : ''}
          </span>
        </span>
        {/* A step count, never a percentage: the agent decides how many calls
            it needs, so there is no honest denominator to divide by. */}
        {running && task.completedSteps > 0 && (
          <span style={{ fontSize: 10.5, color: 'var(--color-text-dim)', flexShrink: 0 }}>
            {task.completedSteps} step{task.completedSteps === 1 ? '' : 's'}
          </span>
        )}
      </button>
    </li>
  )
}

function StageMark({ state }: { state: StageState }) {
  const common = {
    width: 17, height: 17, borderRadius: '50%', flexShrink: 0, marginTop: 1,
    display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: 700,
  } as const

  if (state === 'done') {
    return <span aria-label="done" style={{ ...common, background: 'var(--color-ok)', color: 'var(--color-ink-900)' }}>✓</span>
  }
  if (state === 'failed') {
    return <span aria-label="failed" style={{ ...common, background: 'var(--color-danger)', color: 'var(--color-ink-900)' }}>!</span>
  }
  if (state === 'blocked') {
    return <span aria-label="waiting for you" style={{ ...common, background: 'var(--color-warn)', color: 'var(--color-ink-900)' }}>?</span>
  }
  if (state === 'active') {
    return (
      <span aria-label="in progress" style={{ ...common, border: '2px solid var(--color-accent)' }}>
        <span className="agent-label__pulse" style={{ width: 5, height: 5 }} />
      </span>
    )
  }
  return <span aria-label="not started" style={{ ...common, border: '2px solid color-mix(in srgb, var(--color-text-dim) 40%, transparent)' }} />
}

function taskColour(state: string, accent: string): string {
  if (state === 'succeeded') return 'var(--color-ok)'
  if (state === 'failed') return 'var(--color-danger)'
  if (state === 'cancelled') return 'var(--color-text-dim)'
  if (state === 'awaiting_approval') return 'var(--color-warn)'
  if (state === 'running') return accent
  return 'var(--color-text-dim)'
}
