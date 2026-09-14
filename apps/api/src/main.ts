import Anthropic from '@anthropic-ai/sdk'
import cookie from '@fastify/cookie'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { closeDb } from './db/client.js'
import { config } from './config.js'
import { registerRoutes } from './http/routes.js'
import { EventBus } from './realtime/bus.js'
import { registerSocket } from './realtime/socket.js'
import { PostgresEventStore } from './realtime/store.js'

/**
 * API entry point.
 *
 * Thin by design: it wires transport to services and owns no logic of its own.
 * Orchestration lives in src/runtime, planning in src/orchestrator, and the
 * road from backend state to the island in src/realtime.
 */

/**
 * Build the server without listening.
 *
 * Separated from `start` so the route tests can drive the real app through
 * Fastify's inject() - same routes, same plugins, same auth - without opening
 * a port or hitting the network.
 */
export async function buildApp(client: Anthropic, bus: EventBus) {
  const c = config()

  const app = Fastify({
    logger: { level: c.NODE_ENV === 'production' ? 'info' : 'debug' },
    // Behind Railway or Render, the client IP arrives in a forwarded header.
    trustProxy: true,
  })

  await app.register(cookie, { secret: c.SESSION_SECRET })
  await app.register(websocket)

  await registerRoutes(app, { client, bus })
  await registerSocket(app, bus)

  return app
}

async function start(): Promise<void> {
  // Validated first, so a missing secret stops the process here with a clear
  // message rather than surfacing later as an agent failing mid-run.
  const c = config()
  const client = new Anthropic({ apiKey: c.ANTHROPIC_API_KEY })
  const app = await buildApp(client, new EventBus(new PostgresEventStore()))

  // Drain in-flight requests before exiting, so a deploy does not cut a goal
  // off mid-plan.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void (async () => {
        app.log.info(`${signal} received, shutting down`)
        await app.close()
        await closeDb()
        process.exit(0)
      })()
    })
  }

  try {
    await app.listen({ port: c.PORT, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// Only self-start when run directly, never when imported by a test.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  void start()
}
