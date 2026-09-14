'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentInfo } from '@/lib/api'
import { api } from '@/lib/api'
import { useWorld, type AgentView } from '@/lib/store'
import { VoiceInput } from './VoiceInput'

/**
 * The hero: the Agent World, and the one place a user states a goal.
 *
 * The island is supplied artwork rather than a generated scene. Agent markers
 * are positioned as fractions of the image, so they stay pinned to their
 * station at any width, and every marker's state comes from the event store -
 * the artwork is a backdrop, the markers are live.
 */

const HERO_IMAGE = '/island-hero.png'

const STATE_LABEL: Record<string, string> = {
  idle: 'Ready',
  planning: 'Planning',
  spawning: 'Starting',
  working: 'Working',
  waiting: 'Waiting',
  needs_input: 'Needs you',
  completed: 'Done',
  error: 'Stopped',
}

export function Hero({ agents }: { agents: readonly AgentInfo[] }) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [artworkMissing, setArtworkMissing] = useState(false)

  const agentStates = useWorld((s) => s.agents)
  const selectAgent = useWorld((s) => s.selectedAgent)
  const setSelected = useWorld((s) => s.selectAgent)
  const goalState = useWorld((s) => s.goalState)
  const goalId = useWorld((s) => s.goalId)
  const tasks = useWorld((s) => s.tasks)

  const inputRef = useRef<HTMLTextAreaElement>(null)

  const departments = agents.filter((a) => a.key !== 'orchestrator')
  const orchestrator = agents.find((a) => a.key === 'orchestrator')

  const activeCount = Object.values(agentStates).filter((a) =>
    ['planning', 'spawning', 'working'].includes(a.state),
  ).length
  const doneCount = Object.values(tasks).filter((t) => t.state === 'succeeded').length

  const submit = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed || busy) return

    setBusy(true)
    setError(null)
    try {
      const { goalId: id } = await api.submitGoal(trimmed)
      setPrompt('')
      useWorld.getState().beginGoal(id, 0)
      window.dispatchEvent(new CustomEvent('goal:started', { detail: { goalId: id } }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that')
    } finally {
      setBusy(false)
    }
  }, [prompt, busy])

  // Dictation replaces the field's contents rather than appending, so a second
  // attempt after a misheard phrase corrects it instead of stacking.
  const onTranscript = useCallback((text: string) => setPrompt(text), [])
  const onFinal = useCallback(() => inputRef.current?.focus(), [])

  return (
    <section
      className="hero-section"
      style={{
        position: 'relative',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background:
          'radial-gradient(ellipse at 50% 0%, #1B4C72 0%, var(--color-ink-900) 70%)',
      }}
    >
      {/* ---------------------------------------------------------- header -- */}
      <header
        style={{
          position: 'relative', zIndex: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, padding: 'max(18px, env(safe-area-inset-top)) clamp(16px, 4vw, 40px) 10px',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 'clamp(22px, 4vw, 32px)', fontWeight: 700, letterSpacing: '-0.02em' }}>
            AI Agents World
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: 'clamp(12px, 2.4vw, 14px)', color: 'var(--color-text-dim)' }}>
            Your AI workforce, in one world
          </p>
        </div>

        <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px', borderRadius: 999 }}>
          <span
            aria-hidden="true"
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: activeCount > 0 ? 'var(--color-accent)' : 'var(--color-ok)',
            }}
          />
          <span style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
            {activeCount > 0 ? `${activeCount} working` : 'All agents ready'}
          </span>
        </div>
      </header>

      {/* ----------------------------------------------------------- world -- */}
      <div
        className="hero-stage-wrap"
        style={{
          position: 'relative', flex: 1, minHeight: 0,
          display: 'grid', placeItems: 'center',
          padding: '0 clamp(8px, 3vw, 32px)',
        }}
      >
        <div
          className="hero-stage"
          style={{
            position: 'relative',
            width: '100%',
            // Width is capped by whatever height is left after the header and
            // the prompt, so the whole hero fits one screen without scrolling.
            // Capping width alone pushes the prompt below the fold on short
            // laptop screens, which is where a user actually types.
            maxWidth: 'min(1280px, calc((100dvh - 260px) * 16 / 9))',
            aspectRatio: '16 / 9',
            borderRadius: 20,
            overflow: 'hidden',
            border: '1px solid color-mix(in srgb, var(--color-accent) 16%, transparent)',
            boxShadow: '0 30px 80px rgb(0 0 0 / 0.5)',
          }}
        >
          {artworkMissing ? (
            <MissingArtwork />
          ) : (
            <img
              src={HERO_IMAGE}
              alt="The Agent World island, with a station for each department around a central orchestration hub."
              onError={() => setArtworkMissing(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}

          {/* Markers sit above the artwork and are driven entirely by the
              store, so the island is a backdrop and the state on it is real. */}
          {orchestrator && (
            <Marker
              agent={orchestrator}
              view={agentStates[orchestrator.key]}
              selected={selectAgent === orchestrator.key}
              onSelect={() => setSelected(selectAgent === orchestrator.key ? null : orchestrator.key)}
              primary
            />
          )}
          {departments.map((agent) => (
            <Marker
              key={agent.key}
              agent={agent}
              view={agentStates[agent.key]}
              selected={selectAgent === agent.key}
              onSelect={() => setSelected(selectAgent === agent.key ? null : agent.key)}
            />
          ))}

          {goalId && (
            <div
              className="glass"
              style={{
                position: 'absolute', right: 14, bottom: 14, maxWidth: 260,
                padding: '11px 14px', fontSize: 12,
              }}
            >
              <p style={{ margin: '0 0 3px', color: 'var(--color-text-dim)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {goalState === 'completed' ? 'Finished' : 'In progress'}
              </p>
              <p style={{ margin: 0 }}>
                {doneCount} of {Object.keys(tasks).length || '—'} tasks done
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Phone-width stand-in for the markers, which are hidden at this size.
          Inside the hero rather than after it, because a strip below a full-
          height hero is one the user never scrolls far enough to find. */}
      <nav className="agent-strip" aria-label="Agents">
        {agents.map((agent) => {
          const view = agentStates[agent.key]
          const busy = ['planning', 'spawning', 'working'].includes(view?.state ?? 'idle')
          return (
            <button
              key={agent.key}
              className="agent-chip"
              aria-pressed={selectAgent === agent.key}
              onClick={() => setSelected(selectAgent === agent.key ? null : agent.key)}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: busy ? agent.accent : stateColour(view?.state ?? 'idle', agent.accent),
                }}
              />
              {agent.name.replace(' Agent', '')}
            </button>
          )
        })}
      </nav>

      {/* ------------------------------------------------------ the prompt -- */}
      <div
        style={{
          position: 'relative', zIndex: 20,
          padding: '18px clamp(16px, 4vw, 40px) max(22px, env(safe-area-inset-bottom))',
          display: 'grid', placeItems: 'center',
        }}
      >
        <div className="glass" style={{ width: '100%', maxWidth: 720, padding: 14 }}>
          <div className="prompt-row">
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter breaks a line: a goal is usually one
                // sentence, and reaching for a button every time is friction.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
              rows={1}
              disabled={busy}
              placeholder="Ask your workforce anything…"
              aria-label="Describe your goal"
              style={{
                flex: 1, minHeight: 46, maxHeight: 140, padding: '12px 13px',
                borderRadius: 12, resize: 'none', fontSize: 14.5, lineHeight: 1.45,
                fontFamily: 'inherit',
                background: 'color-mix(in srgb, var(--color-ink-900) 55%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)',
                color: 'var(--color-text)',
              }}
            />

            <VoiceInput onTranscript={onTranscript} onFinal={onFinal} />

            <button
              className="btn btn--primary"
              style={{ height: 42, paddingInline: 18 }}
              onClick={() => void submit()}
              disabled={busy || prompt.trim().length === 0}
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>

          {error && (
            <p role="alert" style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--color-danger)' }}>
              {error}
            </p>
          )}

          <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--color-text-dim)' }}>
            Agents read and analyse on their own. Sending, posting and deleting
            always ask you first.
          </p>
        </div>
      </div>
    </section>
  )
}

/**
 * An agent's marker on the island.
 *
 * Positioned as a percentage of the artwork, so it stays on its station at
 * every width without a per-breakpoint layout. Hidden below tablet width,
 * where nine markers over a 16:9 image would overlap into noise - the agent
 * list takes over there instead.
 */
function Marker({
  agent,
  view,
  selected,
  onSelect,
  primary = false,
}: {
  agent: AgentInfo
  view: AgentView | undefined
  selected: boolean
  onSelect: () => void
  primary?: boolean
}) {
  const state = view?.state ?? 'idle'
  const busy = ['planning', 'spawning', 'working'].includes(state)
  const [x, y] = agent.zone.hero

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="hero-marker"
      data-state={state}
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: selected ? 12 : primary ? 11 : 10,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: primary ? '9px 14px' : '7px 11px',
        borderRadius: 11, cursor: 'pointer', textAlign: 'left',
        background: 'color-mix(in srgb, var(--color-ink-900) 86%, transparent)',
        border: `1px solid ${selected ? agent.accent : 'color-mix(in srgb, var(--color-accent) 24%, transparent)'}`,
        backdropFilter: 'blur(10px)',
        boxShadow: selected ? `0 0 0 3px color-mix(in srgb, ${agent.accent} 28%, transparent)` : '0 6px 18px rgb(0 0 0 / 0.4)',
        transition: 'border-color 160ms, box-shadow 160ms',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: primary ? 10 : 8, height: primary ? 10 : 8, borderRadius: '50%', flexShrink: 0,
          background: busy ? agent.accent : stateColour(state, agent.accent),
          boxShadow: busy ? `0 0 9px ${agent.accent}` : 'none',
        }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
        <strong style={{ fontSize: primary ? 12.5 : 11.5, fontWeight: 620, whiteSpace: 'nowrap' }}>
          {agent.name}
        </strong>
        {/* State in words, not only in colour - the PRD requires the world to
            stay readable without relying on hue. */}
        <span style={{ fontSize: 10, color: 'var(--color-text-dim)', whiteSpace: 'nowrap' }}>
          {view?.activity ?? STATE_LABEL[state]}
        </span>
      </span>
      {busy && <span className="agent-label__pulse" aria-hidden="true" />}
    </button>
  )
}

function stateColour(state: string, accent: string): string {
  if (state === 'needs_input') return 'var(--color-warn)'
  if (state === 'completed') return 'var(--color-ok)'
  if (state === 'error') return 'var(--color-danger)'
  if (state === 'idle') return 'var(--color-text-dim)'
  return accent
}

/**
 * Shown until the artwork is added.
 *
 * Says exactly what is missing and where it goes, rather than rendering a
 * broken image icon and leaving someone to work it out.
 */
function MissingArtwork() {
  return (
    <div
      style={{
        width: '100%', height: '100%', display: 'grid', placeItems: 'center',
        padding: 24, textAlign: 'center',
        background: 'linear-gradient(165deg, #1E5F8A 0%, #0E3A5C 55%, #08243D 100%)',
      }}
    >
      <div>
        <p style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600 }}>Island artwork not found</p>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-dim)', lineHeight: 1.55 }}>
          Add the render to <code>apps/web/public/island-hero.png</code>.
          <br />
          Agent markers are live either way.
        </p>
      </div>
    </div>
  )
}
