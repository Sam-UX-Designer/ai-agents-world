import { chromium, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
const out = process.argv[2]
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
const shoot = async (tag, opts, mode) => {
  const ctx = await browser.newContext({ ...opts, colorScheme: mode })
  const page = await ctx.newPage()
  await page.goto('http://localhost:3000/product', { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/${tag}-${mode}-top.png` })
  await page.evaluate(async () => {
    const el = document.scrollingElement
    for (let y = 0; y < el.scrollHeight; y += 400) { el.scrollTo(0, y); await new Promise(r => setTimeout(r, 65)) }
    el.scrollTo(0, 0)
  })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${out}/${tag}-${mode}-full.png`, fullPage: true })
  console.log(tag, mode, JSON.stringify(await page.evaluate(() => ({
    wide: document.scrollingElement.scrollWidth > innerWidth + 1,
  }))))
  await ctx.close()
}
await shoot('desk', { viewport: { width: 1440, height: 900 } }, 'dark')
await shoot('desk', { viewport: { width: 1440, height: 900 } }, 'light')
await shoot('phone', { ...devices['Pixel 7'] }, 'light')
await browser.close()
