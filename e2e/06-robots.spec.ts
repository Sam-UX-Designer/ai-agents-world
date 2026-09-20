import { expect, test } from '@playwright/test'
import { signIn, topUp } from './helpers'

/**
 * The robots that move without being uploaded.
 *
 * Each one is a box of the island artwork drawn back over itself, so it is
 * pixel-identical to the picture until its agent starts working. Two things
 * matter and both are easy to get wrong: that the box is invisible at rest,
 * and that it moves for the agent it belongs to and for no other.
 */

test.describe('robots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/api/demo/login')
    await topUp(page)
  })

  test('a still island has nothing moving on it', async ({ page }) => {
    await signIn(page)

    // The patches exist from the first paint - they are part of the picture.
    const robots = page.locator('.robot')
    expect(await robots.count(), 'the artwork has robots to move').toBeGreaterThan(0)

    // And not one of them is animating, because nothing is running.
    const running = await robots.evaluateAll((els) =>
      els.filter((el) => el.getAnimations().length > 0).length)
    expect(running, 'no robot moves on an idle island').toBe(0)
  })

  test('a robot sits exactly on the artwork until it is asked to move', async ({ page }) => {
    await signIn(page)

    /*
     * The patch fills itself with the same image, scaled to the same size and
     * offset to line up - so its own top-left has to be the negative of where
     * it sits. Half a pixel out and the island wears an outline around every
     * robot, which is what happened before the rounding went in.
     */
    const aligned = await page.locator('.robot').evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el)
        const [bx, by] = cs.backgroundPosition.split(' ').map(parseFloat)
        return {
          left: parseFloat(cs.left), top: parseFloat(cs.top),
          bx, by,
          whole: Number.isInteger(parseFloat(cs.left)) && Number.isInteger(parseFloat(cs.top)),
        }
      }))

    for (const r of aligned) {
      expect(r.bx, 'background pulled back by exactly its own offset').toBe(-r.left)
      expect(r.by).toBe(-r.top)
      expect(r.whole, 'sits on whole pixels').toBe(true)
    }
  })

  test('the robot of a working agent moves, and only that one', async ({ page }) => {
    // A plan big enough to put real agents to work. The free plan allows one
    // task per goal, which the refusal spec covers.
    await topUp(page, 'pro')
    await signIn(page)

    await page.fill('.command__input', 'Plan a marketing campaign')
    await page.click('.command__send')

    const working = page.locator('.marker[data-state="working"]')
    await expect(working.first()).toBeVisible({ timeout: 60_000 })

    // Some robot is moving now.
    await expect
      .poll(async () => page.locator('.robot').evaluateAll(
        (els) => els.filter((el) => el.getAnimations().length > 0).length),
        { timeout: 20_000 })
      .toBeGreaterThan(0)

    // But not all of them: the island shows who was chosen, not everyone.
    const total = await page.locator('.robot').count()
    const moving = await page.locator('.robot').evaluateAll(
      (els) => els.filter((el) => el.getAnimations().length > 0).length)
    expect(moving, 'idle agents stand still').toBeLessThan(total)

    // The one that moves is genuinely moving, not merely marked as busy.
    const busy = page.locator('.robot[data-state="working"]').first()
    const a = await busy.evaluate((el) => getComputedStyle(el).transform)
    await page.waitForTimeout(450)
    const b = await busy.evaluate((el) => getComputedStyle(el).transform)
    expect(a).not.toBe(b)
  })

  test('the island stands still again once the answer is back', async ({ page }) => {
    await topUp(page, 'pro')
    await signIn(page)

    await page.fill('.command__input', 'Plan a marketing campaign')
    await page.click('.command__send')
    await expect(page.locator('.answer')).toBeVisible({ timeout: 90_000 })

    await expect
      .poll(async () => page.locator('.robot').evaluateAll(
        (els) => els.filter((el) => el.getAnimations().length > 0).length),
        { timeout: 20_000 })
      .toBe(0)
  })
})
