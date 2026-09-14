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
 */

export interface CoverRect {
  /** Offset of the rendered image from the viewport's top-left, in pixels. */
  readonly left: number
  readonly top: number
  /** Rendered size of the image, which exceeds the viewport on one axis. */
  readonly width: number
  readonly height: number
}

export function useCoverRect(imageAspect: number): CoverRect {
  const [rect, setRect] = useState<CoverRect>({ left: 0, top: 0, width: 0, height: 0 })

  useEffect(() => {
    const measure = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const viewportAspect = vw / vh

      if (viewportAspect > imageAspect) {
        // Viewport is wider: the image is scaled to the full width and
        // overflows vertically, so the crop is top and bottom.
        const height = vw / imageAspect
        setRect({ left: 0, top: (vh - height) / 2, width: vw, height })
      } else {
        // Viewport is taller: scaled to full height, cropped left and right.
        const width = vh * imageAspect
        setRect({ left: (vw - width) / 2, top: 0, width, height: vh })
      }
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
