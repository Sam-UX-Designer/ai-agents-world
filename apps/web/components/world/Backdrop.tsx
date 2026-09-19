/**
 * The island, behind everything.
 *
 * Home renders the live world; every other screen renders this - the same
 * place, standing still. It is one component rather than five copies of the
 * same three elements because the veil and the cover-fit are what make a
 * photograph read as an environment, and those had already been pasted twice
 * before this existed.
 *
 * `fixed` and `aria-hidden`, so a long page scrolls over a stationary island
 * and a screen reader never announces the scenery.
 *
 * The artwork is supplied, never generated. Both background files on disk are
 * byte-identical, so the default is simply the one every new screen should
 * use; `src` exists for the day they stop being the same.
 */
export function Backdrop({
  src = '/world/tools-bg.png',
  veil = true,
}: {
  src?: string
  /** Off only where a screen paints its own wash over the top. */
  veil?: boolean
}) {
  return (
    <div className="world" aria-hidden="true">
      <WorldArt src={src} />
      {veil && <div className="world__veil" />}
    </div>
  )
}

/**
 * The artwork itself, WebP first.
 *
 * The PNG stays the asset of record - it is what the owner uploaded and what
 * the WebP is generated from at build time, at a quality the owner chose by
 * comparing a 2x crop of the most detailed part of the artwork against the
 * original. It is a sixth of the size and indistinguishable at viewing size.
 *
 * <picture> here negotiates FORMAT, and nothing else. A browser too old for
 * WebP skips the <source> and loads the PNG. It is not an error fallback: a
 * 404 on the <source> renders a broken image and the <img> is never reached -
 * measured, not assumed. The build guarantees the file exists instead, and
 * fails if it cannot.
 *
 * Exported because Home's live world needs the same two lines, and a second
 * copy of them is how one screen ends up quietly serving the 3 MB version.
 */
export function WorldArt({
  src,
  className = 'world__art',
  onError,
}: {
  /** The PNG path. The WebP is derived from it. */
  src: string
  className?: string
  onError?: () => void
}) {
  return (
    <picture>
      <source srcSet={src.replace(/\.png$/, '.webp')} type="image/webp" />
      <img
        className={className}
        src={src}
        alt=""
        // The first paint on the landing page is this image. Telling the
        // browser that beats letting it discover it halfway down the queue.
        fetchPriority="high"
        decoding="async"
        {...(onError ? { onError } : {})}
      />
    </picture>
  )
}
