import { chromium } from 'playwright'
const OUT = '/tmp/claude-0/-home-user-ai-agents-world/c2d98d92-4981-5401-bc04-d9dafca3808f/scratchpad/shots'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1440, height: 810 } })
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0,150)))
await p.goto('http://localhost:3000/api/demo/login', { waitUntil: 'networkidle' })
// Empty-state check first (fresh DB after restart).
await p.goto('http://localhost:3000/history', { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
const empty = await p.locator('.tools__empty strong').count()
console.log('empty state shown on a fresh workspace:', empty > 0)
await p.screenshot({ path: `${OUT}/hist-empty.png` })
// Seed two goals then re-check.
for (const g of ['Create a marketing campaign for the new product launch', 'What is a good way to think about pricing?']) {
  await p.goto('http://localhost:3000/world', { waitUntil: 'networkidle' })
  await p.waitForTimeout(1000)
  await p.fill('.command__input', g); await p.click('.command__send'); await p.waitForTimeout(13000)
}
await p.goto('http://localhost:3000/history', { waitUntil: 'networkidle' })
await p.waitForSelector('.hist__row:not(.hist__row--skeleton)', { timeout: 15000 })
await p.waitForTimeout(1000)
console.log('rows now:', await p.locator('.hist__row:not(.hist__row--skeleton)').count())
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800)
await p.locator('.hist__row').first().click(); await p.waitForTimeout(700)
await p.screenshot({ path: `${OUT}/hist-phone2.png` })
console.log('h-overflow(390):', await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
console.log('errors:', errs.length ? errs.join(' | ') : 'none')
await b.close()
