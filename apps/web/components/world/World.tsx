'use client'

import { useCallback, useRef, useState } from 'react'
import type { AgentInfo } from '@/lib/api'
import { api } from '@/lib/api'
import { pointOn, useCoverRect } from '@/lib/useCoverRect'
import { useWorld, type AgentView } from '@/lib/store'
import { VoiceInput } from '@/components/hero/VoiceInput'

/**
 * The Agent World.
 *
 * The island is the environment, not a picture inside the layout. It is a
 * fixed full-viewport layer; every piece of interface is positioned over it
 * and sized to its own content. Nothing reserves space, so the ocean runs to
 * all four edges and the UI reads as floating above a place rather than as
 * panels around an image.
 *
 * Markers are anchored to the artwork rather than to the viewport - see
 * useCoverRect for why that distinction matters once the image is cropped.
 */

const HERO_IMAGE = '/island-hero.png'

/** The supplied artwork's native aspect. Markers are anchored against this. */
const ISLAND_ASPECT = 1672 / 941

const SUGGESTIONS = [
  'Plan a product launch',
  'Find insights about our users',
  'Organize my schedule',
  'Create a design system',
]

export function World({ agents }: { agents: readonly AgentInfo[] }) {
  const [artworkMissing, setArtworkMissing] = useState(false)
  const rect = useCoverRect(ISLAND_ASPECT)

  return (
    <>
      <div className="world" aria-hidden={artworkMissing ? undefined : 'true'}>
        {artworkMissing ? (
          <MissingArtwork />
        ) : (
          <img
            className="world__art"
            src={HERO_IMAGE}
            alt=""
            onError={() => setArtworkMissing(true)}
          />
        )}
        {/* Readability veil. Weighted to the corners and the bottom, where the
            panels and the command bar sit, so the middle of the island - the
            part worth looking at - keeps its full brightness. */}
        <div className="world__veil" />
      </div>

      <Markers agents={agents} rect={rect} />
    </>
  )
}

function Markers({
  agents,
  rect,
}: {
  agents: readonly AgentInfo[]
  rect: ReturnType<typeof useCoverRect>
}) {
  const agentStates = useWorld((s) => s.agents)
  const selected = useWorld((s) => s.selectedAgent)
  const select = useWorld((s) => s.selectAgent)

  if (rect.width === 0) return null

  return (
    <div className="markers">
      {agents.map((agent) => {
        const view = agentStates[agent.key]
        const { left, top } = pointOn(rect, agent.zone.hero as [number, number])
        const busy = ['planning', 'spawning', 'working'].includes(view?.state ?? 'idle')
        const primary = agent.key === 'orchestrator'
        // A label centred on a station near the right edge runs under the
        // panels. Flipping which side of the anchor it extends from keeps the
        // dot exactly on its station - moving the anchor would put the agent
        // somewhere it is not.
        const fx = agent.zone.hero[0] ?? 0.5
        const side = fx > 0.7 ? 'left' : fx < 0.18 ? 'right' : 'center'

        return (
          <button
            key={agent.key}
            className="marker"
            data-state={view?.state ?? 'idle'}
            data-primary={primary}
            data-side={side}
            aria-pressed={selected === agent.key}
            onClick={() => select(selected === agent.key ? null : agent.key)}
            style={{ left, top }}
          >
            <span className="marker__dot" style={{ ['--dot' as string]: dotColour(view?.state, agent.accent) }} />
            <span className="marker__label">
              <strong>{agent.name}</strong>
              <em>{view?.activity ?? 'Ready'}</em>
            </span>
            {busy && <span className="marker__pulse" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The active-agents panel.
 *
 * Lists only what is genuinely running, so an idle world shows an idle panel
 * rather than a roster padded out to look busy.
 */
export function ActiveAgents({ agents }: { agents: readonly AgentInfo[] }) {
  const agentStates = useWorld((s) => s.agents)
  const select = useWorld((s) => s.selectAgent)
  const selected = useWorld((s) => s.selectedAgent)

  const active = agents
    .map((agent) => ({ agent, view: agentStates[agent.key] }))
    .filter(({ view }) =>
      view && ['planning', 'spawning', 'working', 'waiting', 'needs_input'].includes(view.state),
    )

  if (active.length === 0) return null

  return (
    <aside className="agents glass" aria-label="Active agents">
      <header className="agents__head">
        <h2>Active Agents</h2>
        <p>
          <span className="agents__live" aria-hidden="true" />
          {active.length} working
        </p>
      </header>

      <ul className="agents__list">
        {active.map(({ agent, view }) => (
          <li key={agent.key}>
            <button
              className="agents__row"
              data-selected={selected === agent.key}
              onClick={() => select(selected === agent.key ? null : agent.key)}
            >
              <span className="agents__icon" style={{ ['--accent' as string]: agent.accent }}>
                {agent.name.charAt(0)}
              </span>
              <span className="agents__text">
                <strong>{agent.name}</strong>
                <em>{view?.activity}</em>
              </span>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                <path d="m9.5 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

/** Bottom-right progress on the goal in flight. */
export function TaskInProgress() {
  const goalId = useWorld((s) => s.goalId)
  const goalState = useWorld((s) => s.goalState)
  const tasks = useWorld((s) => s.tasks)

  if (!goalId) return null

  const list = Object.values(tasks)
  const done = list.filter((t) => t.state === 'succeeded').length
  const percent = list.length > 0 ? Math.round((done / list.length) * 100) : 0

  return (
    <div className="taskcard glass" role="status">
      <span className="taskcard__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
          <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.7" />
          <path d="m8.5 12 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="taskcard__body">
        <strong>{goalState === 'completed' ? 'Task complete' : 'Task in progress'}</strong>
        <em>{list.length > 0 ? `${done} of ${list.length} tasks done` : 'Planning…'}</em>
        <span className="taskcard__bar">
          <span className="taskcard__fill" style={{ width: `${percent}%` }} />
        </span>
      </span>
      <span className="taskcard__pct">{percent}%</span>
    </div>
  )
}

/**
 * The command bar.
 *
 * The one place a goal is stated. Floats over the ocean rather than sitting in
 * a footer, so it reads as speaking into the world rather than filling in a
 * form beneath it.
 */
export function CommandBar({ onStarted }: { onStarted: (goalId: string) => void }) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const submit = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed || busy) return

    setBusy(true)
    setError(null)
    try {
      const { goalId } = await api.submitGoal(trimmed)
      setPrompt('')
      useWorld.getState().beginGoal(goalId, 0)
      onStarted(goalId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that')
    } finally {
      setBusy(false)
    }
  }, [prompt, busy, onStarted])

  const onTranscript = useCallback((text: string) => setPrompt(text), [])
  const onFinal = useCallback(() => input.current?.focus(), [])

  return (
    <div className="command">
      <div className="command__bar glass">
        <span className="command__spark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none">
            <path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5Z"
              fill="currentColor" opacity=".9" />
          </svg>
        </span>

        <textarea
          ref={input}
          className="command__input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks a line. A goal is usually one
            // sentence; reaching for a button every time is friction.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          rows={1}
          disabled={busy}
          placeholder="Ask your AI workforce anything..."
          aria-label="Describe your goal"
        />

        <VoiceInput onTranscript={onTranscript} onFinal={onFinal} />

        <button
          className="command__send"
          onClick={() => void submit()}
          disabled={busy || prompt.trim().length === 0}
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
            <path d="M3.6 11.2 19.4 4.3a.8.8 0 0 1 1.06 1.05l-6.9 15.8a.8.8 0 0 1-1.5-.1l-1.6-5.6-5.6-1.6a.8.8 0 0 1-.1-1.5Z" fill="currentColor" />
          </svg>
        </button>
      </div>

      <div className="command__pills">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="pill glass" onClick={() => setPrompt(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="command__error">{error}</p>
      )}
    </div>
  )
}

function dotColour(state: string | undefined, accent: string): string {
  if (state === 'needs_input') return 'var(--color-warn)'
  if (state === 'completed') return 'var(--color-ok)'
  if (state === 'error') return 'var(--color-danger)'
  if (!state || state === 'idle') return 'rgba(190, 214, 240, .55)'
  return accent
}

function MissingArtwork() {
  return (
    <div className="world__missing">
      <p><strong>Island artwork not found</strong></p>
      <p>Upload the render to <code>apps/web/public/island-hero.png</code>.</p>
    </div>
  )
}

export type { AgentView }
