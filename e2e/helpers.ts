import { expect, type Page } from '@playwright/test'

/**
 * Shared steps.
 *
 * Every spec signs in the same way and waits for the same things, and a suite
 * where each file invents its own waits is a suite that goes flaky one file at
 * a time.
 */

/** The demo's own sign-in route: sets the real session cookie the OAuth
 *  callback would set, so everything downstream is the production path. */
export async function signIn(page: Page) {
  await page.goto('/api/demo/login')
  await page.waitForURL('**/world')
  await expect(page.locator('.command__input')).toBeVisible()
  // The roster arrives over the network after the first paint, and the
  // stations are drawn from it - so this is the real "the page is ready"
  // signal rather than a sleep.
  await expect(page.locator('.station').first()).toBeAttached()
}

/** Submit a goal from the command bar. */
export async function ask(page: Page, prompt: string) {
  await page.fill('.command__input', prompt)
  await page.click('.command__send')
}

/** Wait for the run to finish, however it ended, and return what it said. */
export async function answerText(page: Page): Promise<string> {
  await expect(page.locator('.answer')).toBeVisible({ timeout: 80_000 })
  return (await page.locator('.answer').innerText()).replace(/\s+/g, ' ').trim()
}

/** What the wallet says right now, read from the API the UI reads. */
export async function balance(page: Page) {
  const res = await page.request.get('/api/billing')
  expect(res.ok()).toBeTruthy()
  return res.json() as Promise<{
    plan: { key: string; name: string; maxAgents: number }
    freeLeft: number
    credits: number
    total: number
    ledger: { delta: number; reason: string }[]
  }>
}

/**
 * Put credit back in the wallet.
 *
 * Call it before anything that needs to actually run. One spec deliberately
 * spends the balance to nothing to prove the gate works, and without this
 * every spec after it would fail for want of credit rather than for want of
 * correctness - which is a suite whose result depends on file order.
 *
 * The route is demo-only. Production has no way to mint credit from a request.
 */
export async function topUp(page: Page) {
  const res = await page.request.post('/api/demo/credits')
  expect(res.ok(), 'demo credit top-up').toBeTruthy()
  return res.json() as Promise<{ before: number; after: number }>
}

/** Spend the free allowance down to `leave` remaining, without the UI. */
export async function spendDownTo(page: Page, leave: number) {
  let left = (await balance(page)).total
  while (left > leave) {
    const res = await page.request.post('/api/goals', {
      data: { prompt: 'warm up the meter', timezone: 'UTC' },
    })
    expect([202, 402]).toContain(res.status())
    if (res.status() === 402) break
    left = (await balance(page)).total
  }
}

/** A goal the demo routes to exactly one agent, which the free plan allows. */
export const ONE_AGENT_GOAL = 'Create a design system'

/** A goal the demo splits across two agents - more than the free plan allows. */
export const TWO_AGENT_GOAL = 'Organize my schedule'

/**
 * Pan the island sideways by `dx` pixels.
 *
 * The island is a scroll container, so this is a scroll - which is also what a
 * finger does to it. Driving it through the element rather than through
 * synthesised swipes keeps the test about whether panning works rather than
 * about whether Playwright's gesture emulation does.
 */
export async function panIsland(page: Page, dx: number) {
  await page.locator('.world').evaluate((el, d) => {
    el.scrollLeft += d
  }, dx)
  // One frame for the scroll handler to reach React and move the stations.
  await page.waitForTimeout(120)
}

/** Pan up or down the same way. Positive is downward. */
export async function panIslandY(page: Page, dy: number) {
  await page.locator('.world').evaluate((el, d) => {
    el.scrollTop += d
  }, dy)
  await page.waitForTimeout(120)
}

/** How far the island is panned from its left edge, in pixels. */
export async function panOffset(page: Page): Promise<number> {
  return page.locator('.world').evaluate((el) => el.scrollLeft)
}

/** How far down the island has been panned. */
export async function panOffsetY(page: Page): Promise<number> {
  return page.locator('.world').evaluate((el) => el.scrollTop)
}

/** True when there is island off the side of the screen to pan to. */
export async function canPan(page: Page): Promise<boolean> {
  return page.locator('.world').evaluate((el) => el.scrollWidth > el.clientWidth + 1)
}

/** True when there is island above or below the screen to pan to. */
export async function canPanY(page: Page): Promise<boolean> {
  return page.locator('.world').evaluate((el) => el.scrollHeight > el.clientHeight + 1)
}
