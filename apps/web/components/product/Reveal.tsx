'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Content that arrives as you reach it.
 *
 * One job, and it earns its place: on a page this long, a section fading up
 * as it comes into view is what tells you it is a new idea rather than more
 * of the last one. Nothing loops, nothing moves after it has arrived.
 *
 * IntersectionObserver rather than a scroll listener, which runs the callback
 * on every frame of every scroll for the whole page. This fires once per
 * element and then disconnects.
 *
 * Reduced motion skips it entirely: the content is simply there, which is the
 * correct end state anyway.
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode
  /** Seconds. For staggering siblings, never more than a few tenths. */
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true)
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          setShown(true)
          io.disconnect()
        }
      },
      // A little before the edge, so it has finished arriving by the time it
      // is properly on screen.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.1 },
    )

    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      data-shown={shown ? 'true' : undefined}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  )
}
