import { expect, test } from '@playwright/test'

/**
 * The page the main site links to.
 *
 * Its job is narrow: explain the product to someone who arrived knowing only
 * its name, and get them to the door. So the tests are about whether it can
 * be read and whether it leads anywhere, not about how it looks.
 *
 * It is the one screen here that a signed-out stranger sees, so every test
 * runs without a session.
 */

test.describe('the landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/')
  })

  test('says what the product is, above the fold', async ({ page }) => {
    const h1 = page.locator('.lp__herotext h1')
    await expect(h1).toBeVisible()

    /*
     * Two lines, at every width.
     *
     * The headline has a written line break and `text-wrap: balance` was
     * re-breaking the second half, which put it on three lines on a phone and
     * pushed the buttons towards the fold.
     */
    const lines = await h1.evaluate((el) =>
      Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
    expect(lines, 'the headline is two lines').toBe(2)

    // And the way in is reachable without scrolling.
    const cta = page.locator('.lp__cta .lp__btn').first()
    const box = (await cta.boundingBox())!
    const h = page.viewportSize()!.height
    expect(box.y + box.height, 'the first button is above the fold').toBeLessThanOrEqual(h)
  })

  test('the nav is one line and does not overflow', async ({ page }) => {
    const nav = page.locator('.lp__nav')
    const height = (await nav.boundingBox())!.height
    expect(height, 'a nav taller than 80px is eating the view').toBeLessThanOrEqual(80)

    expect(
      await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth),
      'nothing pushes the page sideways',
    ).toBeLessThanOrEqual(1)
  })

  test('every door leads somewhere real', async ({ page }) => {
    // Both buttons in the hero, and the one at the end.
    await expect(page.locator('a[href="/signin"]').first()).toBeVisible()
    await expect(page.locator('a[href="/pricing"]').first()).toBeVisible()

    await page.locator('.lp__cta a[href="/signin"]').click()
    await expect(page.locator('.entry__card')).toBeVisible()

    await page.goto('/')
    await page.locator('.lp__cta a[href="/pricing"]').click()
    await expect(page.locator('.plan').first()).toBeVisible()
  })

  test('it can be read all the way to the end', async ({ page }) => {
    const { room, spill } = await page.evaluate(() => {
      const el = document.scrollingElement!
      return {
        room: Math.round(el.scrollHeight - el.clientHeight),
        spill: Math.round(document.body.scrollHeight - el.clientHeight),
      }
    })
    expect(room, `content runs ${spill}px past the fold`).toBeGreaterThanOrEqual(spill - 1)

    await page.evaluate(() => document.scrollingElement!.scrollTo(0, 1e6))
    await page.waitForTimeout(300)
    await expect(page.locator('.lp__start a[href="/signin"]')).toBeInViewport()
  })

  test('the sections arrive, and then stay put', async ({ page }) => {
    /*
     * Reveal-on-scroll is the page's only motion, and the failure mode worth
     * testing is the one that loses content: a section that never becomes
     * visible because the observer never fired.
     */
    await page.evaluate(async () => {
      const el = document.scrollingElement!
      for (let y = 0; y < el.scrollHeight; y += 400) {
        el.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 60))
      }
    })
    await page.waitForTimeout(900)

    const hidden = await page.locator('.reveal').evaluateAll(
      (els) => els.filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length)
    expect(hidden, 'every section arrived').toBe(0)
  })

  test('the artwork is the real one, and it loaded', async ({ page }) => {
    // The hero is the supplied render, not a gradient standing in for it.
    const ok = await page.locator('.lp__heroimg').evaluate(
      (el: HTMLImageElement) => el.complete && el.naturalWidth > 0)
    expect(ok, 'the island rendered').toBe(true)
  })
})
