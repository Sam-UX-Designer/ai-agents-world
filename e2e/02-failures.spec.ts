import { expect, test } from '@playwright/test'
import { TWO_AGENT_GOAL, answerText, ask, balance, signIn, spendDownTo, topUp } from './helpers'

/**
 * What the user is told when it does not work.
 *
 * Launch week is when failures actually happen - a key expires, credits run
 * out, a plan is too big for the plan. Every one of these has to arrive as a
 * sentence someone can act on, never as a stack trace, a SQL statement or a
 * spinner that never stops.
 */

test.describe('failures are legible', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/api/demo/login')
    await topUp(page)
  })

  test('a provider failure is translated, never shown raw', async ({ page }) => {
    await signIn(page)
    // The demo harness throws the provider's real credit-balance error for any
    // goal starting "fail:", so this is the genuine error text going in.
    await ask(page, 'fail: plan a product launch')

    const answer = await answerText(page)
    expect(answer).toMatch(/credits/i)
    expect(answer).toMatch(/console\.anthropic\.com/)

    // None of the provider's own wording, and nothing from a database.
    expect(answer).not.toMatch(/Plans & Billing to upgrade or purchase/)
    expect(answer).not.toMatch(/insert into|select .* from|Failed query|at Object\./i)
  })

  test('a failed run gives the credit back', async ({ page }) => {
    await signIn(page)
    const before = await balance(page)

    await ask(page, 'fail: this will not work')
    await answerText(page)

    const after = await balance(page)
    expect(after.total, 'nothing ran, so nothing is charged').toBe(before.total)
    expect(after.ledger.some((l) => l.reason === 'refund')).toBeTruthy()
  })

  test('the progress card shows the reason, not a frozen 0%', async ({ page }) => {
    await signIn(page)
    await ask(page, 'fail: show me the reason')
    await answerText(page)

    const card = page.locator('.taskcard')
    await expect(card).toHaveAttribute('data-state', 'failed')
    await expect(card).toContainText(/credits/i)
    // A progress bar under a dead run is a claim there is progress.
    await expect(page.locator('.taskcard__pct')).toHaveCount(0)
  })

  test('running out of credits refuses before the model is called', async ({ page }) => {
    await signIn(page)
    await spendDownTo(page, 0)

    const refused = await page.request.post('/api/goals', {
      data: { prompt: 'one too many', timezone: 'UTC' },
    })
    expect(refused.status(), 'payment required, not forbidden - this is "not yet"').toBe(402)

    const body = (await refused.json()) as { error: string; upgrade?: boolean }
    expect(body.error).toMatch(/credits/i)
    expect(body.upgrade).toBe(true)

    // And the screen offers the way out rather than just the bad news.
    await ask(page, 'one too many')
    await expect(page.locator('.command__error')).toContainText(/credits/i)
    await expect(page.locator('.command__upgrade')).toBeVisible()
  })

  test('a plan too big for the plan says so in words', async ({ page }) => {
    await signIn(page)
    const { plan } = await balance(page)
    test.skip(plan.maxAgents > 1, 'only the one-agent plan can hit this cap')

    await ask(page, TWO_AGENT_GOAL)
    const answer = await answerText(page)
    expect(answer).toMatch(/agent/i)
    expect(answer).toMatch(/plan allows|move up a plan|smaller goals/i)
  })
})
