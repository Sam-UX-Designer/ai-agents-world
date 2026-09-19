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
      <img className="world__art" src={src} alt="" />
      {veil && <div className="world__veil" />}
    </div>
  )
}
