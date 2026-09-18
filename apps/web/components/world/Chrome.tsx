'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { api, type HistoryEntry, type Usage } from '@/lib/api'
import { useWorld } from '@/lib/store'

/**
 * The chrome that floats over the world: branding, navigation, account.
 *
 * Nothing here sits in a bar or a column that reserves space. Every piece is
 * positioned over the world and sized to its own content, so the island shows
 * through between them rather than being pushed into a panel.
 */

const NAV = [
  { href: '/world', label: 'Home', icon: HomeIcon },
  { href: '/tools', label: 'Tools', icon: ToolsIcon },
  { href: '/history', label: 'History', icon: HistoryIcon },
] as const

export function Chrome({
  user,
}: {
  user: { name: string | null; plan?: string } | null
}) {
  const pathname = usePathname()

  return (
    <>
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
            <path d="M12 3 4 19h4l4-8 4 8h4L12 3Z" fill="currentColor" />
          </svg>
        </span>
        <span className="brand__text">
          <strong>AI Agents World</strong>
          <em>Think it. Delegate it. Get it done.</em>
        </span>
      </div>

      <nav className="sidenav" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className="sidenav__item"
              data-active={active}
              aria-current={active ? 'page' : undefined}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          )
        })}

      </nav>

      {/* Separate from the navigation, further down, floating on its own -
          not a row inside a shared container. */}
      {user && (
        <div className="profile">
          <span className="profile__avatar" aria-hidden="true">
            {(user.name ?? '?').charAt(0).toUpperCase()}
          </span>
          <span className="profile__who">
            <strong>{user.name ?? 'Signed in'}</strong>
            <em>{user.plan ?? 'Free plan'}</em>
          </span>
        </div>
      )}

      <TopRight user={user} />
    </>
  )
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9.5Z"
        stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function ToolsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}


// ---------------------------------------------------------------- top right --

type Panel = 'search' | 'bell' | 'profile' | null

/**
 * Search, notifications and the account menu.
 *
 * One open panel at a time, closed by Escape or by clicking away - three
 * independent popovers that can all be open at once is how a corner like this
 * becomes unusable.
 */
function TopRight({ user }: { user: { name: string | null; plan?: string } | null }) {
  const [open, setOpen] = useState<Panel>(null)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(null)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const toggle = (panel: Panel) => setOpen((o) => (o === panel ? null : panel))

  return (
    <div className="topright" ref={wrap}>
      <button
        className="iconbtn glass"
        aria-label="Search"
        aria-expanded={open === 'search'}
        onClick={() => toggle('search')}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      <NotificationsButton
        open={open === 'bell'}
        onToggle={() => toggle('bell')}
      />

      <button
        className="iconbtn iconbtn--avatar"
        aria-label="Account"
        aria-expanded={open === 'profile'}
        onClick={() => toggle('profile')}
      >
        {(user?.name ?? 'S').charAt(0).toUpperCase()}
      </button>

      {open === 'search' && <SearchPanel onClose={() => setOpen(null)} />}
      {open === 'profile' && <ProfileMenu user={user} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Search across past goals. The same records History shows. */
function SearchPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [all, setAll] = useState<readonly HistoryEntry[] | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    api.history(null).then(setAll).catch(() => setAll([]))
  }, [])

  const q = query.trim().toLowerCase()
  const results = !all
    ? []
    : q
      ? all
          .filter(
            (e) =>
              e.prompt.toLowerCase().includes(q) ||
              (e.summary ?? '').toLowerCase().includes(q) ||
              e.taskTitles.some((t) => t.toLowerCase().includes(q)),
          )
          .slice(0, 8)
      : all.slice(0, 5)

  return (
    <div className="pop lg" role="dialog" aria-label="Search">
      <div className="pop__search">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your goals…"
          aria-label="Search your goals"
        />
      </div>

      {all === null ? (
        <p className="pop__empty">Searching…</p>
      ) : results.length === 0 ? (
        <p className="pop__empty">
          {q ? `Nothing matches “${query.trim()}”.` : 'No goals yet. Ask for something below.'}
        </p>
      ) : (
        <>
          {!q && <p className="pop__head">Recent</p>}
          <ul className="pop__list">
            {results.map((entry) => (
              <li key={entry.id}>
                <button
                  onClick={() => { onClose(); router.push('/history') }}
                >
                  <strong>{entry.prompt}</strong>
                  <em>{new Date(entry.createdAt).toLocaleDateString()}</em>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * Notifications.
 *
 * The things that genuinely want the user: an approval waiting on them, and a
 * goal that failed. Both come from the live world state, so the dot appears
 * the moment one happens rather than on a poll.
 */
function NotificationsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const approvals = useWorld((s) => s.approvals)
  const goalState = useWorld((s) => s.goalState)
  const goalError = useWorld((s) => s.goalError)
  const goalId = useWorld((s) => s.goalId)

  const items = [
    ...approvals.map((a) => ({
      id: a.id,
      tone: 'warn' as const,
      title: 'Waiting for your approval',
      body: a.description,
    })),
    ...(goalId && goalState === 'failed'
      ? [{
          id: 'goal-failed',
          tone: 'bad' as const,
          title: 'A goal could not finish',
          body: goalError ?? 'Open History to see what happened.',
        }]
      : []),
  ]

  return (
    <>
      <button
        className="iconbtn glass"
        aria-label={items.length > 0 ? `Notifications, ${items.length} new` : 'Notifications'}
        aria-expanded={open}
        onClick={onToggle}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
          <path
            d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 15Z"
            stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
          />
          <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {items.length > 0 && <span className="iconbtn__dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="pop lg" role="dialog" aria-label="Notifications">
          <p className="pop__head">Notifications</p>
          {items.length === 0 ? (
            <p className="pop__empty">Nothing needs you right now.</p>
          ) : (
            <ul className="pop__notes">
              {items.map((item) => (
                <li key={item.id} data-tone={item.tone}>
                  <strong>{item.title}</strong>
                  <em>{item.body}</em>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

/** The account menu: who you are, what you have used, and the way out. */
function ProfileMenu({
  user,
  onClose,
}: {
  user: { name: string | null; plan?: string } | null
  onClose: () => void
}) {
  const router = useRouter()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => { api.usage().then(setUsage).catch(() => undefined) }, [])

  const signOut = useCallback(async () => {
    setSigningOut(true)
    try { await api.signOut() } catch { /* the cookie may already be gone */ }
    useWorld.getState().reset()
    onClose()
    router.replace('/signin')
  }, [onClose, router])

  return (
    <div className="pop pop--profile lg" role="dialog" aria-label="Account">
      <div className="pop__who">
        <span className="pop__avatar">{(user?.name ?? 'S').charAt(0).toUpperCase()}</span>
        <span>
          <strong>{user?.name ?? 'Signed in'}</strong>
          <em>{usage?.plan ?? user?.plan ?? 'Free plan'}</em>
        </span>
      </div>

      <section className="usage">
        <p className="pop__head">This month</p>

        {usage === null ? (
          <p className="pop__empty">Loading usage…</p>
        ) : (
          <>
            <dl className="usage__figures">
              <div>
                <dt>Credits used</dt>
                <dd>{usage.creditsUsed.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Agent time</dt>
                <dd>{usage.agentMinutes < 60
                  ? `${usage.agentMinutes} min`
                  : `${(usage.agentMinutes / 60).toFixed(1)} hr`}</dd>
              </div>
              <div>
                <dt>Goals run</dt>
                <dd>{usage.goalsRun}</dd>
              </div>
            </dl>

            {/*
              Activity, not a quota. There is no billing limit in this product
              yet, so a bar filling toward one would be inventing a number the
              user could budget against. Each square is a goal that ran, and
              the lighter ones are the goals that finished.
            */}
            <div className="usage__grid" aria-hidden="true">
              {Array.from({ length: 28 }, (_, i) => {
                const ran = i < Math.min(28, usage.goalsRun)
                const done = i < Math.min(28, usage.goalsCompleted)
                return (
                  <span
                    key={i}
                    className="usage__cell"
                    data-level={done ? 'done' : ran ? 'ran' : 'none'}
                  />
                )
              })}
            </div>
            <p className="usage__legend">
              {usage.goalsCompleted} of {usage.goalsRun} finished
            </p>
          </>
        )}
      </section>

      <button className="pop__out" onClick={() => void signOut()} disabled={signingOut}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2"
            stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M17 15l3-3-3-3M20 12H9" stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {signingOut ? 'Signing out…' : 'Log out'}
      </button>
    </div>
  )
}
