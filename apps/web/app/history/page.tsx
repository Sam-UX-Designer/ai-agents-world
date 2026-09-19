'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, type AgentInfo, type HistoryEntry, type Me } from '@/lib/api'
import { Backdrop } from '@/components/world/Backdrop'
import { Chrome } from '@/components/world/Chrome'
import { CommandBar } from '@/components/world/World'
import { ToolChip, agentLabel } from '@/components/history/parts'

/**
 * History.
 *
 * The record of what the workforce has actually done. Everything on this
 * screen is stored fact: the goal in the words it was given, which agents were
 * assigned, which tools were really called, how long it took, and what came
 * out. Nothing is derived to fill a column - a goal still running has no
 * duration, and says so.
 */

const SUGGESTIONS = [
  'Show my recent tasks',
  "Find last week's results",
  'Summarize my completed work',
  "What's pending?",
] as const

/** Filters, in the order a person reaches for them. */
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'running', label: 'In Progress' },
  { id: 'attention', label: 'Needs Attention' },
  { id: 'cancelled', label: 'Cancelled' },
] as const

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: null, label: 'All time' },
] as const

type FilterId = (typeof FILTERS)[number]['id']

/** Goal state to the four buckets the filters offer. */
function bucket(state: string): FilterId {
  if (state === 'completed') return 'completed'
  if (state === 'cancelled') return 'cancelled'
  // A failure and a goal stuck waiting on a person are both things the user
  // has to do something about, which is what this filter is for.
  if (state === 'failed' || state === 'awaiting_approval') return 'attention'
  return 'running'
}

const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  awaiting_approval: 'Needs Review',
  submitted: 'In Progress',
  planning: 'In Progress',
  executing: 'In Progress',
  synthesising: 'In Progress',
}

/**
 * Phone width, where the detail panel becomes a sheet over the list rather
 * than a column beside it. That changes whether it may open by itself.
 */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)')
    const sync = () => setPhone(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return phone
}

export default function HistoryPage() {
  const router = useRouter()

  const [me, setMe] = useState<Me | null>(null)
  const [agents, setAgents] = useState<readonly AgentInfo[]>([])
  const [entries, setEntries] = useState<readonly HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterId>('all')
  const [days, setDays] = useState<number | null>(30)
  const [rangeOpen, setRangeOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const isPhone = useIsPhone()

  useEffect(() => {
    api.me().then(setMe).catch(() => undefined)
    api.agents().then(setAgents).catch(() => undefined)
  }, [])

  const load = useCallback(async (range: number | null) => {
    setEntries(null)
    try {
      setEntries(await api.history(range))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your history')
      setEntries([])
    }
  }, [])

  useEffect(() => { void load(days) }, [days, load])

  const visible = useMemo(() => {
    if (!entries) return []
    const q = query.trim().toLowerCase()

    return entries.filter((e) => {
      if (filter !== 'all' && bucket(e.state) !== filter) return false
      if (!q) return true
      // Past tasks, results, or agents - the three things the box promises.
      return (
        e.prompt.toLowerCase().includes(q) ||
        (e.summary ?? '').toLowerCase().includes(q) ||
        e.taskTitles.some((t) => t.toLowerCase().includes(q)) ||
        e.agentKeys.some((k) => agentLabel(k, agents).toLowerCase().includes(q))
      )
    })
  }, [entries, query, filter, agents])

  /*
   * Keep a selection only while it is still on screen, so filtering never
   * leaves the panel describing a row the user can no longer see.
   *
   * The first row is selected for you on a wide screen, where the panel sits
   * beside the list and an empty column would just look broken. On a phone it
   * is a sheet *over* the list, so opening one by itself would cover the very
   * rows you came to choose from - there, it waits to be asked.
   */
  const selected = useMemo(() => {
    const picked = visible.find((e) => e.id === selectedId) ?? null
    if (picked) return picked
    return isPhone ? null : (visible[0] ?? null)
  }, [visible, selectedId, isPhone])

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: entries?.length ?? 0 }
    for (const e of entries ?? []) {
      const b = bucket(e.state)
      out[b] = (out[b] ?? 0) + 1
    }
    return out
  }, [entries])

  return (
    <main>
      <Backdrop src="/world/history-bg.png" />

      <Chrome user={me ? { name: me.user.name } : null} />

      <section className="hist">
        <header className="hist__head">
          <div>
            <h1>History</h1>
            <p>Your past goals, tasks, and results — all in one place.</p>
          </div>

          <div className="hist__controls">
            <div className="search lg lg--thin">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search past tasks, results, or agents..."
                aria-label="Search history"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear search">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
                    <path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>

            <div className="range">
              <button
                className="range__btn lg lg--thin"
                onClick={() => setRangeOpen((o) => !o)}
                aria-expanded={rangeOpen}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                  <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
                {RANGES.find((r) => r.days === days)?.label}
              </button>

              {rangeOpen && (
                <ul className="range__menu lg">
                  {RANGES.map((r) => (
                    <li key={r.label}>
                      <button
                        data-active={r.days === days}
                        onClick={() => { setDays(r.days); setRangeOpen(false) }}
                      >
                        {r.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </header>

        <nav className="cats" aria-label="Filter history">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className="cat lg lg--thin"
              data-active={filter === f.id}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {(counts[f.id] ?? 0) > 0 && <span className="cat__n">{counts[f.id]}</span>}
            </button>
          ))}
        </nav>

        {error && <p role="alert" className="tools__error">{error}</p>}

        <div className="hist__main">
          <div className="hist__scroll">
            {entries === null ? (
              <div className="hist__table lg">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="hist__row hist__row--skeleton" aria-hidden="true" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <Empty hasHistory={(entries?.length ?? 0) > 0} onStart={() => router.push('/world')} />
            ) : (
              <div className="hist__table lg" role="table" aria-label="Past goals">
                <div className="hist__thead" role="row">
                  <span role="columnheader">Goal / Task</span>
                  <span role="columnheader">Agents &amp; Tools</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Date</span>
                  <span role="columnheader">Duration</span>
                  <span />
                </div>

                {visible.map((entry) => (
                  <Row
                    key={entry.id}
                    entry={entry}
                    agents={agents}
                    selected={selected?.id === entry.id}
                    onSelect={() => setSelectedId(entry.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {selected && (
            <Detail
              entry={selected}
              agents={agents}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      </section>

      <p className="hist__quote">“A more capable you,<br />with AI agents.”</p>

      <CommandBar suggestions={SUGGESTIONS} onStarted={() => router.push('/world')} />
    </main>
  )
}

// ------------------------------------------------------------------- row --

function Row({
  entry,
  agents,
  selected,
  onSelect,
}: {
  entry: HistoryEntry
  agents: readonly AgentInfo[]
  selected: boolean
  onSelect: () => void
}) {
  const shown = entry.agentKeys.slice(0, 3)
  const extra = entry.agentKeys.length - shown.length

  return (
    <button className="hist__row" data-selected={selected} onClick={onSelect} role="row">
      <span className="hist__goal">
        <span className="hist__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path d="M6 3.5h8l4.5 4.5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z"
              stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M13.5 3.5V8H18" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="hist__title">
          <strong>{entry.prompt}</strong>
          <em>
            {entry.taskCount > 0
              ? `${entry.taskCount} ${entry.taskCount === 1 ? 'task' : 'tasks'} · ${entry.tasksDone} done`
              : 'No tasks yet'}
          </em>
        </span>
      </span>

      <span className="hist__agents">
        {shown.map((key) => (
          <AgentDot key={key} agentKey={key} agents={agents} />
        ))}
        {extra > 0 && <span className="hist__more">+{extra}</span>}
        {entry.agentKeys.length === 0 && <span className="hist__none">—</span>}
      </span>

      <span className="hist__status">
        <span className="sbadge" data-state={bucket(entry.state)}>
          {STATUS_LABEL[entry.state] ?? entry.state}
        </span>
      </span>

      <span className="hist__date">
        <strong>{formatDate(entry.createdAt)}</strong>
        <em>{formatTime(entry.createdAt)}</em>
      </span>

      <span className="hist__dur">{formatDuration(entry.durationMs)}</span>

      <svg className="hist__chev" viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
        <path d="m9.5 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

function AgentDot({ agentKey, agents }: { agentKey: string; agents: readonly AgentInfo[] }) {
  const [missing, setMissing] = useState(false)
  const accent = agents.find((a) => a.key === agentKey)?.accent ?? '#4DA3FF'
  const label = agentLabel(agentKey, agents)

  if (missing) {
    return (
      <span
        className="hist__dot hist__dot--fallback"
        style={{ background: `linear-gradient(150deg, ${accent}, rgb(8 18 34 / .9))` }}
        title={label}
      >
        {label.charAt(0)}
      </span>
    )
  }

  return (
    <img
      className="hist__dot"
      src={`/mascots/${agentKey}.png`}
      alt={label}
      title={label}
      onError={() => setMissing(true)}
    />
  )
}

// ---------------------------------------------------------------- detail --

function Detail({
  entry,
  agents,
  onClose,
}: {
  entry: HistoryEntry
  agents: readonly AgentInfo[]
  onClose: () => void
}) {
  const state = bucket(entry.state)

  return (
    <aside className="hdetail lg" aria-label="Goal details">
      <header className="hdetail__top">
        <span className="sbadge" data-state={state}>
          {state === 'completed' && (
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="currentColor" opacity=".25" />
              <path d="m8 12 2.8 2.8L16 9.5" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {STATUS_LABEL[entry.state] ?? entry.state}
        </span>
        <span className="hdetail__when">
          {formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}
        </span>
        <button className="hdetail__close" onClick={onClose} aria-label="Close details">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
            <path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="hdetail__body">
        <h2 className="hdetail__title">{entry.prompt}</h2>

        <section className="hdetail__goal">
          <span className="hdetail__goalicon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
              <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="12" cy="12" r="3.6" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </span>
          <div>
            <h3>Goal</h3>
            <p>{entry.prompt}</p>
          </div>
        </section>

        {entry.agentKeys.length > 0 && (
          <section>
            <h3 className="hdetail__label">Agents involved</h3>
            <ul className="hdetail__agents">
              {entry.agentKeys.map((key) => (
                <li key={key}>
                  <AgentDot agentKey={key} agents={agents} />
                  <span>{agentLabel(key, agents)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {entry.toolIds.length > 0 && (
          <section>
            <h3 className="hdetail__label">Tools used</h3>
            <ul className="hdetail__tools">
              {entry.toolIds.map((id) => (
                <li key={id}><ToolChip toolId={id} /></li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="hdetail__label">Results</h3>
          {entry.state === 'completed' && entry.summary ? (
            <p className="hdetail__summary">{entry.summary}</p>
          ) : entry.error ? (
            <p className="hdetail__failed">{entry.error}</p>
          ) : (
            <p className="hdetail__pending">
              {state === 'running'
                ? 'Still running. Results appear here when it finishes.'
                : 'No result was recorded for this goal.'}
            </p>
          )}

          {entry.artifacts.length > 0 && (
            <ul className="hdetail__files">
              {entry.artifacts.map((a) => (
                <li key={a.id}>
                  <span className="hdetail__filekind" aria-hidden="true">
                    {a.kind.slice(0, 3).toUpperCase()}
                  </span>
                  <span className="hdetail__filename">
                    <strong>{a.title}</strong>
                    <em>{a.kind}</em>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <dl className="hdetail__stats">
          <div><dt>Duration</dt><dd>{formatDuration(entry.durationMs)}</dd></div>
          <div><dt>Tasks</dt><dd>{entry.tasksDone} of {entry.taskCount}</dd></div>
        </dl>
      </div>
    </aside>
  )
}

function Empty({ hasHistory, onStart }: { hasHistory: boolean; onStart: () => void }) {
  return (
    <div className="tools__empty lg">
      <strong>{hasHistory ? 'Nothing matches those filters' : 'No history yet'}</strong>
      <p>
        {hasHistory
          ? 'Try a different search, filter, or date range.'
          : 'Once you give your workforce a goal, every run is recorded here.'}
      </p>
      {!hasHistory && (
        <button className="btn btn--primary" onClick={onStart}>Give them a goal</button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- format --

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** A goal that has not finished has no duration. Saying so beats guessing. */
function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} sec`
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} hr ${minutes % 60} min`
}
