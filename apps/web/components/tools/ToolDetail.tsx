'use client'

import { useEffect, useState } from 'react'
import type { IntegrationInfo } from '@/lib/api'
import { useLiquidGlass } from '@/lib/useLiquidGlass'
import { ToolIcon } from './ToolCard'

/**
 * The detail panel.
 *
 * Everything here is derived from the same catalogue the runtime enforces, so
 * the panel cannot promise access the agent does not actually have. The three
 * tabs answer three different questions, which is why they are tabs and not
 * one long column:
 *
 *   Overview   - what can this thing do?
 *   Permissions- what will it do without asking me?
 *   Agents     - who on my team is already using it?
 */

const TABS = ['Overview', 'Permissions', 'Connected Agents'] as const
type Tab = (typeof TABS)[number]

export function ToolDetail({
  tool,
  onClose,
  onConnect,
  onDisconnect,
  connecting,
}: {
  tool: IntegrationInfo
  onClose: () => void
  onConnect: () => void
  onDisconnect: () => void
  connecting: boolean
}) {
  const [tab, setTab] = useState<Tab>('Overview')
  const surface = useLiquidGlass<HTMLElement>({ scale: -88, chroma: 5, border: 24, radius: 20 })

  // A different tool is a different subject. Landing on Permissions because
  // that is where you were last would bury the thing you just clicked.
  useEffect(() => { setTab('Overview') }, [tool.id])

  const connected = tool.connection !== null

  return (
    <aside className="detail lg" ref={surface} aria-label={`${tool.name} details`}>
      <button className="detail__close" onClick={onClose} aria-label="Close details">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" strokeWidth="1.9"
            strokeLinecap="round" />
        </svg>
      </button>

      <header className="detail__head">
        <ToolIcon tool={tool} size={52} />
        <div className="detail__title">
          <h2>{tool.name}</h2>
          <p>{tool.description}</p>
        </div>
      </header>

      <div className="detail__status">
        <StatusBadge tool={tool} />
        <span className="detail__cat">{tool.category}</span>
      </div>

      <nav className="detail__tabs" role="tablist" aria-label="Tool details">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            className="detail__tab"
            data-active={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'Connected Agents' ? 'Agents' : t}
          </button>
        ))}
      </nav>

      <div className="detail__body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'Overview' && <Overview tool={tool} />}
        {tab === 'Permissions' && <Permissions tool={tool} />}
        {tab === 'Connected Agents' && <ConnectedAgents tool={tool} />}
      </div>

      <footer className="detail__foot">
        {connected ? (
          <>
            <span className="detail__account">{tool.connection?.accountLabel}</span>
            <button className="btn btn--ghost" onClick={onDisconnect}>Disconnect</button>
          </>
        ) : (
          <button
            className="btn btn--primary"
            onClick={onConnect}
            disabled={tool.status !== 'available' || connecting}
          >
            {connecting ? 'Opening…' : tool.status === 'available' ? `Connect ${tool.name}` : 'Not available yet'}
          </button>
        )}
      </footer>
    </aside>
  )
}

// ------------------------------------------------------------------- tabs --

function Overview({ tool }: { tool: IntegrationInfo }) {
  if (tool.capabilities.length === 0) {
    return (
      <Empty
        title="No capabilities yet"
        body={tool.statusNote ?? 'This integration is on the roadmap. Nothing is wired up behind it yet.'}
      />
    )
  }

  return (
    <>
      <h3 className="detail__label">What this tool can do</h3>
      <ul className="caps">
        {tool.capabilities.map((c) => (
          <li key={c.id} className="caps__row">
            <Check />
            <span className="caps__text">
              <strong>{c.label}</strong>
              <em>{c.description}</em>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * Permissions, split by what it means for the user rather than by API verb.
 *
 * The line that matters is the third one. Everything above it happens quietly;
 * everything below it stops and waits for a person. Financial and destructive
 * actions sit there permanently and no setting moves them.
 */
const GROUPS = [
  {
    kind: 'read' as const,
    title: 'Can read on its own',
    note: 'Happens without asking you.',
  },
  {
    kind: 'write' as const,
    title: 'Can prepare on its own',
    note: 'Written into your workspace, but not sent anywhere.',
  },
  {
    kind: 'approval' as const,
    title: 'Always asks you first',
    note: 'Nothing here runs until you approve it.',
  },
]

function Permissions({ tool }: { tool: IntegrationInfo }) {
  if (tool.permissions.length === 0) {
    return (
      <Empty
        title="Nothing to grant yet"
        body="Permissions appear once this integration has capabilities behind it."
      />
    )
  }

  return (
    <div className="perms">
      {GROUPS.map((group) => {
        const items = tool.permissions.filter((p) => p.kind === group.kind)
        if (items.length === 0) return null

        return (
          <section key={group.kind} className="perms__group" data-kind={group.kind}>
            <header className="perms__head">
              <PermIcon kind={group.kind} />
              <span>
                <strong>{group.title}</strong>
                <em>{group.note}</em>
              </span>
            </header>
            <ul className="perms__list">
              {items.map((p) => (
                <li key={p.toolId}>
                  <strong>{p.label}</strong>
                  <em>{p.description}</em>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

const LEVEL_LABEL: Record<'read' | 'write' | 'act', string> = {
  read: 'Read only',
  write: 'Can prepare drafts',
  act: 'Can act, with approval',
}

function ConnectedAgents({ tool }: { tool: IntegrationInfo }) {
  const connected = tool.connection !== null

  if (tool.agents.length === 0) {
    return (
      <Empty
        title="No agents use this yet"
        body="Once this integration has capabilities, the agents granted them appear here."
      />
    )
  }

  return (
    <>
      <h3 className="detail__label">
        {tool.agents.length} {tool.agents.length === 1 ? 'agent' : 'agents'} can use this
      </h3>
      <ul className="agentlist">
        {tool.agents.map((a) => (
          <li key={a.agentKey} className="agentlist__row">
            <AgentAvatar agentKey={a.agentKey} accent={a.accent} name={a.agentName} />
            <span className="agentlist__who">
              <strong>{a.agentName}</strong>
              <em>{LEVEL_LABEL[a.level]} · {a.grantedCount} of {a.totalCount} capabilities</em>
            </span>
            {/* Access is the agent's grant; whether it works right now is the
                connection. Saying "active" on an unconnected tool would be a
                lie the first time someone tried to use it. */}
            <span className="agentlist__state" data-live={connected}>
              {connected ? 'Active' : 'Needs connection'}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

// ------------------------------------------------------------------ parts --

function StatusBadge({ tool }: { tool: IntegrationInfo }) {
  if (tool.connection) {
    return <span className="sbadge" data-tone="ok">Connected</span>
  }
  if (tool.status === 'available') {
    return <span className="sbadge" data-tone="idle">Not connected</span>
  }
  return (
    <span className="sbadge" data-tone="soon" title={tool.statusNote ?? undefined}>
      {tool.status === 'blocked' ? 'Unavailable here' : 'Coming soon'}
    </span>
  )
}

/** Mascot, with the same lettermark fallback the island uses. */
function AgentAvatar({ agentKey, accent, name }: { agentKey: string; accent: string; name: string }) {
  const [missing, setMissing] = useState(false)

  if (missing) {
    return (
      <span
        className="agentlist__avatar agentlist__avatar--fallback"
        style={{ background: `linear-gradient(150deg, ${accent}, rgb(8 18 34 / 0.9))` }}
        aria-hidden="true"
      >
        {name.charAt(0)}
      </span>
    )
  }

  return (
    <img
      className="agentlist__avatar"
      src={`/mascots/${agentKey}.png`}
      alt=""
      onError={() => setMissing(true)}
    />
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="detail__empty">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}

function Check() {
  return (
    <svg className="caps__check" viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity=".16" />
      <path d="m7.8 12.2 2.9 2.9 5.5-6" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PermIcon({ kind }: { kind: 'read' | 'write' | 'approval' }) {
  if (kind === 'read') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
          stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    )
  }
  if (kind === 'write') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
        <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke="currentColor" strokeWidth="1.7"
          strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M6 10.5V8a6 6 0 1 1 12 0v2.5" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" />
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}
