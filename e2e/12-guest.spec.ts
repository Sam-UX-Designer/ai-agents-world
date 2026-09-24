import { expect, test } from '@playwright/test'
import { openAnyAgent, signIn } from './helpers'

/**
 * Walking in without an account.
 *
 * Someone handed a link to this product used to meet a password box before
 * they had seen a single thing it does. Now the door opens onto the island,
 * they can read every screen, and the form waits until they try to make
 * something happen.
 *
 * Two things have to be true at once and they pull against each other. A
 * guest must be able to see enough to decide - so nothing is hidden behind
 * the account. And nothing shown may be invented - no connected tool, no
 * account, no history that does not exist. Both are asserted here.
 */

test.describe('a guest', () => {
  test('the front door opens onto the product, not a form', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/world$/)
    await expect(page.locator('.command__input')).toBeVisible()
    await expect(page.locator('.station').first()).toBeAttached()
    // The form is somewhere, just not in the way.
    await expect(page.locator('.entry__card')).toHaveCount(0)
  })

  test('can reach every screen, and none of them shows an error', async ({ page }) => {
    for (const path of ['/world', '/tools', '/history']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.sidenav')).toBeVisible()
      /*
       * The red line a signed-out visitor used to get across Tools and
       * History, because the screens asked for data an account owns.
       *
       * Named elements rather than [role="alert"]: Next keeps a permanently
       * mounted, empty, visually hidden announcer with that role on every
       * page, so the broad selector matched one thing on every screen and
       * said nothing about ours.
       */
      await expect(page.locator('.tools__error, .command__error, .instr__error')).toHaveCount(0)
    }
  })

  test('nothing pretends there is an account behind it', async ({ page }) => {
    await page.goto('/world')
    await page.waitForLoadState('networkidle')

    // The avatar used to read "S" - an initial belonging to nobody, on a menu
    // about an account that does not exist.
    await expect(page.locator('.iconbtn--avatar')).toHaveCount(0)
    await expect(page.locator('.chrome__signin')).toBeVisible()
    await expect(page.locator('.profile')).toHaveCount(0)

    await page.goto('/tools')
    await page.waitForLoadState('networkidle')
    // The catalogue is readable, and every one of it is disconnected.
    await expect(page.locator('.toolcard').first()).toBeVisible()
    const connected = await page.locator('.toolcard').evaluateAll((els) =>
      els.filter((el) => /connected/i.test(el.textContent ?? '')).length,
    )
    expect(connected, 'a guest was shown a connected tool').toBe(0)

    await page.goto('/history')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.tools__empty')).toContainText(/every run is kept here/i)
    await expect(page.locator('.hist__row')).toHaveCount(0)
  })

  test('sending a goal raises the sign-in gate, and starts nothing', async ({ page }) => {
    const started: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/goals')) started.push(r.url())
    })

    await page.goto('/world')
    await page.fill('.command__input', 'Plan a product launch')
    await page.click('.command__send')

    await expect(page.locator('.gate')).toBeVisible()
    await expect(page.locator('.gate__title')).toContainText(/sign in to send this/i)
    expect(started, 'a guest started a real run').toHaveLength(0)
  })

  test('the gate can be dismissed, and leaves them on the product', async ({ page }) => {
    await page.goto('/world')
    await page.fill('.command__input', 'Plan a product launch')
    await page.click('.command__send')
    await expect(page.locator('.gate')).toBeVisible()

    await page.click('.gate__back')
    await expect(page.locator('.gate')).toHaveCount(0)
    await expect(page).toHaveURL(/\/world$/)
    // Still theirs to send once they do have an account.
    await expect(page.locator('.command__input')).toHaveValue('Plan a product launch')
  })

  test('what they typed is waiting for them after signing in', async ({ page }) => {
    const goal = `Find insights about our users ${Date.now().toString().slice(-4)}`

    await page.goto('/world')
    await page.fill('.command__input', goal)
    await page.click('.command__send')
    await expect(page.locator('.gate')).toBeVisible()

    /*
     * The demo's own sign-in, which sets the same cookie the real callback
     * sets. What matters here is the handover, not which door was used: the
     * sentence they wrote once should not have to be written again.
     */
    await signIn(page)
    await expect(page.locator('.command__input')).toHaveValue(goal)
  })

  test('renaming an agent asks for an account rather than failing', async ({ page }) => {
    await page.goto('/world')
    await openAnyAgent(page)

    await page.locator('.rename__name').click()
    await page.locator('.rename__input').fill('Muse')
    await page.locator('.rename__save').click()

    await expect(page.locator('.gate')).toBeVisible()
    await expect(page.locator('.gate__title')).toContainText(/name/i)
  })

  test('asking for a tool asks for an account rather than failing', async ({ page }) => {
    await page.goto('/tools')
    await page.waitForLoadState('networkidle')

    /*
     * Requesting a tool rather than connecting one, because connecting needs
     * OAuth credentials this deployment does not have - every tool reads
     * "Not available yet" and its button is disabled, for everyone. Requesting
     * is the action on this screen a guest can actually reach, and it runs
     * through the same gate.
     */
    await page.locator('button', { hasText: /request a tool/i }).first().click()

    await expect(page.locator('.gate')).toBeVisible()
    await expect(page.locator('.gate__title')).toContainText(/ask for a tool/i)
    // And the request form never opened behind it.
    await expect(page.locator('.reqtool, form[aria-label*="request" i]')).toHaveCount(0)
  })

  test('connecting a tool asks for an account, where connecting is possible', async ({ page }) => {
    await page.goto('/tools')
    await page.waitForLoadState('networkidle')
    await page.locator('.toolcard').first().click()

    // Scoped to the open detail panel. Unscoped, `/^connect/i` also matches
    // the "Connect my Gmail" suggestion pill in the command bar, which only
    // fills the input and proves nothing.
    const connect = page.locator('.detail button', { hasText: /^connect/i }).first()
    // Nothing connectable without OAuth credentials, which is a legitimate
    // deployment rather than this test's subject.
    test.skip((await connect.count()) === 0, 'no connectable tool in this environment')

    await connect.click()
    await expect(page.locator('.gate')).toBeVisible()
  })
})

test.describe('signing in still works the way it did', () => {
  test('a member sees their account, not the guest chrome', async ({ page }) => {
    await signIn(page)

    await expect(page.locator('.chrome__signin')).toHaveCount(0)
    await expect(page.locator('.iconbtn--avatar')).toBeVisible()
    // And no gate anywhere near them.
    await expect(page.locator('.gate')).toHaveCount(0)
  })

  test('a member can still send a goal', async ({ page }) => {
    await signIn(page)
    await page.request.post('/api/demo/credits')

    await page.fill('.command__input', 'Create a design system')
    await page.click('.command__send')

    await expect(page.locator('.gate')).toHaveCount(0)
    // The world starts reporting it, which only happens for a real run.
    await expect(page.locator('.taskcard, .marker[data-state="working"]').first()).toBeVisible({
      timeout: 60_000,
    })
  })
})
