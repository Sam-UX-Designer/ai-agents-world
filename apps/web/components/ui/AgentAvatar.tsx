'use client'

import { useState } from 'react'

/**
 * Where an agent's picture lives.
 *
 * One function because four screens draw the same face, and for a while each
 * built the path itself - so changing what ships meant finding all four.
 *
 * The 256px WebP, not the uploaded PNG. The masters are 1254px and about
 * 1.4 MB each; the picture is drawn at 54px at most, and serving the master
 * made it appear late enough to look like it was not appearing at all. The
 * build cuts these from whatever PNGs are in public/mascots/ - see
 * scripts/optimize-mascots.mjs - so dropping in a new render is still the only
 * step.
 */
export const mascotSrc = (agentKey: string): string => `/mascots/${agentKey}-256.webp`

/**
 * An agent's picture.
 *
 * One component because an agent's face appears in four places - the island
 * card, the detail panel, the working list and History - and for a while three
 * of them drew it differently. The panel header in particular drew a plain
 * coloured square, so uploading the renders changed the island and left the
 * panel looking like the upload had not worked.
 *
 * The file is found by the agent's key, not registered anywhere: drop
 * `<key>.png` into public/mascots/ and the agent is wearing it everywhere.
 *
 * A missing file falls back to the agent's initial on its own accent, never to
 * a broken-image icon. That matters more than it sounds: the roster ships with
 * nine agents and a workspace may have renders for eight of them, so the
 * fallback is a normal state rather than an error.
 */
export function AgentAvatar({
  agentKey,
  name,
  accent,
  size = 38,
  radius,
  className = '',
}: {
  agentKey: string
  /** Used for the fallback initial and as the accessible name. */
  name: string
  accent: string
  size?: number
  /** Corner rounding. Defaults to a squircle-ish proportion of the size. */
  radius?: number
  className?: string
}) {
  /*
   * Which agent's picture failed, not whether one did.
   *
   * The panel keeps one of these mounted and swaps the agent through it, so a
   * plain boolean stuck: open the one agent with no render, and every agent
   * opened afterwards showed its initial too, because the flag was still set
   * from the last one. Comparing against the key resets it the moment the
   * agent changes, with no effect and no `key` prop for callers to remember.
   */
  const [failed, setFailed] = useState<string | null>(null)
  const missing = failed === agentKey
  const corner = radius ?? Math.round(size * 0.29)

  if (missing) {
    return (
      <span
        className={`agentav agentav--fallback ${className}`}
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: corner,
          fontSize: Math.round(size * 0.42),
          background: `color-mix(in srgb, ${accent} 42%, transparent)`,
          border: `1px solid color-mix(in srgb, ${accent} 65%, transparent)`,
        }}
      >
        {name.charAt(0)}
      </span>
    )
  }

  return (
    <img
      className={`agentav ${className}`}
      src={mascotSrc(agentKey)}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: corner }}
      onError={() => setFailed(agentKey)}
    />
  )
}
