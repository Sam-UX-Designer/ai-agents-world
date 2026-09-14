import Fastify from 'fastify'

/**
 * API entry point.
 *
 * Deliberately thin: it wires transport to services and owns no logic of its
 * own. Orchestration lives in src/orchestrator, execution in src/runtime,
 * and the path from state to the island in src/realtime.
 */

const PORT = Number(process.env.PORT ?? 4000)

const app = Fastify({ logger: true })

app.get('/health', async () => ({
  status: 'ok',
  service: 'agents-world-api',
  time: new Date().toISOString(),
}))

async function start(): Promise<void> {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

void start()
