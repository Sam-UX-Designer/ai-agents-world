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
 * It also puts the workspace back on the free plan unless a plan is named,
 * for the same reason: one spec upgrades to Pro to watch two agents work, and
 * the demo has a single workspace, so without a reset every spec that runs
 * after it silently tests a different plan from the one it means to.
 *
 * The route is demo-only. Production has no way to mint credit from a request.
 */
export async function topUp(page: Page, plan?: string) {
  const res = await page.request.post(
    plan ? `/api/demo/credits?plan=${plan}` : '/api/demo/credits',
  )
  expect(res.ok(), 'demo credit top-up').toBeTruthy()
  return res.json() as Promise<{ before: number; after: number; plan: string | null }>
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

/**
 * A goal the demo plans across two different departments - Sales, then
 * Marketing. This is what a plan's agent cap is actually about.
 */
export const TWO_AGENT_GOAL = 'Plan a marketing campaign'

/**
 * Two tasks, both for Operations.
 *
 * One agent doing two things, which the free plan sells as allowed and for a
 * while refused: the cap counted tasks while the pricing page counted agents.
 */
export const TWO_TASK_ONE_AGENT_GOAL = 'Organize my schedule'

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

/**
 * Open an agent's panel, whichever agent is actually reachable.
 *
 * Naming one made this a test of where the island happens to be sitting: on a
 * phone the island is wider than the viewport, so any particular agent may be
 * off the edge until someone pans to it. Pass `want` only when the test needs
 * that exact agent back - after a reload, say - and it will sweep to find it.
 *
 * Returns the name shown on the station, which is what the panel should then
 * be showing too.
 */
export async function openAnyAgent(page: Page, want?: string): Promise<string> {
  /*
   * Wait for the roster before reading it.
   *
   * evaluateAll does not auto-wait: it resolves with whatever matches at that
   * instant, and a reload puts this back to an empty island for about a
   * second. Measured rather than guessed - sampling straight after a reload
   * returns [], and 1.5s later returns all nine stations exactly where they
   * were.
   */
  await expect(page.locator('.station').first()).toBeAttached()

  // The island does not scroll the page, it pans - so scrollIntoViewIfNeeded
  // can do nothing for a station that is off the edge. Ask which stations are
  // actually in front of the viewport.
  const reachable = (wanted: string | null) =>
    page.locator('.station').evaluateAll(
      (els, w) =>
        els.findIndex((el) => {
          const r = el.getBoundingClientRect()
          const onScreen = r.x > 8 && r.right < window.innerWidth - 8
          const name = el.querySelector('.marker__label strong')?.textContent?.trim()
          const notHub = el.querySelector('.marker[data-primary="true"]') === null
          return onScreen && notHub && (!w || name === w)
        }),
      wanted,
    )

  /*
   * Pan to one if none is in front of us.
   *
   * A phone shows about a fifth of the island at a time, so which agent you
   * can reach is a function of where the island happens to be sitting - and at
   * the middle, which is where it starts, the answer can be none of them.
   * Sweeping to it is what a person does, so it is what the test does.
   */
  let index = await reachable(want ?? null)
  if (index < 0) {
    const step = Math.round((page.viewportSize()?.width ?? 1440) / 2)
    await panIsland(page, -100_000)
    for (let i = 0; i < 40; i++) {
      index = await reachable(want ?? null)
      if (index >= 0) break
      const before = await panOffset(page)
      await panIsland(page, step)
      if ((await panOffset(page)) === before) break
    }
    if (index < 0) index = await reachable(want ?? null)
  }
  expect(index, 'a station is reachable on this screen').toBeGreaterThanOrEqual(0)

  const station = page.locator('.station').nth(index)
  const name = (await station.locator('.marker__label strong').innerText()).trim()
  await station.locator('.marker').click()
  await expect(page.locator('.agent-dock')).toBeVisible()
  return name
}

/**
 * Open one named agent's panel, bringing the island to it first.
 *
 * `openAnyAgent` takes whichever agent is in front of you, which is right when
 * the test does not care which. This is for when it does - checking every
 * agent in turn, say. On a phone the island is several screens wide, so a
 * station can be off the edge entirely, and `click()` then waits forever on an
 * element that is attached, enabled and simply somewhere else.
 */
export async function openAgent(
  page: Page,
  key: string,
  /**
   * Switch straight from whatever panel is open to this one, without closing
   * it first.
   *
   * This matters more than it looks. Closing unmounts the panel, so the next
   * agent gets a brand-new picture element - which is precisely the path that
   * hides a picture element wrongly reusing state between agents. A test that
   * always closes cannot see that bug; it was written that way once and proved
   * it by passing against the broken code.
   */
  { keepOpen = false }: { keepOpen?: boolean } = {},
): Promise<void> {
  const closeButton = page.locator('.agent-dock button', { hasText: /^close$/i })
  if (!keepOpen && (await closeButton.count())) await closeButton.click()

  const station = page.locator(`.station[data-agent="${key}"]`)
  await expect(station).toBeAttached()

  /**
   * Is this station somewhere a finger could actually land on it?
   *
   * Measured on the card, not on the station anchor. The anchor is a
   * zero-sized point and the card is offset from it - to the left or right
   * depending on which edge of the island it sits near - so an anchor dead in
   * the middle of the screen can still have its card half off the edge, which
   * is a click Playwright waits out rather than performs.
   */
  const reachable = () =>
    station.evaluate((el) => {
      const card = el.querySelector('.marker')
      if (!card) return false
      const r = card.getBoundingClientRect()
      if (r.width === 0) return false
      const inside =
        r.left > 4 && r.right < window.innerWidth - 4 &&
        r.top > 4 && r.bottom < window.innerHeight - 4
      if (!inside) return false
      // An open panel swallows clicks on anything beneath it.
      const dock = document.querySelector('.agent-dock')?.getBoundingClientRect()
      if (!dock) return true
      const overlaps =
        r.left < dock.right + 4 && r.right > dock.left - 4 &&
        r.top < dock.bottom + 4 && r.bottom > dock.top - 4
      return !overlaps
    })

  /**
   * Put this station in the middle of the screen.
   *
   * One move, not a search. The island is a scroll container and the station
   * reports where it currently sits, so the offset that centres it is simple
   * arithmetic. Panning half a screen at a time looking for it took most of a
   * minute per agent on a phone and timed the test out.
   */
  const centre = async () => {
    await page.evaluate((k) => {
      const el = document.querySelector(`.station[data-agent="${k}"]`)
      const world = document.querySelector('.world')
      if (!el || !world) return
      const card = el.querySelector('.marker') ?? el
      const r = card.getBoundingClientRect()
      world.scrollLeft += r.left + r.width / 2 - window.innerWidth / 2
      world.scrollTop += r.top + r.height / 2 - window.innerHeight / 2
    }, key)
    // One frame for the scroll handler to reach React and move the stations.
    await page.waitForTimeout(150)
  }

  if (!(await reachable())) {
    await centre()
    /*
     * Centred and still covered: on a phone the panel is full width, so there
     * is nowhere clear of it - and a person there has to close it to pick
     * another agent too. Closing is the route the product offers at that size.
     */
    if (!(await reachable()) && (await closeButton.count())) {
      await closeButton.click()
      await centre()
    }
    expect(await reachable(), `could not bring ${key} into view`).toBe(true)
  }

  await station.locator('.marker').click()
  await expect(page.locator('.agent-dock')).toBeVisible()
}
