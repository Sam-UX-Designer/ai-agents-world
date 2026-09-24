import { expect, test } from '@playwright/test'
import {
  ONE_AGENT_GOAL, answerText, ask, balance, panIsland, panOffset, signIn,
} from './helpers'

/**
 * The screens either side of the loop: who is signed in, what a run cost, what
 * the agents were told, and what the product charges for.
 */

test.describe('the way in', () => {
  test('one screen, both doors, and no theme toggle', async ({ page }) => {
    for (const path of ['/', '/signin']) {
      await page.goto(path)
      await expect(page.locator('.entry__headline')).toContainText('Your AI workforce')
      await expect(page.locator('.entry__card')).toBeVisible()
      // The pitch and the form are on the same screen: no Get started step.
      await expect(page.locator('.entry__points li')).toHaveCount(3)
      await expect(page.locator('.auth__theme, .entry__theme')).toHaveCount(0)
    }
  })

  test('a phone number in the email field is refused, in words', async ({ page }) => {
    await page.goto('/signin')
    await page.fill('.entry__input input[inputmode="email"]', '9876543210')
    await page.fill('.entry__input input[type="password"]', 'whatever123')
    await page.click('.entry__submit')

    await expect(page.locator('.entry__fielderror')).toContainText('valid email address')
    // Ours, in the form - not the browser's native bubble over the next field.
    await expect(page.locator('.entry__input[data-invalid="true"]')).toBeVisible()
  })

  test('the password can be revealed', async ({ page }) => {
    await page.goto('/signin')
    const field = page.locator('.entry__input input[type="password"]')
    await field.fill('secret12345')
    await page.click('.entry__peek')
    await expect(page.locator('.entry__input input[type="text"][autocomplete*="password"]')).toBeVisible()
  })

  test('the real logo is on screen, not a placeholder', async ({ page }) => {
    await page.goto('/signin')
    const mark = page.locator('.entry__mark')
    await expect(mark).toHaveAttribute('src', /brand\/logo/)
    // The placeholder was an inline SVG triangle drawn in the component.
    await expect(page.locator('.entry__mark svg')).toHaveCount(0)

    const icon = await page.request.get('/icon.png')
    expect(icon.status(), 'the favicon actually serves').toBe(200)
  })
})

test.describe('account and billing', () => {
  test('the account menu reports the plan the server says', async ({ page }) => {
    await signIn(page)
    const { plan, total } = await balance(page)

    await page.locator('.topright button').last().click()
    await expect(page.locator('.wallet')).toBeVisible()
    await expect(page.locator('.pop__who em')).toContainText(plan.name)
    await expect(page.locator('.wallet__count')).toContainText(String(total))
    // Counted in credits, not in goals - "goal" is what you type.
    await expect(page.locator('.wallet__count')).toContainText(/credit/)
  })

  test('the pricing page offers four plans and takes no money', async ({ page }) => {
    await page.goto('/pricing')
    await expect(page.locator('.plan')).toHaveCount(4)
    await expect(page.locator('.plan[data-highlight="true"]')).toHaveCount(1)

    // Yearly is cheaper per month than monthly, or the toggle is a lie.
    const monthly = await page.locator('.plan__price strong').allInnerTexts()
    await page.locator('.pricing__toggle button').nth(1).click()
    const yearly = await page.locator('.plan__price strong').allInnerTexts()
    expect(yearly).not.toEqual(monthly)

    // Nothing here can charge anyone, and it says so rather than opening a
    // checkout that cannot complete.
    await page.locator('.plan[data-highlight="true"] button.btn').click()
    await expect(page.locator('.pricing__note')).toContainText(/not open yet/i)
    await expect(page.locator('input[autocomplete*="cc-"], input[name*="card" i]')).toHaveCount(0)
  })
})

test.describe('agent instructions', () => {
  test('instructions save and survive a reload', async ({ page }) => {
    await signIn(page)

    /*
     * Whichever station is on screen, not a named one.
     *
     * On a phone the island is wider than the viewport, so any particular
     * agent may be off the edge until someone pans to it. Naming one made
     * this test a test of where the island happens to sit.
     */
    const open = async (want?: string) => {
      /*
       * Wait for the roster before reading it.
       *
       * evaluateAll does not auto-wait: it resolves with whatever matches at
       * that instant, and the page.reload() below puts this back to an empty
       * island for about a second. Measured rather than guessed - sampling
       * straight after a reload returns [], and 1.5s later returns all nine
       * stations exactly where they were.
       */
      await expect(page.locator('.station').first()).toBeAttached()

      // The island does not scroll the page, it pans - so
      // scrollIntoViewIfNeeded can do nothing for a station that is off the
      // edge. Ask which stations are actually in front of the viewport.
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
       * A phone shows about a fifth of the island at a time, so which agent
       * you can reach is a function of where the island happens to be sitting
       * - and at the middle, which is where it starts, the answer can be none
       * of them. Sweeping to it is what a person does, so it is what the test
       * does. Same walk as the reachability test in 03-mobile.
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

    const agent = await open()
    const note = `Always answer in British English. ${Date.now()}`
    await page.locator('.agent-dock textarea').fill(note)
    await page.locator('.agent-dock button', { hasText: /save/i }).click()
    await expect(page.locator('.agent-dock')).toContainText(/saved/i)

    // It is on the server, not just in this tab.
    const stored = await page.request.get('/api/agents/instructions')
    expect(JSON.stringify(await stored.json()), `${agent}'s note reached the API`).toContain(note)

    await page.reload()
    const again = await open(agent)
    expect(again).toBe(agent)
    await expect(page.locator('.agent-dock textarea')).toHaveValue(note)
  })
})

test.describe('tools', () => {
  test('nothing claims to be connected that is not', async ({ page }) => {
    await signIn(page)
    await page.goto('/tools')

    /*
     * The server's contract, not a guess at it. An integration is connected
     * when it carries a `connection` - a real token for a real account.
     * `status` is a different question: whether the deployment has the
     * credentials to offer it at all.
     *
     * This is the product's own rule as a test: never show an integration as
     * connected when no real OAuth exists behind it.
     */
    const api = await page.request.get('/api/integrations')
    expect(api.ok()).toBeTruthy()
    const tools = (await api.json()) as {
      name: string
      status: 'available' | 'blocked' | 'planned'
      connection: { accountLabel: string } | null
    }[]

    expect(tools.length, 'the catalogue is not empty').toBeGreaterThan(0)

    let checked = 0
    for (const t of tools) {
      const card = page.getByRole('button', { name: new RegExp(t.name, 'i') }).first()
      if ((await card.count()) === 0) continue
      const text = (await card.innerText()).toLowerCase()
      const claims = text.includes('connected')
      expect(claims, `${t.name}: the screen and the server disagree`).toBe(t.connection !== null)
      checked++
    }
    expect(checked, 'at least some cards were actually compared').toBeGreaterThan(0)

    // A blocked integration must not offer a Connect button that cannot work.
    for (const t of tools.filter((x) => x.status === 'blocked')) {
      const card = page.getByRole('button', { name: new RegExp(t.name, 'i') }).first()
      if ((await card.count()) === 0) continue
      expect((await card.innerText()).toLowerCase()).not.toMatch(/^connect$/)
    }
  })
})
