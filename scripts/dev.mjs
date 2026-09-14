/**
 * One command to run the whole product on a laptop.
 *
 *   pnpm dev
 *
 * Starts the API and the web app together and prints one link to open. No API
 * keys, no Postgres install, no accounts, no Vercel.
 *
 * What is real and what is not:
 *
 *   real  - the API, the database (Postgres compiled to WebAssembly, running
 *           inside the same process), sessions, the permission gate, the
 *           WebSocket, every screen.
 *   faked - Claude itself, because that needs a paid API key, and the Google
 *           and Slack tokens, because those need OAuth apps. Agents answer
 *           from a scripted plan with realistic pauses, so the island behaves
 *           the way it will in production.
 *
 * Deliberately dependency-free: a designer cloning this repo should not have
 * to install a process manager to see the app.
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const API_PORT = process.env.API_PORT ?? '4000'
const WEB_PORT = process.env.WEB_PORT ?? '3000'
const WEB_URL = `http://localhost:${WEB_PORT}`

const children = []
let shuttingDown = false

const run = (name, args, env) => {
  const child = spawn('pnpm', args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)

  // Prefix every line so two servers in one terminal stay readable.
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      if (line.trim()) console.log(`\x1b[2m${name}\x1b[0m ${line}`)
    })
  }

  child.on('exit', (code) => {
    if (shuttingDown) return
    console.error(`\n${name} stopped (exit ${code}). Shutting everything down.`)
    stop(code ?? 1)
  })

  return child
}

const stop = (code) => {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

// ---------------------------------------------------------------- start --

console.log('\nStarting AI Agents World...\n')

const api = run('api ', ['--filter', '@agents-world/api', 'demo'], {
  PORT: API_PORT,
  APP_URL: WEB_URL,
})

/* The web server is only useful once the API answers, so wait for the line the
   demo server prints when it is listening. */
await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error('The API did not start within 90 seconds.')),
    90_000,
  )
  createInterface({ input: api.stdout }).on('line', (line) => {
    if (line.includes('DEMO_READY')) {
      clearTimeout(timer)
      resolve()
    }
  })
}).catch((err) => {
  console.error(`\n${err.message}\n`)
  stop(1)
})

run('web ', ['--filter', '@agents-world/web', 'dev'], {
  API_URL: `http://localhost:${API_PORT}`,
  PORT: WEB_PORT,
})

// Next.js prints its own banner a moment later; this sits underneath it so it
// is the last thing on screen.
setTimeout(() => {
  const line = '─'.repeat(58)
  console.log(`
\x1b[36m${line}\x1b[0m

  Open this link to sign in and land on the island:

      \x1b[1m\x1b[36m${WEB_URL}/api/demo/login\x1b[0m

  Then use the tabs on the left: Home, Tools, History.
  Press Ctrl+C to stop both servers.

\x1b[36m${line}\x1b[0m
`)
}, 6000)
