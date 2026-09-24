import { expect, test } from '@playwright/test'

/**
 * The product page.
 *
 * It is the one page here that is read rather than used, and the one a link
 * from somewhere else lands on, so the things worth testing are the things a
 * stranger would notice in the first five seconds: the promise is legible,
 * the artwork actually loaded, the page can be scrolled to its end on a
 * phone, and the light switch works.
 *
 * `/` is deliberately not this page - it is the sign-in screen - so that is
 * asserted too. Moving it has been asked for by accident before.
 */

test.describe('the product page', () => {
  test('says what the product does, above the fold', async ({ page }) => {
    await page.goto('/product')

    const head = page.locator('.pt__herotext h1')
    await expect(head).toBeVisible()
    // Normalised, because the second sentence carries a break that only
    // exists below 760px.
    const words = (await head.innerText()).replace(/\s+/g, ' ').trim()
    expect(words).toBe('Ask once. Watch the AI agents working')

    // In the window, not below it. A promise you have to scroll to is not a
    // promise anyone reads.
    const box = (await head.boundingBox())!
    const view = page.viewportSize()!
    expect(box.y + box.height).toBeLessThan(view.height)
  })

  test('the hero is centred', async ({ page }) => {
    await page.goto('/product')

    const view = page.viewportSize()!
    for (const sel of ['.pt__herotext h1', '.pt__herotext p', '.pt__cta']) {
      const box = (await page.locator(sel).first().boundingBox())!
      const middle = box.x + box.width / 2
      // Within a pixel of the window's own centre. Anything further is a
      // layout that is left-aligned and merely looks central.
      expect(Math.abs(middle - view.width / 2), `${sel} sits off centre`).toBeLessThanOrEqual(1)
    }
  })

  test('the island loaded and nothing runs off the side', async ({ page }) => {
    await page.goto('/product')
    await page.waitForLoadState('networkidle')

    const art = await page.locator('.pt__heroimg').evaluate((el) => ({
      w: (el as HTMLImageElement).naturalWidth,
      shown: (el as HTMLImageElement).getBoundingClientRect().width,
    }))
    // A 404 on the artwork renders a broken image with a natural width of 0,
    // which no amount of looking at the markup would catch.
    expect(art.w).toBeGreaterThan(0)
    expect(art.shown).toBeGreaterThan(0)

    const spill = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(spill, 'the page scrolls sideways').toBeLessThanOrEqual(1)
  })

  test('it can be scrolled to its last line', async ({ page }) => {
    await page.goto('/product')
    await page.waitForLoadState('networkidle')

    const foot = page.locator('.pt__foot')
    await foot.scrollIntoViewIfNeeded()
    await expect(foot).toBeInViewport()
  })

  test('the light switch changes the page, and is remembered', async ({ page }) => {
    await page.goto('/product')

    const toggle = page.locator('.pt__toggle')
    await expect(toggle).toBeEnabled()

    const colour = () => page.locator('.pt').evaluate((el) => getComputedStyle(el).backgroundColor)
    const before = await colour()

    await toggle.click()
    await expect
      .poll(colour, { message: 'the page did not change colour' })
      .not.toBe(before)

    const after = await colour()
    await page.reload()
    // The choice survives the reload, which is the whole reason it is stored.
    await expect.poll(colour).toBe(after)
  })

  test('the front door is still the sign-in screen', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.pt')).toHaveCount(0)
  })
})
