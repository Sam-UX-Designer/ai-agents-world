import { expect, test } from '@playwright/test'
import { ONE_AGENT_GOAL, answerText, ask, canPan, panIsland, panOffset, signIn, topUp } from './helpers'

/**
 * The phone, which is where this product is actually going to be opened.
 *
 * The island is 16:9 and cover-fitted, so held upright a phone crops away
 * roughly three quarters of it. Everything here is about that: can you reach
 * the whole island, and does anything land on top of anything else at the
 * bottom of a 390px screen.
 */

test.describe('phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/api/demo/login')
    await topUp(page)
  })

  test.skip(({ isMobile }) => !isMobile, 'phone project only')

  test('the island can be panned left and right', async ({ page }) => {
    await signIn(page)

    expect(await canPan(page), 'there is island off the side of the screen').toBe(true)
    await expect(page.locator('.world')).toHaveAttribute('data-pannable', 'true')

    const centre = await panOffset(page)
    expect(centre, 'starts in the middle, where cover-fit would have put it').toBeGreaterThan(0)

    await panIsland(page, -centre)
    expect(await panOffset(page), 'reaches the left edge').toBeLessThan(2)

    await panIsland(page, 100_000)
    const right = await panOffset(page)
    expect(right, 'reaches the right edge').toBeGreaterThan(centre)

    // And stops there rather than scrolling into empty space beyond the art.
    await panIsland(page, 500)
    expect(await panOffset(page), 'does not pan past the island').toBe(right)
  })

  test('the stations travel with the island, not over it', async ({ page }) => {
    await signIn(page)

    // A station is a point on the artwork. If the picture moves and the label
    // does not, every agent is suddenly standing somewhere it is not.
    const station = page.locator('.station').first()
    const before = (await station.boundingBox())!

    await panIsland(page, -140)

    const after = (await station.boundingBox())!
    expect(after.x - before.x, 'the station moved exactly as far as the island')
      .toBeGreaterThan(134)
    expect(after.x - before.x).toBeLessThan(146)
  })

  test('panning reaches the stations that start off screen', async ({ page }) => {
    await signIn(page)

    const visible = async () =>
      page.locator('.station').evaluateAll((els) =>
        els
          .filter((el) => {
            const r = el.getBoundingClientRect()
            return r.x > -20 && r.x < window.innerWidth + 20
          })
          .map((el) => el.querySelector('.marker__label strong')?.textContent ?? '?'),
      )

    const total = await page.locator('.station').count()
    const seen = new Set(await visible())

    // The point of the feature: some of the island starts off screen. If it
    // all fits there is nothing here to prove.
    test.skip(seen.size === total, 'the whole island already fits on this screen')

    /*
     * Sweep, rather than sampling three positions.
     *
     * Checking only the left edge, the middle and the right edge missed two
     * stations that sit in the gaps between those views - and reported them as
     * unreachable when they are simply somewhere else. Half a screen at a time
     * guarantees every part of the island is looked at.
     */
    const step = Math.round(page.viewportSize()!.width / 2)
    await panIsland(page, -100_000)
    for (let x = 0; x < 40; x++) {
      for (const n of await visible()) seen.add(n)
      const before = await panOffset(page)
      await panIsland(page, step)
      if ((await panOffset(page)) === before) break
    }
    for (const n of await visible()) seen.add(n)

    expect(seen.size, `reached ${[...seen].sort().join(', ')} of ${total}`).toBe(total)
  })

  test('nothing overlaps at the bottom of the screen', async ({ page }) => {
    await signIn(page)
    await ask(page, ONE_AGENT_GOAL)
    await answerText(page)

    const card = (await page.locator('.taskcard').boundingBox())!
    const answer = (await page.locator('.answer').boundingBox())!
    const command = (await page.locator('.command').boundingBox())!
    const nav = (await page.locator('.sidenav').boundingBox())!

    expect(card.y + card.height, 'card above answer').toBeLessThanOrEqual(answer.y + 1)
    expect(answer.y + answer.height, 'answer above input').toBeLessThanOrEqual(command.y + 1)
    expect(command.y + command.height, 'input above nav').toBeLessThanOrEqual(nav.y + 1)
  })

  test('no screen scrolls sideways by accident', async ({ page }) => {
    await signIn(page)
    for (const path of ['/world', '/tools', '/history', '/pricing', '/signin']) {
      await page.goto(path)
      await page.waitForTimeout(700)
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      )
      expect(overflows, `${path} overflows horizontally`).toBe(false)
    }
  })

  test('the bottom navigation reaches every screen', async ({ page }) => {
    await signIn(page)
    for (const [label, path] of [['Tools', '/tools'], ['History', '/history'], ['Home', '/world']]) {
      await page.locator('.sidenav__item', { hasText: label }).click()
      await page.waitForURL(`**${path}`)
      await expect(page.locator('.sidenav__item[data-active="true"]')).toContainText(label!)
    }
  })
})
