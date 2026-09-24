import { expect, test } from '@playwright/test'
import { openAgent, signIn } from './helpers'

/**
 * An agent's picture, everywhere it appears.
 *
 * This exists because two bugs got past a review that said "checked and
 * working", and both were invisible unless you looked at the right screen in
 * the right order.
 *
 * The first: the detail panel drew a plain coloured square rather than the
 * agent's picture, so uploading the renders changed the island and left the
 * panel looking like the upload had failed.
 *
 * The second is the one worth a test forever. The panel keeps one picture
 * element mounted and swaps the agent through it, and the "this file is
 * missing" flag was a bare boolean. Open the one agent with no render, then
 * open any other, and that one showed its initial too - the flag was still set
 * from the previous agent. The roster ships with nine agents and a workspace
 * will routinely have renders for eight of them, so this is the normal path,
 * not an edge case.
 */

/** The panel's picture: the file it is showing, or null when it fell back. */
const shownFile = `(() => {
  const el = document.querySelector('.agent-dock .agentav')
  if (!el) return 'no picture element at all'
  return el.tagName === 'IMG' ? (el.getAttribute('src') ?? '').split('/').pop() : null
})()`

test.describe('an agent always shows its own picture', () => {
  test('every agent, opened one after another', async ({ page }) => {
    await signIn(page)

    const keys = await page.locator('.station').evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.agent).filter(Boolean) as string[],
    )
    expect(keys.length, 'the island has stations to open').toBeGreaterThan(1)

    /*
     * Which agents have a render is a fact about the repo, not something to
     * assume. Ask the server, so this spec keeps working when one is added.
     */
    const withFile: string[] = []
    for (const key of keys) {
      const res = await page.request.get(`/mascots/${key}-256.webp`)
      if (res.ok()) withFile.push(key)
    }
    expect(withFile.length, 'at least one agent has a render to show').toBeGreaterThan(0)

    /*
     * Worst order first: everything that has no file, then everything that
     * does. Any state left behind by a failed load lands on the next agent,
     * which is exactly the bug.
     */
    const order = [...keys.filter((k) => !withFile.includes(k)), ...withFile]

    for (const [i, key] of order.entries()) {
      /*
       * Switch straight from the last agent rather than closing in between.
       * Closing unmounts the panel and hands the next agent a fresh picture
       * element, which is exactly what hides the bug this test is for.
       */
      await openAgent(page, key, { keepOpen: i > 0 })

      if (withFile.includes(key)) {
        await expect
          .poll(() => page.evaluate(shownFile), {
            message: `${key} should show its own picture, not a fallback`,
          })
          .toBe(`${key}-256.webp`)
      } else {
        // No file is not a broken image: it falls back to the initial.
        await expect.poll(() => page.evaluate(shownFile)).toBeNull()
      }
    }
  })

  test('every card on the island wears its own picture, once', async ({ page }) => {
    await signIn(page)
    await page.waitForLoadState('networkidle')

    // Loaded, not merely present: a 404 leaves an <img> in the DOM with a
    // natural width of nothing, which no amount of reading the markup catches.
    const icons = await page.locator('.marker__icon--img').evaluateAll((els) =>
      els.map((el) => {
        const img = el as HTMLImageElement
        return {
          src: (img.getAttribute('src') ?? '').split('/').pop(),
          loaded: img.complete && img.naturalWidth > 0,
          width: Math.round(img.getBoundingClientRect().width),
        }
      }),
    )

    expect(icons.length, 'cards are wearing pictures').toBeGreaterThan(0)
    for (const icon of icons) {
      expect(icon.loaded, `${icon.src} did not load`).toBe(true)
      // The preflight `img { max-width: 100% }` once collapsed a station's
      // picture to zero inside its zero-sized anchor.
      expect(icon.width, `${icon.src} rendered at no width`).toBeGreaterThan(10)
    }

    /*
     * And nowhere else on the island.
     *
     * The render was drawn on the station too for a while, directly under the
     * card that already shows the same face - the same picture twice, about
     * forty pixels apart. The station keeps a light instead, which is
     * invisible at rest.
     */
    const onStations = await page.locator('.station img').count()
    expect(onStations, 'a second copy of the picture is back on the island').toBe(
      icons.length,
    )
    await expect(page.locator('.station__mascot')).toHaveCount(0)
  })

  test('the pictures are cut for the size they are drawn at', async ({ page }) => {
    let bytes = 0
    page.on('response', (r) => {
      if (r.url().includes('/mascots/') && r.status() === 200) {
        bytes += Number(r.headers()['content-length'] ?? 0)
      }
    })

    await signIn(page)
    await page.waitForLoadState('networkidle')

    /*
     * The uploaded masters are about 1.4 MB each and are drawn at 54px. Served
     * raw that was 11 MB on this one screen. This is the guard on that coming
     * back: 1 MB is far above what nine 256px WebPs cost and far below one
     * master.
     */
    expect(bytes, 'the home screen is serving full-size masters again').toBeLessThan(1_000_000)
  })
})
