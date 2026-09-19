/**
 * Re-encode the supplied artwork as WebP, at build time.
 *
 * The island renders are PNGs of photographic 3D output, which is the one
 * thing PNG is bad at - the hero alone is 3 MB, and it is the first paint on
 * the landing page. WebP carries the same picture in a fraction of it.
 *
 * QUALITY is the owner's decision, not the build's. It sits at 95 because the
 * owner compared a 2x crop of the most detailed part of the artwork against
 * the original and against lossless, and could not tell them apart. That buys
 * roughly 6x over the PNG where lossless bought 1.3x. If the artwork is ever
 * replaced with something that suffers at 95 - flat gradients and hard edges
 * are where WebP shows its teeth, not foliage and water - raise it here, or
 * set `lossless: true` and take the 1.3x.
 *
 * It runs on every build rather than once by hand, because the alternative is
 * an owner replacing a PNG, seeing the old image on the deployed site, and
 * having no way to tell why.
 *
 * Every PNG is re-encoded every time, with no up-to-date check. The check this
 * replaced compared file timestamps, which is right up until QUALITY changes -
 * then every file looks current, nothing is re-encoded, and the setting has
 * silently done nothing. Three images take about two seconds. That is not
 * worth a class of bug.
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

/** The owner's call. See the note above before changing it. */
const QUALITY = { quality: 95, effort: 6 }

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`

const broken = []
let done = 0

for (const file of await readdir(DIR)) {
  if (!file.endsWith('.png')) continue

  const png = join(DIR, file)
  const webp = png.replace(/\.png$/, '.webp')

  try {
    const before = (await stat(png)).size
    const info = await sharp(png).webp(QUALITY).toFile(webp)
    console.log(
      `  ${file} -> .webp  ${mb(before)} -> ${mb(info.size)}  ` +
        `(${Math.round(100 - (info.size * 100) / before)}% smaller)`,
    )
    done++
  } catch (err) {
    // Leave nothing stale behind - a previous encoding of a different picture
    // is the one outcome worse than no encoding at all.
    console.error(`  ${file}: could not encode WebP - ${err.message}`)
    await unlink(webp).catch(() => undefined)
    broken.push(file)
  }
}

console.log(`world art: ${done} encoded at quality ${QUALITY.quality ?? 'lossless'}`)

if (broken.length > 0) {
  console.error(
    `\nCannot build: no WebP for ${broken.join(', ')}.\n` +
      'The pages ask for the WebP first, and a missing one renders a broken\n' +
      'image rather than falling back to the PNG. Fix the encode or remove the\n' +
      'PNG from public/world/.',
  )
  process.exit(1)
}
