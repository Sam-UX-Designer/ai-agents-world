import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * Which Chromium to drive.
 *
 * Playwright pins an exact browser build per release and refuses to start
 * any other one it finds. Some machines - CI images, cloud dev boxes - ship
 * their own Chromium at a fixed path and block the download, so the pinned
 * build never arrives and every test fails at launch.
 *
 * Look for that pre-installed browser and use it. Falling through to
 * undefined means "whatever `npx playwright install` put in the cache",
 * which is the normal case on a laptop.
 */
const chromium = () => {
  const pinned = process.env.PLAYWRIGHT_CHROMIUM
  if (pinned) return pinned
  const preinstalled = '/opt/pw-browsers/chromium'
  return existsSync(preinstalled) ? preinstalled : undefined
}

/**
 * End-to-end tests, against the real product.
 *
 * `pnpm e2e` starts the demo server - the real API, a real Postgres compiled
 * to WebAssembly, the real orchestration loop, the real permission gate, the
 * real WebSocket - and drives the real screens in a real browser. The only
 * stand-in is Claude itself, because a suite that costs money per run is a
 * suite nobody runs before a release.
 *
 * That substitution is the point rather than a compromise: the questions these
 * tests answer are "did the prompt reach the model", "did its answer come
 * back", "did it land on screen, in History, and on the bill" - and every one
 * of those is our code, not Anthropic's. A stub that returns a known sentence
 * lets us assert the exact sentence arrives, which a live model never could.
 */
export default defineConfig({
  testDir: './e2e',
  // A goal runs the demo's scripted pauses, so a spec that submits two of them
  // legitimately takes half a minute.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Serial. Every worker would share one demo database and one credit
  // balance, and tests that spend each other's credits fail for reasons that
  // have nothing to do with the code.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: chromium(),
      args: ['--no-sandbox'],
    },
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node scripts/dev.mjs',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
