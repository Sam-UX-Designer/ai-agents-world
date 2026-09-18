'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentState } from '@agents-world/shared'
import { api, type AgentInfo } from '@/lib/api'
import { useWorld } from '@/lib/store'

/**
 * The agent detail panel.
 *
 * The PRD asks for operational information, not a decorative tooltip: what
 * this agent is, what it was asked to do, how far it has got, what it can
 * reach, and what it has actually done. Everything shown here is backend
 * truth - if a field is unknown, it says so rather than showing a plausible
 * placeholder.
 */

const STATE_LABEL: Record<AgentState, string> = {
  idle: 'Idle',
  planning: 'Planning',
  spawning: 'Starting',
  working: 'Working',
  waiting: 'Waiting',
  needs_input: 'Needs you',
  completed: 'Finished',
  error: 'Could not finish',
}

const STATE_TONE: Record<AgentState, string> = {
  idle: 'var(--color-text-dim)',
  planning: 'var(--color-accent)',
  spawning: 'var(--color-accent)',
  working: 'var(--color-accent)',
  waiting: 'var(--color-text-dim)',
  needs_input: 'var(--color-warn)',
  completed: 'var(--color-ok)',
  error: 'var(--color-danger)',
}

export function AgentPanel({ agents }: { agents: readonly AgentInfo[] }) {
  const selected = useWorld((s) => s.selectedAgent)
  const selectAgent = useWorld((s) => s.selectAgent)
  const agentStates = useWorld((s) => s.agents)
  const tasks = useWorld((s) => s.tasks)
  const activity = useWorld((s) => s.activity)

  const definition = agents.find((a) => a.key === selected)
  const view = selected ? agentStates[selected] : undefined

  const task = useMemo(
    () => (view?.taskId ? tasks[view.taskId] : undefined),
    [view?.taskId, tasks],
  )

  const agentActivity = useMemo(
    () => activity.filter((entry) => entry.agentKey === selected).slice(0, 12),
    [activity, selected],
  )

  if (!definition) return null

  const state = view?.state ?? 'idle'

  return (
    <aside
      className="glass"
      style={{ padding: 20 }}
      aria-label={`${definition.name} details`}
    >
      <header style={{ display: 'flex', alignItems: 'start', gap: 12, marginBottom: 16 }}>
        <span
          aria-hidden="true"
          style={{
            width: 38, height: 38, borderRadius: 11, flexShrink: 0,
            background: `color-mix(in srgb, ${definition.accent} 25%, transparent)`,
            border: `1px solid ${definition.accent}`,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650 }}>{definition.name}</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--color-text-dim)' }}>
            {definition.role}
          </p>
        </div>
        <button
          className="btn btn--ghost"
          style={{ padding: '5px 10px', fontSize: 12 }}
          onClick={() => selectAgent(null)}
          aria-label="Close agent details"
        >
          Close
        </button>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8, height: 8, borderRadius: '50%', background: STATE_TONE[state],
          }}
        />
        {/* Written out, not just coloured - state must survive colour blindness
            and a greyscale screenshot alike. */}
        <span style={{ fontSize: 13, fontWeight: 600, color: STATE_TONE[state] }}>
          {STATE_LABEL[state]}
        </span>
      </div>

      {view?.error && (
        <p
          role="alert"
          style={{
            margin: '0 0 16px', padding: 11, borderRadius: 10, fontSize: 12.5,
            background: 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-danger) 35%, transparent)',
            color: 'var(--color-danger)',
          }}
        >
          {view.error}
        </p>
      )}

      <Section title="Current task">
        {task ? (
          <>
            <p style={{ margin: '0 0 4px', fontSize: 13.5, fontWeight: 550 }}>{task.title}</p>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-dim)' }}>
              {view?.activity}
            </p>
            <Progress
              completed={task.completedSteps}
              total={task.totalSteps}
              confidence={task.confidence}
            />
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-dim)' }}>
            {state === 'idle' ? 'Nothing assigned right now.' : view?.activity}
          </p>
        )}
      </Section>

      <Section title="Instructions">
        <p
          style={{
            margin: '0 0 12px', fontSize: 12, lineHeight: 1.55,
            color: 'var(--color-text-dim)', whiteSpace: 'pre-wrap',
          }}
        >
          {definition.instructions.split('\n\n')[0]}
        </p>
        <CustomInstructions agentKey={definition.key} agentName={definition.name} />
      </Section>

      <Section title={`Tools (${definition.tools.length})`}>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          {definition.tools.map((tool) => (
            <li
              key={tool.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, fontSize: 12,
              }}
            >
              <span>{tool.label}</span>
              {/* The user should be able to see, per tool, whether it can act
                  alone. This is the trust story made concrete. */}
              <span
                style={{
                  fontSize: 10.5, padding: '2px 7px', borderRadius: 999,
                  color: isAutonomous(tool.effect) ? 'var(--color-text-dim)' : 'var(--color-warn)',
                  background: isAutonomous(tool.effect)
                    ? 'color-mix(in srgb, var(--color-ink-600) 60%, transparent)'
                    : 'color-mix(in srgb, var(--color-warn) 14%, transparent)',
                }}
              >
                {isAutonomous(tool.effect) ? 'automatic' : 'asks you'}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Recent activity">
        {agentActivity.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-dim)' }}>
            Nothing yet.
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 7 }}>
            {agentActivity.map((entry) => (
              <li key={entry.seq} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 5, height: 5, borderRadius: '50%', marginTop: 6, flexShrink: 0,
                    background:
                      entry.outcome === 'succeeded'
                        ? 'var(--color-ok)'
                        : entry.outcome === 'denied'
                          ? 'var(--color-warn)'
                          : 'var(--color-danger)',
                  }}
                />
                <span style={{ color: 'var(--color-text-dim)' }}>{entry.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h3
        style={{
          margin: '0 0 8px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em',
          textTransform: 'uppercase', color: 'var(--color-text-dim)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

export function Progress({
  completed,
  total,
  confidence,
}: {
  completed: number
  total: number | null
  confidence: 'measured' | 'estimated'
}) {
  // With no denominator there is no honest percentage. Showing a step count is
  // better than inventing a bar that fills on a timer.
  if (total === null) {
    return (
      <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--color-text-dim)' }}>
        {completed === 0 ? 'Starting…' : `${completed} step${completed === 1 ? '' : 's'} done`}
      </p>
    )
  }

  const percent = Math.min(Math.round((completed / total) * 100), 100)

  return (
    <div style={{ marginTop: 10 }}>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={confidence === 'estimated' ? 'Estimated progress' : 'Progress'}
      >
        <div
          className="progress__fill"
          data-confidence={confidence}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--color-text-dim)' }}>
        {percent}%{confidence === 'estimated' && ' (estimated)'}
      </p>
    </div>
  )
}

const isAutonomous = (effect: string): boolean =>
  effect === 'read' || effect === 'analyse' || effect === 'draft'


/**
 * The workspace's own instructions for this agent.
 *
 * Added to what the agent already knows rather than replacing it, which is
 * why it sits under the built-in description instead of on top of it. Saved
 * to the workspace and read fresh on every dispatch, so the next run uses it.
 */
function CustomInstructions({ agentKey, agentName }: { agentKey: string; agentName: string }) {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'done' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let live = true
    setState('loading')
    api
      .agentInstructions()
      .then((all) => {
        if (!live) return
        const value = all[agentKey] ?? ''
        setText(value)
        setSaved(value)
        setState('idle')
      })
      .catch(() => { if (live) setState('idle') })
    return () => { live = false }
  }, [agentKey])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const save = useCallback(async () => {
    setState('saving')
    setMessage(null)
    try {
      await api.saveAgentInstructions(agentKey, text)
      setSaved(text)
      setState('done')
      // Back to neutral, so "Saved" is a confirmation rather than a label.
      timer.current = setTimeout(() => setState('idle'), 2200)
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'Could not save those instructions')
    }
  }, [agentKey, text])

  if (state === 'loading') {
    return <p className="instr__hint">Loading your instructions…</p>
  }

  const dirty = text !== saved

  return (
    <div className="instr">
      <label className="instr__label" htmlFor={`instr-${agentKey}`}>
        Your instructions for {agentName}
      </label>
      <textarea
        id={`instr-${agentKey}`}
        className="instr__input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder={`e.g. Always write in British English. Our quarter ends in March.`}
      />

      <div className="instr__foot">
        <span className="instr__hint">
          {state === 'done'
            ? 'Saved. The next run will use it.'
            : dirty
              ? 'Not saved yet'
              : text
                ? 'Used on every run'
                : 'Optional'}
        </span>
        <button
          className="btn btn--primary instr__save"
          onClick={() => void save()}
          disabled={!dirty || state === 'saving'}
        >
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>

      {message && <p role="alert" className="instr__error">{message}</p>}
    </div>
  )
}
