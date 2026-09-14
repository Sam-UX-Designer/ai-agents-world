'use client'

import { useState } from 'react'
import type { IntegrationInfo } from '@/lib/api'

/**
 * One integration in the grid.
 *
 * Compact on purpose: the grid is something you scan, so density beats
 * decoration. Only the selected card carries stronger emphasis - if every
 * card glows, none of them do.
 */
export function ToolCard({
  tool,
  selected,
  onSelect,
  onConnect,
  connecting,
}: {
  tool: IntegrationInfo
  selected: boolean
  onSelect: () => void
  onConnect: () => void
  connecting: boolean
}) {
  const connected = tool.connection !== null
  const canConnect = tool.status === 'available'

  return (
    <article
      className="toolcard lg lg--thin"
      data-selected={selected}
      data-connected={connected}
      onClick={onSelect}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <ToolIcon tool={tool} />

      <h3 className="toolcard__name">{tool.name}</h3>
      <p className="toolcard__desc">{tool.description}</p>

      <span className="toolcard__cat">{tool.category}</span>

      <div className="toolcard__foot">
        {connected ? (
          <span className="toolcard__connected">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="currentColor" opacity=".2" />
              <path d="m8 12 2.8 2.8L16 9.5" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Connected
          </span>
        ) : (
          <button
            className="toolcard__connect"
            disabled={!canConnect || connecting}
            onClick={(e) => {
              e.stopPropagation()
              onConnect()
            }}
            // A card for something that cannot be connected yet says why on
            // hover rather than offering a button that will not work.
            title={canConnect ? undefined : (tool.statusNote ?? 'Not available yet')}
          >
            {connecting ? 'Connecting…' : canConnect ? 'Connect' : 'Soon'}
          </button>
        )}

        <button
          className="toolcard__more"
          aria-label={`More about ${tool.name}`}
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" />
          </svg>
        </button>
      </div>
    </article>
  )
}

/**
 * The integration's logo.
 *
 * Falls back to a lettermark until the real icon is uploaded to
 * public/tools/, so a missing file reads as a plain monogram rather than a
 * broken-image glyph in the middle of the grid.
 */
export function ToolIcon({ tool, size = 44 }: { tool: IntegrationInfo; size?: number }) {
  const [missing, setMissing] = useState(false)

  if (missing) {
    return (
      <span className="toolicon toolicon--fallback" style={{ width: size, height: size }}>
        {tool.name.charAt(0)}
      </span>
    )
  }

  return (
    <img
      className="toolicon"
      style={{ width: size, height: size }}
      src={tool.icon}
      alt=""
      onError={() => setMissing(true)}
    />
  )
}
