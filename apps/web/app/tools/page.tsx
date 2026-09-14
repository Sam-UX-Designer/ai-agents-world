'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, type IntegrationInfo, type Me } from '@/lib/api'
import { Chrome } from '@/components/world/Chrome'
import { CommandBar } from '@/components/world/World'
import { ToolCard } from '@/components/tools/ToolCard'
import { ToolDetail } from '@/components/tools/ToolDetail'
import { RequestTool } from '@/components/tools/RequestTool'

/**
 * Tools.
 *
 * Same environment as Home - the island is still the screen, and every
 * surface here floats over it. What changes is what floats: a catalogue
 * instead of a live world.
 *
 * Tools are capabilities, not agents. Connecting Gmail does not create a
 * "Gmail Agent"; it hands an existing agent something new it can reach. The
 * Agents tab in the detail panel is where that becomes visible.
 */

const ALL = 'All Tools'

const SUGGESTIONS = [
  'Connect my Gmail',
  'Show connected tools',
  'Add a new integration',
  'Find tools for marketing',
] as const

export default function ToolsPage() {
  const router = useRouter()

  const [me, setMe] = useState<Me | null>(null)
  const [tools, setTools] = useState<readonly IntegrationInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>(ALL)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await api.integrations()
      setTools(list)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load tools')
      setTools([])
    }
  }, [])

  useEffect(() => {
    api.me().then(setMe).catch(() => undefined)
    void load()
  }, [load])

  /* Categories come from the catalogue rather than a second hard-coded list,
     so a new integration brings its filter with it. */
  const categories = useMemo(() => {
    if (!tools) return [ALL]
    const seen: string[] = []
    for (const t of tools) if (!seen.includes(t.category)) seen.push(t.category)
    return [ALL, ...seen]
  }, [tools])

  const visible = useMemo(() => {
    if (!tools) return []
    const q = query.trim().toLowerCase()

    return tools.filter((t) => {
      if (category !== ALL && t.category !== category) return false
      if (!q) return true
      // Searching "email" should find Gmail, so capability names count too.
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.capabilities.some((c) => c.label.toLowerCase().includes(q))
      )
    })
  }, [tools, query, category])

  const selected = useMemo(
    () => (selectedId ? (tools?.find((t) => t.id === selectedId) ?? null) : null),
    [tools, selectedId],
  )

  const connectedCount = tools?.filter((t) => t.connection !== null).length ?? 0

  const connect = async (tool: IntegrationInfo) => {
    if (!tool.provider || tool.status !== 'available') return
    setConnecting(tool.id)
    setError(null)
    try {
      const { url } = await api.connectUrl(tool.provider)
      // A real OAuth consent screen. Nothing is marked connected until the
      // provider redirects back and the callback stores a token.
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that connection')
      setConnecting(null)
    }
  }

  const disconnect = async (tool: IntegrationInfo) => {
    if (!tool.connection) return
    try {
      await api.disconnect(tool.connection.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect that')
    }
  }

  return (
    <main>
      {/* The world, full-bleed behind everything. */}
      <div className="world" aria-hidden="true">
        <img className="world__art" src="/world/tools-bg.png" alt="" />
        <div className="world__veil" />
      </div>

      <Chrome user={me ? { name: me.user.name, plan: 'Pro plan' } : null} />

      <section className="tools">
        <header className="tools__head">
          <div>
            <h1>Tools</h1>
            <p>Connect the tools your agents need to do real work.</p>
          </div>

          <div className="tools__actions">
            <div className="search lg lg--thin">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tools..."
                aria-label="Search tools"
                type="search"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear search">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
                    <path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>

            <button
              className="btn btn--primary btn--request"
              onClick={() => setRequesting(true)}
              // The label collapses to the icon on a phone, where a full-width
              // search box and a five-word button cannot share one row.
              aria-label="Request a tool"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" />
              </svg>
              <span>Request a tool</span>
            </button>
          </div>
        </header>

        <nav className="cats" aria-label="Filter by category">
          {categories.map((c) => (
            <button
              key={c}
              className="cat lg lg--thin"
              data-active={category === c}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
          {tools && (
            <span className="cats__count">
              {connectedCount} connected · {tools.length} available
            </span>
          )}
        </nav>

        {error && <p role="alert" className="tools__error">{error}</p>}

        <div className="tools__main">
          <div className="tools__scroll">
            {tools === null ? (
              <div className="grid">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="toolcard toolcard--skeleton lg lg--thin" aria-hidden="true" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="tools__empty lg">
                <strong>No tools match “{query || category}”</strong>
                <p>Try another search, or ask us to build it.</p>
                <button className="btn btn--primary" onClick={() => setRequesting(true)}>
                  Request {query.trim() ? `“${query.trim()}”` : 'a tool'}
                </button>
              </div>
            ) : (
              <div className="grid">
                {visible.map((tool) => (
                  <ToolCard
                    key={tool.id}
                    tool={tool}
                    selected={tool.id === selectedId}
                    onSelect={() => setSelectedId(tool.id === selectedId ? null : tool.id)}
                    onConnect={() => void connect(tool)}
                    connecting={connecting === tool.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* A column beside the grid rather than a panel over it: the header
              and the filters above stay exactly where they were, so opening a
              tool never moves the control you just used. */}
          {selected && (
            <ToolDetail
              tool={selected}
              onClose={() => setSelectedId(null)}
              onConnect={() => void connect(selected)}
              onDisconnect={() => void disconnect(selected)}
              connecting={connecting === selected.id}
            />
          )}
        </div>
      </section>

      {requesting && (
        <RequestTool prefill={query.trim()} onClose={() => { setRequesting(false); }} />
      )}

      {/* The same input as Home. Asking for something is always one reach
          away, whatever screen you are on - and the work itself happens in
          the world, so that is where a new goal takes you. */}
      <CommandBar suggestions={SUGGESTIONS} onStarted={() => router.push('/world')} />
    </main>
  )
}
