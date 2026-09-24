'use client'

import { useEffect, useState } from 'react'

type Mode = 'light' | 'dark'
const KEY = 'agents-world-product-theme'

/**
 * Light and dark, with the switch the page needs.
 *
 * The app itself is dark only: it is a place, and a place has a time of day.
 * This page is not the app, it is a page about it, and a page someone reads
 * in daylight on a white laptop should be able to be white.
 *
 * The starting mode is the reader's own system setting. Choosing one stores
 * it, because someone who has just switched to light has said something about
 * every visit, not only this one.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode | null>(null)

  useEffect(() => {
    let start: Mode
    try {
      const saved = localStorage.getItem(KEY)
      start = saved === 'light' || saved === 'dark'
        ? saved
        : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    } catch {
      // Private windows and blocked site data both throw here. The page must
      // still render, so fall back to the system without remembering.
      start = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }
    setMode(start)
  }, [])

  useEffect(() => {
    if (!mode) return
    document.documentElement.dataset.pt = mode
    try {
      localStorage.setItem(KEY, mode)
    } catch {
      // Not being able to remember is not a reason to fail to switch.
    }
  }, [mode])

  const next: Mode = mode === 'light' ? 'dark' : 'light'

  return (
    <button
      type="button"
      className="pt__toggle"
      onClick={() => setMode(next)}
      aria-label={`Switch to ${next} mode`}
      // Until the effect has run there is no honest label to show, and a
      // button that says "light" on a light page is worse than a blank one.
      disabled={mode === null}
    >
      <span className="pt__toggleicon" aria-hidden="true" />
      <span>{mode === null ? '' : next === 'light' ? 'Light' : 'Dark'}</span>
    </button>
  )
}
