'use client'

import { useEffect, useState } from 'react'

/**
 * Where a `cover`-fitted image actually lands on screen.
 *
 * The world fills the viewport with `object-fit: cover`, so on any screen that
 * is not exactly 16:9 the artwork is cropped - wider screens lose the top and
 * bottom, taller ones lose the sides. That means a marker placed at "50% of
 * the container" is no longer at 50% of the *island*: it drifts off its
 * station as the window changes shape.
 *
 * This reproduces the browser's own cover maths so markers can be positioned
 * against the image rather than against the viewport. A station stays on its
 * station at every aspect ratio, which is the whole point of anchoring them to
 * the artwork.
 *
 * On a phone it then draws the island a little larger than cover - see
 * PHONE_HEADROOM. The offsets returned are still the island's true position,
 * so everything anchored to them stays anchored.
 */

export interface CoverRect {
  /** Offset of the rendered image from the viewport's top-left, in pixels. */
  readonly left: number
  readonly top: number
  /** Rendered size of the image, which exceeds the viewport on one axis. */
  readonly width: number
  readonly height: number
}

/**
 * How much bigger than `cover` to draw the island on a small screen.
 *
 * Cover overflows on exactly one axis - whichever one the viewport is short
 * of - and leaves the other flush. On a phone held upright the flush axis is
 * the vertical one: the island is exactly as tall as the screen, so there is
 * nothing above or below to move to and a vertical drag does nothing at all.
 *
 * Scaling the whole island up gives both directions somewhere to travel. It
 * has to be the whole island rather than one axis, because stretching one
 * side would change the artwork's proportions and take every station off its
 * building.
 *
 * 1.22 is chosen from the smallest phone this has to work on: about 670px
 * tall, where it buys roughly 145px of vertical travel. Less than that and a
 * drag reads as the screen resisting rather than as scrolling.
 */
const PHONE_HEADROOM = 1.22

/** The width the phone stylesheet switches at. Same number, same meaning. */
const PHONE_WIDTH = 900

export function useCoverRect(imageAspect: number): CoverRect {
  const [rect, setRect] = useState<CoverRect>({ left: 0, top: 0, width: 0, height: 0 })

  useEffect(() => {
    const measure = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight

      // Cover: the smallest size that leaves no gap on either side. One of
      // these two is the binding constraint and the other is the overflow.
      const coverWidth = Math.max(vw, vh * imageAspect)

      /*
       * Desktop keeps cover exactly.
       *
       * The headroom is there to make a gesture possible, and on a pointer
       * device the island is already read at a glance rather than explored by
       * dragging. Applying it everywhere would zoom the hero on every laptop
       * for the sake of a scroll nobody performs there.
       */
      const scale = vw <= PHONE_WIDTH ? PHONE_HEADROOM : 1

      /*
       * Whole pixels.
       *
       * The island is drawn twice over: once as the <img>, and once inside
       * each robot patch, which fills itself with the same image scaled to
       * the same size so that it cannot be told from what is underneath it.
       * That only holds if both land on the same pixel grid, and a fractional
       * width puts them half a pixel apart - which showed up as a faint
       * outline traced around every robot. Rounding here fixes it at the one
       * place the size is decided.
       */
      const width = Math.round(coverWidth * scale)
      const height = Math.round((coverWidth / imageAspect) * scale)

      // Centred, so the overflow hangs off both sides equally. A negative
      // offset is the same statement as "there is island off that edge".
      setRect({
        left: Math.round((vw - width) / 2),
        top: Math.round((vh - height) / 2),
        width,
        height,
      })
    }

    measure()
    window.addEventListener('resize', measure)
    // Mobile browsers change viewport height when the URL bar hides, which
    // resize alone does not always report.
    window.visualViewport?.addEventListener('resize', measure)

    return () => {
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [imageAspect])

  return rect
}

/** Screen position, in pixels, of a point given as a fraction of the image. */
export function pointOn(
  rect: CoverRect,
  fraction: readonly [x: number, y: number],
): { left: number; top: number } {
  return {
    left: rect.left + fraction[0] * rect.width,
    top: rect.top + fraction[1] * rect.height,
  }
}
