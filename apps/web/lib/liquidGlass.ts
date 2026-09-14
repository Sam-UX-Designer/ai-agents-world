/**
 * Liquid glass: real refraction at the rim.
 *
 * Blur alone gives frosted glass. What makes a surface read as *glass* is that
 * the background bends where the pane thickens at its edge, and splits very
 * slightly into colour as it does. That is a displacement map applied to the
 * backdrop, which is what this builds.
 *
 * The approach, and its constraints, follow the liquid-glass skill:
 *
 *   - The filter MUST declare color-interpolation-filters="sRGB". Without it
 *     the browser works in linearRGB, which remaps the map's neutral grey and
 *     ghosts the whole backdrop up and to the left.
 *   - Refraction belongs at the rim. The interior of the map stays neutral so
 *     text over the middle of the panel never smears.
 *   - `backdrop-filter: url()` is Chromium-only. Everywhere else this does
 *     nothing at all and the CSS frosted-blur stands on its own, so refraction
 *     never carries meaning.
 *   - The map costs width x height to generate, so it is rebuilt only when the
 *     element's size changes - never for a move or a scroll.
 */

export interface LiquidGlassOptions {
  /** Displacement strength in pixels. Subtle 60, default 112, dramatic 180. */
  readonly scale?: number
  /** Chromatic fringe, in pixels of extra displacement on red vs blue. */
  readonly chroma?: number
  /** How far in from the edge the bend reaches. */
  readonly border?: number
  readonly radius?: number
  readonly blur?: number
  readonly saturate?: number
}

let uid = 0

/** Signed distance to a rounded rectangle. Negative inside. */
function sdf(x: number, y: number, hx: number, hy: number, r: number): number {
  const qx = Math.abs(x) - (hx - r)
  const qy = Math.abs(y) - (hy - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

/**
 * The displacement map.
 *
 * Red carries horizontal displacement, green vertical, both centred on 128 =
 * no movement. The interior is left exactly neutral; only a band `border` wide
 * along the edge ramps up, squared so the bend concentrates right at the rim
 * the way thickening glass does.
 */
function buildMap(w: number, h: number, radius: number, border: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const image = ctx.createImageData(w, h)
  const data = image.data
  const hx = w / 2
  const hy = h / 2
  const r = Math.min(radius, hx, hy)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hx
      const py = y + 0.5 - hy
      const d = sdf(px, py, hx, hy, r)

      // 0 through the interior, rising to 1 at the very edge.
      const t = Math.max(0, Math.min(1, 1 + d / border))
      const strength = t * t

      // Outward normal by central difference; cheap and stable enough here.
      const e = 1
      const nx = sdf(px + e, py, hx, hy, r) - sdf(px - e, py, hx, hy, r)
      const ny = sdf(px, py + e, hx, hy, r) - sdf(px, py - e, hx, hy, r)
      const len = Math.hypot(nx, ny) || 1

      const i = (y * w + x) * 4
      data[i] = Math.max(0, Math.min(255, 128 + (nx / len) * strength * 127))
      data[i + 1] = Math.max(0, Math.min(255, 128 + (ny / len) * strength * 127))
      data[i + 2] = 128
      data[i + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL()
}

/**
 * Three displacements at slightly different strengths, recombined one channel
 * each. That difference is the chromatic fringe - the faint colour separation
 * along the rim of real glass.
 */
function filterMarkup(id: string, map: string, w: number, h: number, scale: number, chroma: number): string {
  const channel = (name: string, s: number, matrix: string) => `
    <feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m_${name}"/>
    <feDisplacementMap in="SourceGraphic" in2="m_${name}" scale="${s}"
      xChannelSelector="R" yChannelSelector="G" result="d_${name}"/>
    <feColorMatrix in="d_${name}" type="matrix" values="${matrix}" result="c_${name}"/>`

  return `
  <filter id="${id}" color-interpolation-filters="sRGB"
          x="0" y="0" width="100%" height="100%" filterUnits="objectBoundingBox"
          primitiveUnits="userSpaceOnUse">
    ${channel('r', scale + chroma, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0')}
    ${channel('g', scale, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0')}
    ${channel('b', scale - chroma, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0')}
    <feBlend in="c_r" in2="c_g" mode="screen" result="rg"/>
    <feBlend in="rg" in2="c_b" mode="screen"/>
  </filter>`
}

/** Chromium is the only engine that filters a backdrop through an SVG filter. */
const supportsBackdropFilterUrl = (): boolean =>
  typeof CSS !== 'undefined' &&
  CSS.supports?.('backdrop-filter', 'url(#x)') === true

export function liquidGlass(
  element: HTMLElement,
  options: LiquidGlassOptions = {},
): { supported: boolean; destroy: () => void } {
  const {
    scale = -112,
    chroma = 6,
    border = 22,
    radius = 24,
    blur = 6,
    saturate = 150,
  } = options

  if (!supportsBackdropFilterUrl()) return { supported: false, destroy: () => {} }

  const id = `lg-filter-${++uid}`
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none;opacity:0'
  document.body.appendChild(svg)

  let last = ''
  const render = (w: number, h: number) => {
    const key = `${w}x${h}`
    // Only a size change invalidates the map. Moving or scrolling does not.
    if (key === last || w < 2 || h < 2) return
    last = key

    const map = buildMap(Math.round(w), Math.round(h), radius, border)
    if (!map) return
    svg.innerHTML = filterMarkup(id, map, Math.round(w), Math.round(h), scale, chroma)
    element.style.backdropFilter = `url(#${id}) blur(${blur}px) saturate(${saturate}%)`
  }

  const observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect
    if (box) render(box.width, box.height)
  })
  observer.observe(element)

  const rect = element.getBoundingClientRect()
  render(rect.width, rect.height)

  return {
    supported: true,
    destroy: () => {
      observer.disconnect()
      svg.remove()
      element.style.backdropFilter = ''
    },
  }
}
