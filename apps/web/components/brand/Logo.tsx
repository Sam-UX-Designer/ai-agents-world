/**
 * The app logo.
 *
 * One component, so the mark is the same object everywhere and swapping the
 * file is one line. Both places that show it used to draw their own triangle
 * in inline SVG - placeholders, and two different placeholders at that.
 *
 * The rendered file is a 128px WebP rather than the master. The mark is 38px
 * on screen, so 128 covers it at 3x on the densest phone, and the master is a
 * 1.4 MB PNG that would be downloaded in full to be drawn at the size of a
 * fingernail. `public/brand/logo.png` stays as the asset of record - it is
 * what the owner supplied, and what the favicon and touch-icon sizes are cut
 * from.
 *
 * No border-radius here. The logo carries its own rounded square with
 * transparent corners; clipping it again would shave them twice.
 */
export function Logo({ size = 38, className }: { size?: number; className?: string }) {
  return (
    <img
      className={className}
      src="/brand/logo-128.webp"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
    />
  )
}
