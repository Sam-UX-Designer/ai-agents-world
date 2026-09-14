'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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

      <div className="topright">
        <button className="iconbtn glass" aria-label="Search">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button className="iconbtn glass" aria-label="Notifications">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
            <path
              d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 15Z"
              stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
            />
            <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
        <span className="iconbtn iconbtn--avatar" aria-hidden="true">
          {(user?.name ?? 'S').charAt(0).toUpperCase()}
        </span>
      </div>
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
