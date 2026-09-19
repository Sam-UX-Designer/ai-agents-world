import { expect, test } from '@playwright/test'
import { ONE_AGENT_GOAL, answerText, ask, balance, signIn, topUp } from './helpers'

/**
 * The loop the whole product is: a prompt in, an answer out.
 *
 * If only one file in this suite survives, it should be this one. Everything
 * else is a detail of a product that does this.
 */

test.describe('a prompt reaches the model and the answer comes back', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/api/demo/login')
    await topUp(page)
  })

  test('the goal is planned, dispatched, worked and answered', async ({ page }) => {
    await signIn(page)
    await ask(page, ONE_AGENT_GOAL)

    // 1. The Orchestrator takes it and says so, before anything else happens.
    await expect(page.locator('.taskcard')).toBeVisible()
    await expect(page.locator('.taskcard')).toContainText(ONE_AGENT_GOAL)

    // 2. A plan exists, which means the model was called and answered. Until
    //    this point the percentage has no denominator, and the card must not
    //    invent one.
    await expect(page.locator('.marker[data-state="working"]')).toBeVisible({ timeout: 60_000 })

    // 3. The answer arrives, and it is the model's words - not a status, not a
    //    placeholder. The demo's stub returns a known sentence so this can
    //    assert the text itself rather than "something appeared".
    const answer = await answerText(page)
    expect(answer).toContain('Done')
    expect(answer).not.toMatch(/undefined|null|\[object/)

    // 4. And it landed where the user typed, not off in a panel.
    const card = await page.locator('.answer').boundingBox()
    const command = await page.locator('.command').boundingBox()
    expect(card!.y + card!.height).toBeLessThanOrEqual(command!.y + 2)
  })

  test('the world reports the run and then stops reporting it', async ({ page }) => {
    await signIn(page)

    // Nothing moves on an idle island. This is the product's own rule: a robot
    // looks busy because a run is in flight, never because a timer said so.
    await expect(page.locator('.orb[data-running="true"]')).toHaveCount(0)
    await expect(page.locator('.marker[data-state="working"]')).toHaveCount(0)

    await ask(page, ONE_AGENT_GOAL)
    await expect(page.locator('.orb[data-running="true"]')).toHaveCount(1)

    const working = page.locator('.marker[data-state="working"]').first()
    await expect(working).toBeVisible({ timeout: 60_000 })

    // The card is genuinely moving, not merely styled as busy.
    const a = await working.evaluate((el) => getComputedStyle(el).transform)
    await page.waitForTimeout(700)
    const b = await working.evaluate((el) => getComputedStyle(el).transform)
    expect(a).not.toBe(b)

    await answerText(page)
    await expect(page.locator('.orb[data-running="true"]')).toHaveCount(0)
    await expect(page.locator('.marker[data-state="working"]')).toHaveCount(0)
  })

  test('the run is written to History with its answer', async ({ page }) => {
    await signIn(page)
    await ask(page, ONE_AGENT_GOAL)
    const answer = await answerText(page)

    await page.goto('/history')
    const rows = page.locator('.hist__row:not(.hist__row--skeleton)')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    await expect(rows.filter({ hasText: ONE_AGENT_GOAL }).first()).toBeVisible()

    // The answer the screen showed is the answer that was stored - not a
    // second, different summary written by the history endpoint.
    const stored = await page.request.get('/api/history')
    const stored_rows = (await stored.json()) as { prompt: string; summary: string | null }[]
    const mine = stored_rows.find((r) => r.prompt === ONE_AGENT_GOAL)
    expect(mine, 'the goal is in History').toBeTruthy()
    expect(answer).toContain((mine!.summary ?? '').split('\n')[0]!.trim().slice(0, 20))
  })

  test('one credit is taken, once, and recorded', async ({ page }) => {
    await signIn(page)
    const before = await balance(page)

    await ask(page, ONE_AGENT_GOAL)
    await answerText(page)

    const after = await balance(page)
    expect(after.total, 'exactly one credit for one goal').toBe(before.total - 1)

    // And there is a line in the ledger saying so, which is what answers a
    // billing dispute six months from now.
    const spends = after.ledger.filter((l) => l.reason === 'free_goal' || l.reason === 'paid_goal')
    expect(spends.length).toBeGreaterThan(0)
  })
})
