import { expect, test } from '@playwright/test'
import { ONE_AGENT_GOAL, ask, signIn, topUp } from './helpers'

/**
 * What the island says while a goal is being worked.
 *
 * The product's rule is that the world never invents state: a bolt leaves the
 * hub because the Orchestrator really did hand that task over, and a station
 * pings because that agent really is in an active state. These tests are
 * mostly about the second half of that sentence - they check that nothing
 * animates on an idle island, which is the half a decorative implementation
 * would quietly get wrong.
 */

test.describe('the island reports the run', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/api/demo/login')
    await topUp(page)
  })

  test('nothing is lit before a goal is given', async ({ page }) => {
    await signIn(page)

    await expect(page.locator('.routes__bolt')).toHaveCount(0)
    await expect(page.locator('.station__ping')).toHaveCount(0)
    await expect(page.locator('.routes__live')).toHaveCount(0)
  })

  test('a bolt leaves the hub for the agent that was chosen, and clears', async ({ page }) => {
    await signIn(page)
    await ask(page, ONE_AGENT_GOAL)

    // The dispatch. Three strokes over one path, so one bolt is three nodes.
    const bolt = page.locator('.routes__bolt').first()
    await expect(bolt).toBeAttached({ timeout: 60_000 })

    // It starts at the hub and ends on a station - not a decorative squiggle
    // somewhere over the sea. Both ends are read off the path itself.
    const ends = await bolt.evaluate((el) => {
      const d = el.getAttribute('d') ?? ''
      const points = [...d.matchAll(/-?\d+(?:\.\d+)?\s-?\d+(?:\.\d+)?/g)].map((m) =>
        m[0].split(/\s+/).map(Number),
      )
      return { first: points[0]!, last: points[points.length - 1]!, count: points.length }
    })
    // Kinked, not straight: a bolt has interior points that a line does not.
    expect(ends.count).toBeGreaterThan(2)
    expect(Math.hypot(ends.last[0]! - ends.first[0]!, ends.last[1]! - ends.first[1]!)).toBeGreaterThan(20)

    // And it is a one-off. A dispatch that stayed on screen would read as a
    // permanent wire between two places.
    await expect(page.locator('.routes__bolt')).toHaveCount(0, { timeout: 15_000 })
  })

  test('the station of a working agent pings, and only that one', async ({ page }) => {
    await signIn(page)
    const stations = await page.locator('.station').count()
    expect(stations).toBeGreaterThan(1)

    await ask(page, ONE_AGENT_GOAL)
    await expect(page.locator('.marker[data-state="working"]')).toBeVisible({ timeout: 60_000 })

    // Two rings per working station, on a stagger.
    const pings = page.locator('.station__ping')
    expect(await pings.count()).toBeGreaterThan(0)
    // Nowhere near every station: the island shows routing, not broadcasting.
    expect(await pings.count()).toBeLessThan(stations * 2)

    // The ring is genuinely moving, not just present.
    const ring = pings.first()
    const a = await ring.evaluate((el) => getComputedStyle(el).transform)
    await page.waitForTimeout(500)
    const b = await ring.evaluate((el) => getComputedStyle(el).transform)
    expect(a).not.toBe(b)
  })

  test('the island goes quiet once the answer is back', async ({ page }) => {
    await signIn(page)
    await ask(page, ONE_AGENT_GOAL)

    await expect(page.locator('.answer')).toBeVisible({ timeout: 80_000 })

    // Every moving thing stands down together. A station still pinging after
    // the answer arrived would be the world inventing a run that ended.
    await expect(page.locator('.station__ping')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.locator('.routes__live')).toHaveCount(0)
    await expect(page.locator('.orb[data-running="true"]')).toHaveCount(0)
  })
})
