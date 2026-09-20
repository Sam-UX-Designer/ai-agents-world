import { expect, test } from '@playwright/test'
import { signIn, topUp } from './helpers'

/**
 * Can you reach the bottom of every screen?
 *
 * This exists because for a while you could not. `overflow: hidden` on the
 * body was set so Home's island would stand still, and it clipped every
 * screen taller than the window - Pricing laid out 2609px of plans in an
 * 839px phone and the remaining 1770px could not be reached by any means.
 * Screens that scroll inside themselves, like Tools, hid it.
 *
 * None of this looks at how a screen is built. Some scroll the page and some
 * scroll a panel within it, and both are fine; the question a person asks is
 * whether the last thing on the screen can be got to.
 */

const SCREENS = ['/pricing', '/tools', '/history'] as const

/** The last thing laid out on the page, ignoring the scenery and the
 *  furniture that floats over it. */
const LAST_CONTENT = `(() => {
  const els = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.closest('.world')) return false
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false
    return el.clientHeight > 8 && el.getBoundingClientRect().width > 8
  })
  return els[els.length - 1] ?? null
})()`

test.describe('every screen reaches its own bottom', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/api/demo/login')
    await topUp(page)
  })

  for (const path of SCREENS) {
    test(`${path} is not clipped`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('.world')).toBeAttached()
      await page.waitForTimeout(600)

      /*
       * The regression itself, in one line: how far the page can scroll
       * against how far its content runs past the fold. Pricing reported 0
       * and 1770.
       */
      const { room, spill } = await page.evaluate(() => {
        const el = document.scrollingElement!
        return {
          room: Math.round(el.scrollHeight - el.clientHeight),
          spill: Math.round(document.body.scrollHeight - el.clientHeight),
        }
      })
      expect(room, `content runs ${spill}px past the fold`).toBeGreaterThanOrEqual(spill - 1)
    })

    test(`${path} can be scrolled to its last line`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('.world')).toBeAttached()
      await page.waitForTimeout(600)

      // Whatever scrolls - the page or a panel inside it - scrollIntoView
      // walks every scrollable ancestor, which is what a thumb does too.
      const reached = await page.evaluate(`(() => {
        const last = ${LAST_CONTENT}
        if (!last) return { found: false }
        last.scrollIntoView({ block: 'end' })
        const r = last.getBoundingClientRect()
        return {
          found: true,
          tag: last.tagName + '.' + String(last.className).slice(0, 24),
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          within: r.bottom <= innerHeight + 2 && r.top >= -2,
        }
      })()`) as { found: boolean; tag?: string; within?: boolean; top?: number; bottom?: number }

      expect(reached.found, 'the screen has content').toBe(true)
      expect(
        reached.within,
        `last element ${reached.tag} sits at ${reached.top}..${reached.bottom}`,
      ).toBe(true)
    })
  }

  test('the scenery never swallows a scroll', async ({ page }) => {
    /*
     * The island is behind every screen. On Home it is something you move, so
     * it is a scroll container that contains its own overscroll; anywhere
     * else that same container would sit under the whole viewport and eat any
     * gesture landing on it, which is a page that will not scroll.
     */
    for (const path of SCREENS) {
      await page.goto(path)
      await expect(page.locator('.world')).toBeAttached()
      const world = await page.locator('.world').evaluate((el) => ({
        pointer: getComputedStyle(el).pointerEvents,
        scrolls: el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth,
        live: el.classList.contains('world--live'),
      }))
      expect(world.live, `${path} shows the still island`).toBe(false)
      expect(world.pointer, `${path}: scenery takes no touches`).toBe('none')
      expect(world.scrolls, `${path}: scenery is not a scroll container`).toBe(false)
    }
  })

  test('a scroll started over the scenery still moves the page', async ({ page }) => {
    await page.goto('/pricing')
    await expect(page.locator('.plan').first()).toBeVisible()

    const size = page.viewportSize()!
    // Down the left edge, where the panels do not reach and the island is
    // what is under the finger.
    await page.mouse.move(6, Math.round(size.height * 0.5))
    await page.mouse.wheel(0, 500)
    await page.waitForTimeout(400)

    expect(
      await page.evaluate(() => document.scrollingElement!.scrollTop),
      'the page moved',
    ).toBeGreaterThan(0)
  })

  test('Home stands still: the island pans, the page does not', async ({ page }) => {
    await signIn(page)

    const room = await page.evaluate(() => {
      const el = document.scrollingElement!
      return Math.round(el.scrollHeight - el.clientHeight)
    })
    expect(room, 'Home has no page to scroll - everything on it is fixed').toBe(0)
    await expect(page.locator('.world--live')).toBeAttached()
  })
})

test.describe('the way in, before there is a session', () => {
  test('the sign-in screen is not clipped either', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/signin')
    await expect(page.locator('.entry')).toBeVisible()

    const { room, spill } = await page.evaluate(() => {
      const el = document.scrollingElement!
      return {
        room: Math.round(el.scrollHeight - el.clientHeight),
        spill: Math.round(document.body.scrollHeight - el.clientHeight),
      }
    })
    expect(room, `content runs ${spill}px past the fold`).toBeGreaterThanOrEqual(spill - 1)
  })
})
