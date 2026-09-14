'use client'

import { useEffect, useRef } from 'react'
import { liquidGlass, type LiquidGlassOptions } from './liquidGlass'

/**
 * Attach real refraction to one element.
 *
 * Returns a ref to spread onto the surface. Where the browser cannot do it the
 * hook is a no-op and the element keeps the frosted blur its class already
 * gives it, so nothing depends on refraction being there.
 */
export function useLiquidGlass<T extends HTMLElement>(options?: LiquidGlassOptions) {
  const ref = useRef<T>(null)
  // Kept in a ref so a caller passing an object literal does not re-run the
  // effect on every render and rebuild the map each time.
  const opts = useRef(options)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    // The bend is a visual distortion of everything behind the panel. Someone
    // who asked for less motion should not get it.
    if (media.matches) return

    const handle = liquidGlass(element, opts.current)
    return () => handle.destroy()
  }, [])

  return ref
}
