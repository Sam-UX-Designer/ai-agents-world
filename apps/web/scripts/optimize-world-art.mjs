/**
 * Re-encode the supplied artwork as WebP, at build time.
 *
 * The island renders are PNGs of photographic 3D output, which is the one
 * thing PNG is bad at - the hero alone is 3 MB, and it is the first paint on
 * the landing page. WebP carries the same pixels in less of it.
 *
 * LOSSLESS, deliberately. The product owner supplies every visual asset, and
 * a build step that quietly degrades one of them would be the build making a
 * design decision. Lossless output is bit-for-bit identical when decoded -
 * this is a change of container, not of picture. `QUALITY` below is the one
 * line to change if that ever stops being the right trade.
 *
 * It runs on every build rather than once by hand, because the alternative is
 * an owner replacing a PNG, seeing the old image on the deployed site, and
 * having no way to tell why.
 *
 * It fails the build if it cannot produce a WebP for every PNG. <picture>
 * only falls back on an unsupported FORMAT - a browser too old for WebP skips
 * the <source> and takes the PNG. It does not fall back on a MISSING FILE: a
 * 404 on the <source> renders a broken image and the <img> is never consulted.
 * That was measured, not assumed. So the only safe guarantee is that the file
 * is always there, and a loud build failure beats a silent broken hero.
 */
import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const DIR = new URL('../public/world/', import.meta.url).pathname

/** Lossless. See the note above before changing this. */
const QUALITY = { lossless: true, effort: 6 }

const mtime = async (path) => {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return null
  }
}

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`

let written = 0
let skipped = 0
const broken = []

for (const file of await readdir(DIR)) {
  if (!file.endsWith('.png')) continue

  const png = join(DIR, file)
  const webp = png.replace(/\.png$/, '.webp')

  const pngAt = await mtime(png)
  const webpAt = await mtime(webp)

  // Up to date. Nothing to do, and re-encoding a 3 MB render on every build
  // for no reason is a minute of CI time per deploy.
  if (webpAt !== null && pngAt !== null && webpAt >= pngAt) {
    skipped++
    continue
  }

  try {
    const info = await sharp(png).webp(QUALITY).toFile(webp)
    const before = (await stat(png)).size
    console.log(
      `  ${file} -> .webp  ${mb(before)} -> ${mb(info.size)}  ` +
        `(${Math.round(100 - (info.size * 100) / before)}% smaller)`,
    )
    written++
  } catch (err) {
    // Leave nothing stale behind - a previous encoding of a different picture
    // is the one outcome worse than no encoding at all.
    console.error(`  ${file}: could not encode WebP - ${err.message}`)
    if (webpAt !== null) await unlink(webp).catch(() => undefined)
    broken.push(file)
  }
}

console.log(`world art: ${written} re-encoded, ${skipped} already current`)

if (broken.length > 0) {
  console.error(
    `\nCannot build: no WebP for ${broken.join(', ')}.\n` +
      'The pages ask for the WebP first, and a missing one renders a broken\n' +
      'image rather than falling back to the PNG. Fix the encode or remove the\n' +
      'PNG from public/world/.',
  )
  process.exit(1)
}
