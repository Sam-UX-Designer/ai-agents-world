import { expect, test, type Page } from '@playwright/test'
import { openAnyAgent, signIn } from './helpers'

/**
 * Renaming an agent.
 *
 * The roster ships as departments - Finance Agent, Sales Agent - and a
 * department is not what people actually call the thing doing their work. So
 * the name is theirs to change, and the questions worth asking are the ones
 * that decide whether the feature is real: does the new name reach the server,
 * does it reach the island and not just the panel it was typed into, does it
 * survive a reload, and can it be undone.
 *
 * The one thing that must never move is the agent's key. A rename is a label.
 * If it renamed the agent underneath, every task and history row already
 * written would point at a worker that no longer answers to it.
 */

/** Put every agent back to its built-in name. The demo has one workspace, so
 *  a name left behind by this spec would be there for every spec after it. */
async function resetNames(page: Page) {
  const res = await page.request.get('/api/agents')
  if (!res.ok()) return
  const agents = (await res.json()) as { key: string; name: string; defaultName: string }[]
  for (const agent of agents) {
    if (agent.name !== agent.defaultName) {
      await page.request.put(`/api/agents/${agent.key}/name`, { data: { name: '' } })
    }
  }
}

test.describe('renaming an agent', () => {
  test.afterEach(async ({ page }) => {
    await resetNames(page)
  })

  test('the new name reaches the server, the panel and the island', async ({ page }) => {
    await signIn(page)

    const before = await openAnyAgent(page)
    const chosen = `Muse ${Date.now().toString().slice(-5)}`

    await page.locator('.rename__name').click()
    await page.locator('.rename__input').fill(chosen)
    await page.locator('.rename__save').click()

    // The panel header, which is where it was typed.
    await expect(page.locator('.rename__name')).toHaveText(chosen)

    /*
     * And the island, which is the part that makes it a rename rather than a
     * text field. The station keeps its key, so this also proves the agent
     * underneath did not move.
     */
    const key = await page.locator('.agent-dock').evaluate(() => {
      const el = document.querySelector('.station [aria-pressed="true"]')
      return el?.closest('.station')?.getAttribute('data-agent') ?? null
    })
    expect(key, 'the selected station is identifiable').toBeTruthy()
    await expect(page.locator(`.station[data-agent="${key}"] .marker__label strong`)).toHaveText(chosen)

    // On the server, not only in this tab.
    const stored = await page.request.get('/api/agents')
    const agents = (await stored.json()) as { key: string; name: string; defaultName: string }[]
    const saved = agents.find((a) => a.key === key)
    expect(saved?.name, 'the API returns the chosen name').toBe(chosen)
    expect(saved?.defaultName, 'and still knows the built-in one').toBe(before)
  })

  test('the name survives a reload', async ({ page }) => {
    await signIn(page)
    await openAnyAgent(page)

    const chosen = `Ledger ${Date.now().toString().slice(-5)}`
    await page.locator('.rename__name').click()
    await page.locator('.rename__input').fill(chosen)
    await page.locator('.rename__save').click()
    await expect(page.locator('.rename__name')).toHaveText(chosen)

    await page.reload()
    const again = await openAnyAgent(page, chosen)
    expect(again).toBe(chosen)
    await expect(page.locator('.rename__name')).toHaveText(chosen)
  })

  test('the built-in name can be had back', async ({ page }) => {
    await signIn(page)
    const original = await openAnyAgent(page)

    await page.locator('.rename__name').click()
    await page.locator('.rename__input').fill('Temporary')
    await page.locator('.rename__save').click()
    await expect(page.locator('.rename__name')).toHaveText('Temporary')

    // The way back is offered only once there is something to undo, and it
    // names the agent it would restore rather than saying "reset".
    await page.locator('.rename__name').click()
    const reset = page.locator('.rename__reset')
    await expect(reset).toHaveText(`Use ${original}`)
    await reset.click()

    await expect(page.locator('.rename__name')).toHaveText(original)
  })

  test('a name of nothing but spaces is a reset, not a blank label', async ({ page }) => {
    await signIn(page)
    const original = await openAnyAgent(page)

    await page.locator('.rename__name').click()
    await page.locator('.rename__input').fill('   ')
    await page.locator('.rename__save').click()

    // Never an empty card. A station with no name on it is unreachable.
    await expect(page.locator('.rename__name')).toHaveText(original)
  })

  test('renaming does not touch what the agent is or what it can reach', async ({ page }) => {
    await signIn(page)
    await openAnyAgent(page)

    // textContent, not innerText: the section headings are uppercased in CSS,
    // and innerText would hand back the painted text to compare against the
    // real one.
    const role = page.locator('.agent-dock header p')
    const tools = page.locator('.agent-dock section h3').filter({ hasText: /^Tools \(/ })
    const roleBefore = (await role.textContent())?.trim() ?? ''
    const toolsBefore = (await tools.textContent())?.trim() ?? ''
    expect(roleBefore, 'the panel has a role line to compare').not.toBe('')
    expect(toolsBefore, 'and a tool count').toMatch(/^Tools \(\d+\)$/)

    await page.locator('.rename__name').click()
    await page.locator('.rename__input').fill('Renamed')
    await page.locator('.rename__save').click()
    await expect(page.locator('.rename__name')).toHaveText('Renamed')

    // The role line and the tool count come from the registry, which a rename
    // has no business changing.
    await expect(role).toHaveText(roleBefore)
    await expect(tools).toHaveText(toolsBefore)
  })

  /*
   * The field stops a long name being typed, but the field is not the rule.
   * Anything can call this route, so the server has to hold the line itself,
   * and it has to say what is wrong in words rather than returning a 500.
   */
  test('the server refuses a name too long to fit on a card', async ({ page }) => {
    await signIn(page)

    const tooLong = 'M'.repeat(33)
    const res = await page.request.put('/api/agents/finance/name', { data: { name: tooLong } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toMatch(/too long/i)

    // Exactly at the limit is fine - an off-by-one here would reject a name
    // the field happily accepted.
    const atLimit = 'M'.repeat(32)
    const ok = await page.request.put('/api/agents/finance/name', { data: { name: atLimit } })
    expect(ok.status()).toBe(200)
    expect((await ok.json()).name).toBe(atLimit)
  })

  test('an agent that does not exist cannot be renamed', async ({ page }) => {
    await signIn(page)
    const res = await page.request.put('/api/agents/not-an-agent/name', { data: { name: 'Muse' } })
    expect(res.status()).toBe(404)
  })

  test('cancelling leaves the name alone', async ({ page }) => {
    await signIn(page)
    const original = await openAnyAgent(page)

    await page.locator('.rename__name').click()
    await page.locator('.rename__input').fill('Not this one')
    await page.locator('.rename__cancel').click()

    await expect(page.locator('.rename__name')).toHaveText(original)
    const stored = await page.request.get('/api/agents')
    const agents = (await stored.json()) as { name: string; defaultName: string }[]
    expect(
      agents.filter((a) => a.name !== a.defaultName),
      'nothing was saved',
    ).toHaveLength(0)
  })
})
