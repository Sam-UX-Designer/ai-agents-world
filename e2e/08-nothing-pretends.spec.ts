import { expect, test } from '@playwright/test'
import { answerText, ask, signIn, topUp } from './helpers'

/**
 * Does the product ever pretend?
 *
 * Every test here is the same question asked of a different surface: is what
 * the screen says backed by something that actually happened. A robot that
 * looks busy, a number on a page, a tool that says it is connected, a plan
 * that offers a button - each either has a fact behind it or it does not.
 *
 * The four suggestions printed on Home get special attention. Offering
 * someone a prompt the product then refuses to run is the plainest form of
 * pretending there is, and it was real: two of the four could not run on the
 * plan a new account starts on.
 */

const SUGGESTIONS = [
  'Plan a product launch',
  'Find insights about our users',
  'Organize my schedule',
  'Create a design system',
] as const

test.describe('nothing on screen is invented', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/api/demo/login')
    await topUp(page)
  })

  for (const prompt of SUGGESTIONS) {
    test(`"${prompt}" either works or says why, and never stalls`, async ({ page }) => {
      await signIn(page)
      await ask(page, prompt)

      // One of two honest endings. Not a spinner that never resolves, and
      // not a tick over work that did not happen.
      const answer = await answerText(page)
      expect(answer.length, 'something came back').toBeGreaterThan(0)

      const failed = await page.locator('.answer__mark[data-tone="bad"]').count()
      if (failed > 0) {
        // A refusal has to name a reason and offer a way forward.
        expect(answer).not.toMatch(/^Could not finish\s*$/i)
        expect(answer.length, 'the refusal explains itself').toBeGreaterThan(30)
        if (/plan allows/i.test(answer)) {
          await expect(
            page.locator('.answer__plans'),
            'a plan-limit refusal offers the plans page',
          ).toBeVisible()
        }
      } else {
        // A success has to be the model's words, not a status line.
        expect(answer).not.toMatch(/undefined|null|\[object|NaN/)
      }
    })
  }

  // The balance and the plan name on screen are checked against the server
  // in 04-screens; not repeated here.

  test('a robot only looks busy while a real run is in flight', async ({ page }) => {
    await signIn(page)

    // Before: nothing claims to be working.
    expect(await page.locator('.marker[data-state="working"]').count()).toBe(0)
    expect(await page.locator('.robot').evaluateAll(
      (els) => els.filter((el) => el.getAnimations().length > 0).length)).toBe(0)

    await ask(page, 'Create a design system')
    await expect(page.locator('.marker[data-state="working"]').first()).toBeVisible({ timeout: 60_000 })

    // Whoever is shown working is shown working by the server, not by a timer.
    const onScreen = await page.locator('.marker[data-state="working"]').evaluateAll((els) =>
      els.map((el) => el.querySelector('.marker__label strong')?.textContent?.trim()))
    expect(onScreen.length, 'someone is working').toBeGreaterThan(0)

    await answerText(page)

    // After: everything stands down. No agent is left looking busy.
    await expect
      .poll(async () => page.locator('.marker[data-state="working"]').count(), { timeout: 20_000 })
      .toBe(0)
  })

  test('the progress card never shows a number it has not earned', async ({ page }) => {
    await signIn(page)
    await ask(page, 'Create a design system')

    await expect(page.locator('.taskcard')).toBeVisible()

    /*
     * Before a plan exists there is no denominator, so there is nothing
     * honest to put in a percentage. The card may say it is reading the goal;
     * it may not say 40%.
     */
    const early = (await page.locator('.taskcard').innerText()).replace(/\s+/g, ' ')
    const percent = early.match(/(\d+)%/)
    if (percent) {
      expect(Number(percent[1]), 'no progress is claimed before a plan exists').toBe(0)
    }

    await answerText(page)
  })

  test('no screen shows a raw database or provider error', async ({ page }) => {
    await signIn(page)
    // The demo makes the provider throw its real credit-balance error.
    await ask(page, 'fail: make the provider throw')

    const answer = await answerText(page)
    expect(answer, 'the user gets a sentence, not a stack trace')
      .not.toMatch(/ECONNREFUSED|PostgresError|drizzle|at Object\.|node_modules|SQLSTATE|\bstack\b/i)
    expect(answer.length).toBeGreaterThan(20)
  })
})
