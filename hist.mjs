import { chromium } from 'playwright'
const OUT = '/tmp/claude-0/-home-user-ai-agents-world/c2d98d92-4981-5401-bc04-d9dafca3808f/scratchpad/shots'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1440, height: 810 } })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0,160)))
await p.goto('http://localhost:3000/api/demo/login', { waitUntil: 'networkidle' })
await p.goto('http://localhost:3000/history', { waitUntil: 'networkidle' })
await p.waitForSelector('.hist__row:not(.hist__row--skeleton)', { timeout: 15000 })
await p.waitForTimeout(1200)
console.log('rows:', await p.locator('.hist__row:not(.hist__row--skeleton)').count())
console.log('filters:', (await p.locator('.cat').allTextContents()).join(' | '))
console.log('detail title:', await p.locator('.hdetail__title').innerText())
console.log('durations:', (await p.locator('.hist__dur').allTextContents()).join(', '))
await p.screenshot({ path: `${OUT}/hist-1.png` })

// search
await p.fill('.hist .search input', 'pricing')
await p.waitForTimeout(400)
console.log('search "pricing" ->', await p.locator('.hist__row:not(.hist__row--skeleton)').count(), 'row(s)')
await p.fill('.hist .search input', '')
await p.waitForTimeout(300)

// filter
await p.locator('.cat', { hasText: 'Completed' }).click()
await p.waitForTimeout(400)
console.log('Completed filter ->', await p.locator('.hist__row:not(.hist__row--skeleton)').count(), 'rows')
await p.locator('.cat', { hasText: 'All' }).first().click()
await p.waitForTimeout(300)

// range menu
await p.click('.range__btn')
await p.waitForTimeout(400)
console.log('range options:', (await p.locator('.range__menu button').allTextContents()).join(' | '))
await p.screenshot({ path: `${OUT}/hist-range.png` })
await p.keyboard.press('Escape'); await p.click('.range__btn'); await p.waitForTimeout(300)

// select a multi-agent row
await p.locator('.hist__row', { hasText: 'marketing campaign' }).first().click()
await p.waitForTimeout(600)
console.log('detail agents:', (await p.locator('.hdetail__agents li span').allTextContents()).join(', '))
console.log('detail tools:', (await p.locator('.toolchip').allTextContents()).join(', '))
await p.screenshot({ path: `${OUT}/hist-detail.png` })

console.log('h-overflow:', await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(700)
await p.screenshot({ path: `${OUT}/hist-phone.png` })
console.log('h-overflow(390):', await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
console.log('errors:', errs.length ? errs.join(' | ') : 'none')
await b.close()
