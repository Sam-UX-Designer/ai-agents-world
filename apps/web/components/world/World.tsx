'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentInfo, BillingState } from '@/lib/api'
import { ApiError, api } from '@/lib/api'
import { ISLAND_ART } from '@agents-world/shared'
import { pointOn, useCoverRect, type CoverRect } from '@/lib/coverRect'
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
  const { scroller, scroll, pannable, onScroll } = useIslandPan(rect)

  const goalId = useWorld((s) => s.goalId)
  const goalState = useWorld((s) => s.goalState)
  const running =
    goalId !== null && goalState !== 'completed' && goalState !== 'failed'

  /*
   * Everything anchored to the artwork reads a rect shifted by the scroll, so
   * the stations travel with the island rather than hovering over a picture
   * that slid out from under them. Two numbers do it: pointOn is
   * `rect.left + fraction * rect.width` on one axis and the same on the
   * other, and an island scrolled by (left, top) has its top-left corner
   * exactly that far back from the viewport's.
   */
  const panned = { ...rect, left: -scroll.left, top: -scroll.top }

  return (
    <>
      <div
        className="world world--live"
        ref={scroller}
        onScroll={onScroll}
        data-pannable={pannable ? 'true' : undefined}
        aria-hidden={artworkMissing ? undefined : 'true'}
      >
        {artworkMissing ? (
          <MissingArtwork />
        ) : (
          <div
            className="world__pan"
            style={rect.width ? { width: rect.width, height: rect.height } : undefined}
          >
            <WorldArt src={HERO_IMAGE} onError={() => setArtworkMissing(true)} />
            <Robots agents={agents} rect={rect} />
            {/* Inside the scroller, so it travels with the island for free.
                This box *is* the island, so the island's own origin is its
                top-left corner rather than wherever the viewport crops it. */}
            <Orb rect={{ ...rect, left: 0, top: 0 }} running={running} />
          </div>
        )}
      </div>

      {/* Readability veil. Weighted to the corners and the bottom, where the
          panels and the command bar sit, so the middle of the island - the
          part worth looking at - keeps its full brightness.

          A sibling of the scroller rather than a child: a veil that scrolled
          with the island would carry its darkened corners away from the
          corners of the screen. */}
      <div className="world__veil" />

      <Routes agents={agents} rect={panned} />
      <Markers agents={agents} rect={panned} />
    </>
  )
}

/**
 * Pan the island left and right, using the browser's own scrolling.
 *
 * The artwork is 16:9 and cover-fitted, so on a phone held upright roughly
 * three quarters of the island is off screen - whole stations were simply
 * unreachable, and the agent cards were hidden outright at this width, which
 * left Home as a photograph.
 *
 * This was first built as a pointer drag and did not survive contact with a
 * phone: Chromium cancels the gesture one frame in, so the island moved a
 * single step and stopped. Measured rather than guessed - four pointer events,
 * the last a pointercancel, with touch-action already `none` on every element
 * involved. A scroll container has none of that problem, because handling a
 * swipe is the browser's job rather than ours, and it arrives with momentum,
 * rubber-banding and trackpads already correct.
 */
function useIslandPan(rect: CoverRect) {
  const scroller = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ left: 0, top: 0 })

  // The island hangs off each edge by half its overflow, so a negative offset
  // is the same statement as "there is island off that side of the screen".
  const pannable = rect.left < -1 || rect.top < -1

  // Start in the middle of both axes, which is where cover-fit alone would
  // have put it, so the island does not jump on the first paint.
  useEffect(() => {
    const el = scroller.current
    if (!el || rect.width === 0) return
    const left = Math.max(0, (rect.width - el.clientWidth) / 2)
    const top = Math.max(0, (rect.height - el.clientHeight) / 2)
    el.scrollLeft = left
    el.scrollTop = top
    setScroll({ left, top })
  }, [rect.width, rect.height])

  const onScroll = useCallback(() => {
    const el = scroller.current
    if (el) setScroll({ left: el.scrollLeft, top: el.scrollTop })
  }, [])

  return { scroller, scroll, pannable, onScroll }
}

/**
 * The robots, moving while their agent works.
 *
 * The island is one flat picture, so there is no robot object to animate.
 * What there is, is the robot's own pixels - and a box drawn over them,
 * filled with the same image offset to line up exactly, is invisible at rest
 * and is a robot when it moves. Same idea as the Orb, which turns the sphere
 * the artwork already has.
 *
 * The transform is the whole trick, and it took three attempts to find.
 * Sliding the box up lifts the robot but uncovers the ground it was standing
 * on - fine over the flat paving at Sales, a visible smear over grass.
 * Rotating it around the feet keeps them planted but swings the box's edges
 * across the original, so the untouched robot underneath peeks out at the
 * shoulder. What works is scaling up from the feet: the box only ever grows,
 * so nothing it covered can be uncovered, and the pivot means the feet stay
 * exactly where they were painted. The robot rises about four pixels and
 * settles, which reads as breathing rather than as a picture being stretched.
 *
 * Measured against the supplied render with a grid over it, at the boxes in
 * the registry. Not every station has one - see Zone.robot.
 */
function Robots({
  agents,
  rect,
}: {
  agents: readonly AgentInfo[]
  rect: CoverRect
}) {
  const agentStates = useWorld((s) => s.agents)

  if (rect.width === 0) return null

  // The island is drawn at rect.width, the boxes were measured at the file's
  // own width, and the two differ on every screen.
  const scale = rect.width / ISLAND_ART.width

  return (
    <>
      {agents.map((agent) => {
        const box = agent.zone.robot
        if (!box) return null

        const state = agentStates[agent.key]?.state ?? 'idle'
        const [x, y, w, h] = box

        /*
         * Whole pixels, and the size taken as the difference between two
         * rounded edges rather than a rounded width. Rounding the width on
         * its own lets the right edge drift a pixel away from where the
         * artwork's own is, and a patch that is a pixel wide of the image
         * beneath it draws an outline around the robot at rest.
         */
        const left = Math.round(x * scale)
        const top = Math.round(y * scale)

        return (
          <span
            key={agent.key}
            className="robot"
            data-state={state}
            aria-hidden="true"
            style={{
              left,
              top,
              width: Math.round((x + w) * scale) - left,
              height: Math.round((y + h) * scale) - top,
              backgroundImage: `url(${HERO_IMAGE.replace(/\.png$/, '.webp')})`,
              backgroundSize: `${rect.width}px ${rect.height}px`,
              // Pull the same pixels that are underneath into the box, so at
              // rest it cannot be told from the artwork it sits on.
              backgroundPosition: `${-left}px ${-top}px`,
            }}
          />
        )
      })}
    </>
  )
}

/** Where the Orchestrator stands. Every dispatch line starts here. */
const HUB_STATION: [number, number] = [0.502, 0.332]

/** The blue a dispatch is drawn in. Matches the sphere it leaves from. */
const BOLT = '#5ab4ff'

/**
 * A bolt of lightning from one point to another.
 *
 * A dispatch used to be a dot sliding along a straight wire, which reads as a
 * progress bar laid on its side. Power arriving somewhere does not look like
 * that. The kinks are what make it read as a discharge rather than as travel,
 * so they are the whole point of drawing a path instead of a line.
 *
 * Returns its own measured length as well, because the stroke-dash trick that
 * draws it needs a number and `pathLength` is not reliable here - the same
 * Chromium gap that the straight pulse already works around.
 */
function boltPath(
  from: { left: number; top: number },
  to: { left: number; top: number },
  seed: number,
): { d: string; length: number } {
  const dx = to.left - from.left
  const dy = to.top - from.top
  const span = Math.hypot(dx, dy) || 1

  // The direction a kink travels in: perpendicular to the flight path.
  const nx = -dy / span
  const ny = dx / span

  const SEGMENTS = 7
  // Long hops earn bigger kinks, but only up to a point - past about 16px the
  // bolt stops looking like it is going anywhere and starts looking like a
  // scribble.
  const amplitude = Math.min(16, Math.max(6, span * 0.045))

  const points = [from]
  for (let i = 1; i < SEGMENTS; i++) {
    const t = i / SEGMENTS
    // Taper to nothing at both ends. However wild the middle gets, the bolt
    // still leaves the hub and lands on the station exactly, which is the
    // part that has to stay true.
    const taper = Math.sin(t * Math.PI)
    /*
     * Deterministic, not random.
     *
     * A bolt that re-rolled its kinks on every React render would flicker
     * whenever anything else on the island changed - motion the data never
     * asked for. Seeding from the route's own id gives each dispatch its own
     * shape and gives that shape for as long as the dispatch lasts.
     */
    const wobble = Math.sin(seed * 12.9898 + i * 78.233) % 1
    const off = wobble * amplitude * taper
    points.push({
      left: from.left + dx * t + nx * off,
      top: from.top + dy * t + ny * off,
    })
  }
  points.push(to)

  let length = 0
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i]!.left - points[i - 1]!.left, points[i]!.top - points[i - 1]!.top)
  }

  const d = points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.left.toFixed(1)} ${pt.top.toFixed(1)}`)
    .join(' ')

  return { d, length }
}

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

  /*
   * Two different truths about the hub, and they are not the same window.
   *
   * `thinking` is the Orchestrator itself mid-thought - reading the goal,
   * choosing agents. It stops the moment the plan is handed out, because the
   * Orchestrator really does go quiet then and waits.
   *
   * `running` is the goal being alive at all. That lasts until the answer
   * comes back, and it is what the ring tracks: the hub is the station the
   * whole run is coordinated from, so a turning ring there is true for as
   * long as anything is in flight. Tying the ring to `thinking` meant it
   * turned for the two seconds of planning and then stopped while six agents
   * worked, which reads as the world having given up.
   *
   * Neither is invented. Both are read from events the backend actually sent.
   */
  const thinking =
    goalId !== null &&
    goalState !== 'completed' &&
    goalState !== 'failed' &&
    ['planning', 'spawning', 'working'].includes(orchestrator?.state ?? 'planning')

  const running =
    goalId !== null && goalState !== 'completed' && goalState !== 'failed'

  return (
    <div className="routes" aria-hidden="true">
      {(running || routes.length > 0) && (
        <span className="routes__core" style={{ left: hub.left, top: hub.top }}>
          <span className="routes__hub" data-thinking={thinking} />
        </span>
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
          const bolt = boltPath(hub, to, route.id)

          return (
            <g
              key={route.id}
              style={{ ['--len' as string]: `${bolt.length}px` }}
            >
              {/* The discharge, in three passes over one path: a wide haze
                  that lights the ground under it, the bolt itself, and a thin
                  white core. One stroke at one width reads as a drawn line;
                  it is the hot centre inside a glow that reads as power. */}
              <path className="routes__bolt routes__bolt--haze" d={bolt.d} />
              <path className="routes__bolt" d={bolt.d} />
              <path className="routes__bolt routes__bolt--core" d={bolt.d} />

              {/*
                The strike landing.

                Without it the bolt arrives and simply stops, which reads as
                the animation ending rather than as the task being handed
                over. The flash is the moment the agent receives it.
              */}
              <circle className="routes__strike" cx={to.left} cy={to.top} r={6} />
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
            data-agent={agent.key}
            data-side={side}
            style={{ left, top }}
          >
            {/* The mascot slot, sitting on the station itself. Shows the
                uploaded render when one exists and a soft glow until then, so
                dropping a file into public/mascots/ is the only step needed. */}
            <Mascot agentKey={agent.key} state={view?.state ?? 'idle'} />

            {/*
              The station pinging while its agent works.

              The robots are painted into the artwork, so the one standing
              here cannot itself be animated without redrawing it. Light can
              be added over it though, and light is what the eye catches at
              this size: two rings leaving the station on a stagger, which
              reads as the place being active rather than as a badge stuck to
              it. Rendered only while the agent is genuinely in an active
              state - no run, no rings.
            */}
            {busy && (
              <>
                <span className="station__ping" aria-hidden="true" />
                <span className="station__ping station__ping--late" aria-hidden="true" />
              </>
            )}

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

/*
 * The orb at the hub, turning.
 *
 * The orb is painted into the artwork, so there is no object here to animate -
 * only pixels. This lifts the exact circle of the artwork the orb occupies,
 * lays it back down in the same place, and rotates that. Nothing is drawn,
 * generated or replaced: it is the owner's own render, turning.
 *
 * ORB is measured from the file, not guessed - centre and radius as fractions
 * of the image width, so it stays on the orb at every viewport shape the way
 * the station markers do. The radius is deliberately a shade inside the orb's
 * rim: a circle even slightly too large takes the platform with it, and a
 * rotating platform is instantly wrong.
 *
 * A fixed highlight was laid over this at first, on the theory that a rotating
 * specular would read as the sun orbiting the island. It does not: the orb is
 * itself a light source, so its bright spots read as energy moving inside the
 * glass. All the overlay did was add haze, so it is gone.
 *
 * If the image fails to load this element is simply transparent and the
 * artwork's own static orb shows through - the right way for an ornament to
 * fail.
 */
const ORB = { cx: 0.5006, cy: 0.3337, r: 0.0245 } as const

function Orb({ rect, running }: { rect: CoverRect; running: boolean }) {
  if (rect.width === 0) return null

  const centre = pointOn(rect, [ORB.cx, ORB.cy])
  const radius = ORB.r * rect.width
  const size = radius * 2

  return (
    <span
      className="orb"
      data-running={running}
      aria-hidden="true"
      style={{
        left: centre.left - radius,
        top: centre.top - radius,
        width: size,
        height: size,
        // The WebP the page is already showing, so this is the same pixels
        // rather than a second download.
        backgroundImage: `url(${HERO_IMAGE.replace(/\.png$/, '.webp')})`,
        backgroundSize: `${rect.width}px ${rect.height}px`,
        // Line the artwork's orb up with the middle of this element.
        backgroundPosition: `${radius - ORB.cx * rect.width}px ${radius - ORB.cy * rect.height}px`,
      }}
    />
  )
}

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
