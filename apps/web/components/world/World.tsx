'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentInfo, BillingState } from '@/lib/api'
import { ApiError, api } from '@/lib/api'
import { pointOn, useCoverRect } from '@/lib/coverRect'
import { useWorld, type AgentView } from '@/lib/store'
import { WorldArt } from './Backdrop'
import { VoiceInput } from './VoiceInput'

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

const HERO_IMAGE = '/world/island-hero.png'

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
          <WorldArt src={HERO_IMAGE} onError={() => setArtworkMissing(true)} />
        )}
        {/* Readability veil. Weighted to the corners and the bottom, where the
            panels and the command bar sit, so the middle of the island - the
            part worth looking at - keeps its full brightness. */}
        <div className="world__veil" />
      </div>

      <Routes agents={agents} rect={rect} />
      <Markers agents={agents} rect={rect} />
    </>
  )
}

/** Where the Orchestrator stands. Every dispatch line starts here. */
const HUB_STATION: [number, number] = [0.502, 0.332]

/**
 * The dispatch animation.
 *
 * When the Orchestrator hands a task to an agent, a light travels from the hub
 * along a line to that agent's station. It exists to make one thing legible:
 * the goal went to the Orchestrator, the Orchestrator chose someone, and that
 * someone is now working.
 *
 * Every line corresponds to an agent that genuinely entered an active state -
 * see RouteView in the store. Agents that were not given work get no line,
 * which is the point: the picture shows routing, not broadcasting.
 */
function Routes({
  agents,
  rect,
}: {
  agents: readonly AgentInfo[]
  rect: ReturnType<typeof useCoverRect>
}) {
  const routes = useWorld((s) => s.routes)
  const clearRoute = useWorld((s) => s.clearRoute)
  const agentStates = useWorld((s) => s.agents)
  const goalId = useWorld((s) => s.goalId)
  const goalState = useWorld((s) => s.goalState)
  const orchestrator = useWorld((s) => s.agents.orchestrator)

  // Each line removes itself once its travel has finished.
  useEffect(() => {
    if (routes.length === 0) return
    const timers = routes.map((r) => setTimeout(() => clearRoute(r.id), ROUTE_MS))
    return () => timers.forEach(clearTimeout)
  }, [routes, clearRoute])

  if (rect.width === 0) return null

  const hub = pointOn(rect, HUB_STATION)
  // The hub is lit while the Orchestrator is reading the goal and deciding.
  const thinking =
    goalId !== null &&
    goalState !== 'completed' &&
    goalState !== 'failed' &&
    ['planning', 'spawning', 'working'].includes(orchestrator?.state ?? 'planning')

  return (
    <div className="routes" aria-hidden="true">
      {(thinking || routes.length > 0) && (
        <span className="routes__hub" data-thinking={thinking} style={{ left: hub.left, top: hub.top }} />
      )}

      <svg className="routes__svg">
        {/*
          A standing line for as long as an agent is actually working, under
          the dispatch pulse rather than instead of it. The dispatch says "this
          one was chosen"; this says "this one is still going", which is the
          question a user has ninety seconds later.
        */}
        {agents.map((agent) => {
          const state = agentStates[agent.key]?.state
          if (agent.key === 'orchestrator') return null
          if (!state || !['planning', 'spawning', 'working'].includes(state)) return null

          const to = pointOn(rect, agent.zone.station as [number, number])
          return (
            <line
              key={`live-${agent.key}`}
              className="routes__live"
              x1={hub.left} y1={hub.top} x2={to.left} y2={to.top}
              stroke={agent.accent}
            />
          )
        })}

        {routes.map((route) => {
          const agent = agents.find((a) => a.key === route.agentKey)
          if (!agent) return null
          const to = pointOn(rect, agent.zone.station as [number, number])
          /*
           * The dash is sized in real pixels from the line's own length.
           *
           * `pathLength="1"` would be the tidy way to normalise this, but
           * Chromium does not honour it on a <line>: the dash silently never
           * rendered. Measuring here also means a short hop and a long one
           * both travel in the same 1.4s, which is what makes the animation
           * read as a handover rather than as a distance.
           */
          const length = Math.hypot(to.left - hub.left, to.top - hub.top)

          return (
            <g key={route.id} style={{ ['--len' as string]: `${length}px` }}>
              {/* The path itself, faint: context for the pulse. */}
              <line
                className="routes__line"
                x1={hub.left} y1={hub.top} x2={to.left} y2={to.top}
                stroke={agent.accent}
              />
              {/* The travelling light - the task itself moving. */}
              <line
                className="routes__pulse"
                x1={hub.left} y1={hub.top} x2={to.left} y2={to.top}
                stroke={agent.accent}
              />
              {/* The head of it. The island's artwork already has blue paths
                  painted between the buildings, and a thin moving dash simply
                  disappears into them - a bright dot does not. */}
              <circle
                className="routes__dot"
                cx={hub.left} cy={hub.top} r={7}
                fill={agent.accent}
                style={{
                  ['--dx' as string]: `${to.left - hub.left}px`,
                  ['--dy' as string]: `${to.top - hub.top}px`,
                }}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** How long one dispatch takes to travel, in milliseconds. Matches the CSS. */
const ROUTE_MS = 1400

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
        const { left, top } = pointOn(rect, agent.zone.station as [number, number])
        const state = view?.state ?? 'idle'
        const busy = ['planning', 'spawning', 'working'].includes(state)
        const primary = agent.key === 'orchestrator'
        // A label centred on a station near the right edge runs under the
        // panels. Flipping which side of the anchor it extends from keeps the
        // dot exactly on its station - moving the anchor would put the agent
        // somewhere it is not.
        const fx = agent.zone.station[0] ?? 0.5
        const side = fx > 0.84 ? 'left' : fx < 0.14 ? 'right' : 'center'

        return (
          /*
           * One anchor per station.
           *
           * `left`/`top` is the robot's exact position in the artwork. The
           * card is lifted off it in CSS rather than by shifting the anchor,
           * so the mascot slot underneath stays exactly on the station when
           * the artwork arrives.
           */
          <div
            key={agent.key}
            className="station"
            data-side={side}
            style={{ left, top }}
          >
            {/* The mascot slot, sitting on the station itself. Shows the
                uploaded render when one exists and a soft glow until then, so
                dropping a file into public/mascots/ is the only step needed. */}
            <Mascot agentKey={agent.key} state={view?.state ?? 'idle'} />

            <button
              className="marker"
              data-state={view?.state ?? 'idle'}
              data-primary={primary}
              aria-pressed={selected === agent.key}
              onClick={() => select(selected === agent.key ? null : agent.key)}
            >
              <MascotIcon agentKey={agent.key} name={agent.name} accent={agent.accent} />
              <span className="marker__label">
                <strong>{agent.name}</strong>
                <em>{view?.activity ?? 'Ready'}</em>
              </span>
              {busy && <span className="marker__pulse" aria-hidden="true" />}
            </button>
          </div>
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

/**
 * Bottom-right progress on the goal in flight.
 *
 * Shows the goal in the user's own words. A run takes minutes, during which
 * people switch tabs and come back - "Planning..." alone gives them no way to
 * recognise what they started, and there is nowhere else on this screen that
 * the prompt survives after the input clears.
 */
export function TaskInProgress({ onOpen }: { onOpen: () => void }) {
  const goalId = useWorld((s) => s.goalId)
  const goalPrompt = useWorld((s) => s.goalPrompt)
  const goalState = useWorld((s) => s.goalState)
  const tasks = useWorld((s) => s.tasks)

  const goalError = useWorld((s) => s.goalError)

  if (!goalId) return null

  const list = Object.values(tasks)
  const done = list.filter((t) => t.state === 'succeeded').length
  const failed = goalState === 'failed'

  /*
   * Three states, and the difference between them is the whole point of this
   * card.
   *
   * Before the plan exists there is no denominator, so there is no percentage
   * - it used to read "Planning... 0%" and sit there, which looks identical
   * whether the Orchestrator is thinking or the run died on its first call.
   * That is exactly how a failure became invisible: the goal had already
   * failed, the reason was sitting in the store, and the card was still
   * showing a calm 0%.
   */
  const waiting = !failed && list.length === 0
  const percent = list.length > 0 ? Math.round((done / list.length) * 100) : 0

  return (
    <button
      className="taskcard glass"
      data-state={failed ? 'failed' : goalState === 'completed' ? 'done' : 'running'}
      onClick={onOpen}
      aria-expanded={false}
      aria-label="Show what is running"
    >
      <span className="taskcard__icon" aria-hidden="true">
        {failed ? (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
            <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.7" />
            <path d="M12 8v4.6m0 3.1v.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
            <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.7" />
            <path d="m8.5 12 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="taskcard__body">
        <strong>
          {failed ? 'Could not finish' : goalState === 'completed' ? 'Task complete' : 'Task in progress'}
        </strong>
        {goalPrompt && <q className="taskcard__prompt">{goalPrompt}</q>}
        <em className={failed ? 'taskcard__why' : undefined}>
          {failed
            ? (goalError ?? 'No agent could start. Open this for the details.')
            : waiting
              ? 'Reading your goal…'
              : `${done} of ${list.length} tasks done`}
        </em>
        {/* No bar on a failure: a progress track under a dead run is a
            progress claim, and there is none to make. */}
        {!failed && (
          <span className="taskcard__bar" data-wait={waiting ? 'true' : undefined}>
            <span className="taskcard__fill" style={waiting ? undefined : { width: `${percent}%` }} />
          </span>
        )}
      </span>
      {!failed && <span className="taskcard__pct">{waiting ? '—' : `${percent}%`}</span>}
    </button>
  )
}

/**
 * The command bar.
 *
 * The one place a goal is stated. Floats over the ocean rather than sitting in
 * a footer, so it reads as speaking into the world rather than filling in a
 * form beneath it.
 */
export function CommandBar({
  onStarted,
  suggestions = SUGGESTIONS,
}: {
  onStarted: (goalId: string) => void
  suggestions?: readonly string[]
}) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set when the refusal was about credit, so the error can offer a way out. */
  const [blocked, setBlocked] = useState(false)
  const [balance, setBalance] = useState<BillingState | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  // What is left, shown before they type rather than after they are refused.
  // Someone who can see they are on their last credit spends it differently
  // from someone who finds out by being stopped.
  const loadBalance = useCallback(() => {
    api.billing().then(setBalance).catch(() => undefined)
  }, [])

  useEffect(() => loadBalance(), [loadBalance])

  const submit = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed || busy) return

    setBusy(true)
    setError(null)
    setBlocked(false)
    try {
      const { goalId } = await api.submitGoal(trimmed)
      setPrompt('')
      useWorld.getState().beginGoal(goalId, 0, trimmed)
      onStarted(goalId)
      loadBalance()
    } catch (err) {
      // 402 is the one refusal with an answer attached, so it gets a link
      // rather than just a sentence. Every other failure is ours, not theirs.
      const status = err instanceof ApiError ? err.status : 0
      setBlocked(status === 402)
      setError(err instanceof Error ? err.message : 'Could not start that')
      if (status === 402) loadBalance()
    } finally {
      setBusy(false)
    }
  }, [prompt, busy, onStarted, loadBalance])

  const onTranscript = useCallback((text: string) => setPrompt(text), [])
  const onFinal = useCallback(() => input.current?.focus(), [])

  return (
    /* One glass container. The input row and the suggestion pills are both
       inside it, so they read as one component rather than a bar with
       unrelated chips floating beneath it. */
    <div className="command glass">
      <div className="command__row">
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
        {suggestions.map((s) => (
          <button key={s} className="pill" onClick={() => setPrompt(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="command__error">
          {error}
          {blocked && (
            <Link href="/pricing" className="command__upgrade">
              See plans
            </Link>
          )}
        </p>
      )}

      {/* Only once it starts to matter. A counter reading "300 left" every day
          is furniture; one reading "1 credit left" is information. */}
      {!error && balance && balance.total <= LOW_BALANCE && (
        <p className="command__left">
          {balance.total === 0
            ? 'No credits left right now.'
            : `${balance.total} credit${balance.total === 1 ? '' : 's'} left.`}{' '}
          <Link href="/pricing">See plans</Link>
        </p>
      )}
    </div>
  )
}

/** Below this, what is left is worth saying out loud. */
const LOW_BALANCE = 3

/**
 * The mascot on its station.
 *
 * Tries the uploaded render first and falls back to a glow, so a missing file
 * is a quiet absence rather than a broken image icon on the artwork. The
 * fallback is deliberately not a box or a silhouette: a placeholder shaped
 * like a robot would read as the final design and get left there.
 */
function Mascot({ agentKey, state }: { agentKey: string; state: string }) {
  const [missing, setMissing] = useState(false)
  const busy = ['planning', 'spawning', 'working'].includes(state)

  if (missing) {
    return <span className="station__glow" data-state={state} aria-hidden="true" />
  }

  return (
    <img
      className="station__mascot"
      data-state={state}
      src={`/mascots/${agentKey}.png`}
      alt=""
      aria-hidden="true"
      onError={() => setMissing(true)}
      style={busy ? undefined : { opacity: 0.9 }}
    />
  )
}

/** The small icon inside an agent card. Same file, smaller. */
function MascotIcon({
  agentKey,
  name,
  accent,
}: {
  agentKey: string
  name: string
  accent: string
}) {
  const [missing, setMissing] = useState(false)

  if (missing) {
    return (
      <span className="marker__icon" style={{ ['--accent' as string]: accent }}>
        {name.charAt(0)}
      </span>
    )
  }

  return (
    <img
      className="marker__icon marker__icon--img"
      src={`/mascots/${agentKey}.png`}
      alt=""
      onError={() => setMissing(true)}
    />
  )
}

function MissingArtwork() {
  return (
    <div className="world__missing">
      <p><strong>Island artwork not found</strong></p>
      <p>Upload the render to <code>apps/web/public/world/island-hero.png</code>.</p>
    </div>
  )
}

export type { AgentView }
