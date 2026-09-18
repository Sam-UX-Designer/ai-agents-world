'use client'

import type { AgentInfo } from '@/lib/api'
import { useWorld } from '@/lib/store'

/**
 * What is actually happening, in one place.
 *
 * Opened from the progress card. Answers the question a person has thirty
 * seconds after pressing send: what did I ask for, who has it, are they
 * getting anywhere, and what came back. Without this the only signal was a
 * percentage, which is the same view whether the run is healthy or stuck.
 */
export function TaskDetail({
  agents,
  onClose,
}: {
  agents: readonly AgentInfo[]
  onClose: () => void
}) {
  const goalPrompt = useWorld((s) => s.goalPrompt)
  const goalState = useWorld((s) => s.goalState)
  const goalError = useWorld((s) => s.goalError)
  const interpretation = useWorld((s) => s.interpretation)
  const summary = useWorld((s) => s.summary)
  const tasks = useWorld((s) => s.tasks)
  const agentStates = useWorld((s) => s.agents)
  const activity = useWorld((s) => s.activity)

  const list = Object.values(tasks)
  const name = (key: string) => agents.find((a) => a.key === key)?.name ?? key

  return (
    <aside className="taskdetail lg" aria-label="Current task">
      <header className="taskdetail__head">
        <h2>{goalState === 'completed' ? 'Task complete' : 'Task in progress'}</h2>
        <button onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
            <path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="taskdetail__body">
        <section>
          <h3 className="taskdetail__label">You asked</h3>
          <p className="taskdetail__prompt">{goalPrompt ?? '—'}</p>
        </section>

        {interpretation && (
          <section>
            <h3 className="taskdetail__label">The Orchestrator understood</h3>
            <p className="taskdetail__text">{interpretation}</p>
          </section>
        )}

        <section>
          <h3 className="taskdetail__label">
            {list.length > 0 ? `Assigned to ${list.length === 1 ? '1 agent' : `${list.length} tasks`}` : 'Assigning'}
          </h3>

          {list.length === 0 ? (
            <p className="taskdetail__text">
              The Orchestrator is still reading your goal and choosing who should take it.
            </p>
          ) : (
            <ul className="taskdetail__tasks">
              {list.map((task) => {
                const view = agentStates[task.agentKey]
                return (
                  <li key={task.id} data-state={task.state}>
                    <span className="taskdetail__who">
                      <strong>{name(task.agentKey)}</strong>
                      <em>{task.title}</em>
                    </span>
                    <span className="taskdetail__state">
                      {/* The agent's own words when it is running, the task's
                          state once it is not - so a working agent says what
                          it is doing rather than just that it is busy. */}
                      {task.state === 'running' ? (view?.activity ?? 'Working') : STATE_WORD[task.state] ?? task.state}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {activity.length > 0 && (
          <section>
            <h3 className="taskdetail__label">Latest activity</h3>
            <ul className="taskdetail__activity">
              {activity.slice(0, 4).map((entry) => (
                <li key={entry.seq} data-outcome={entry.outcome}>
                  <strong>{name(entry.agentKey)}</strong>
                  <em>{entry.summary}</em>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="taskdetail__label">Result</h3>
          {summary ? (
            <p className="taskdetail__summary">{summary}</p>
          ) : goalState === 'failed' ? (
            <p className="taskdetail__failed">{goalError ?? 'This goal could not be finished.'}</p>
          ) : (
            <p className="taskdetail__text">
              The answer appears here as soon as the agents are done.
            </p>
          )}
        </section>
      </div>
    </aside>
  )
}

const STATE_WORD: Record<string, string> = {
  pending: 'Queued',
  running: 'Working',
  succeeded: 'Done',
  failed: 'Failed',
  awaiting_approval: 'Needs you',
  cancelled: 'Cancelled',
}
