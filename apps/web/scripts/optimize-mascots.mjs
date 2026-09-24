/**
 * Re-encode the supplied mascot renders at the size they are actually drawn.
 *
 * The uploaded files are the asset of record and are left alone. What ships
 * beside them is a 256px WebP, because the picture is drawn at 54px on the
 * island, 38px in the detail panel and 26px in a list - so 256 covers the
 * largest of those on a 3x phone screen and everything past it is bytes
 * nobody sees.
 *
 * This is not a micro-optimisation. The renders arrived at 1254px and about
 * 1.4 MB each, which is roughly 11 MB the home screen downloaded to draw nine
 * thumbnails. On a local server that alone made the panel picture appear late
 * enough to be reported as not appearing at all - the fallback initial was on
 * screen for the first half-second. Over mobile data it is worse. The same
 * reasoning already applies to the logo, which ships as a 128px WebP cut from
 * the supplied master.
 *
 * SIZE and QUALITY are the owner's call. Raise SIZE if the mascot is ever
 * drawn larger than 85px; there is no other reason to.
 *
 * It runs on every build rather than once by hand, because the alternative is
 * an owner dropping in a new render, seeing the old one on the deployed site,
 * and having no way to tell why. Every file is re-encoded every time: nine
 * small images take about a second, which is not worth an up-to-date check
 * that goes wrong the moment SIZE changes.
 *
 * A file that cannot be encoded is not a build failure, unlike the island art.
 * The difference is the fallback: every place that draws a mascot falls back
 * to the agent's initial when the file 404s, so a bad render costs one picture
 * rather than a broken page. It is reported loudly and the build continues.
 */
import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const DIR = new URL('../public/mascots/', import.meta.url).pathname

/** The owner's call. See the note above before changing these. */
const SIZE = 256
const QUALITY = { quality: 88, effort: 6 }

const kb = (n) => `${Math.round(n / 1024)} KB`

const broken = []
let done = 0
let before = 0
let after = 0

for (const file of await readdir(DIR)) {
  if (!file.endsWith('.png')) continue

  const png = join(DIR, file)
  const webp = png.replace(/\.png$/, `-${SIZE}.webp`)

  try {
    const source = (await stat(png)).size
    const info = await sharp(png)
      // `contain`, not `cover`: a render with the character off-centre must
      // not have its head cropped to make a square.
      .resize(SIZE, SIZE, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .webp(QUALITY)
      .toFile(webp)

    before += source
    after += info.size
    done++
    console.log(`  ${file} -> ${SIZE}px webp  ${kb(source)} -> ${kb(info.size)}`)
  } catch (err) {
    // Leave nothing stale behind - a previous encoding of a different picture
    // is the one outcome worse than no encoding at all.
    console.error(`  ${file}: could not encode - ${err.message}`)
    await unlink(webp).catch(() => undefined)
    broken.push(file)
  }
}

console.log(
  `mascots: ${done} encoded at ${SIZE}px` +
    (done > 0 ? `  ${kb(before)} -> ${kb(after)} in total` : ''),
)

if (broken.length > 0) {
  console.error(
    `\nNo mascot image for ${broken.join(', ')}. Those agents will show their\n` +
      'initial instead, which is the designed fallback - but it is usually a\n' +
      'corrupt upload rather than a decision, so it is worth a look.',
  )
}
