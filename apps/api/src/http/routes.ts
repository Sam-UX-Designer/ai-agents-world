import type Anthropic from '@anthropic-ai/sdk'
import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  AGENT_REGISTRY,
  PROVIDERS,
  getProvider,
  resolveTools,
  type ConnectionProvider,
  type ProviderDefinition,
  type ProviderStatus,
} from '@agents-world/shared'
import { issueSession, revokeSession, SESSION_COOKIE } from '../auth/sessions.js'
import { completeSignIn, resolveUser, startSignIn } from '../auth/signin.js'
import { getWorkspace, setAutonomyLevel } from '../auth/workspaces.js'
import { db, schema } from '../db/client.js'
import type { EventBus } from '../realtime/bus.js'
import { resolveApproval, listPendingApprovals } from '../runtime/approvals.js'
import { runGoal } from '../runtime/orchestration.js'
import {
  listConnections,
  revokeConnection,
  saveConnection,
} from '../tools/connections.js'
import { consumeState, exchangeCode, startAuthorisation } from '../tools/oauth.js'
import { speak, voiceEnabled } from '../voice/elevenlabs.js'
import { authenticate, respondWithError } from './context.js'
import { config } from '../config.js'

/**
 * The HTTP surface.
 *
 * Commands live here rather than on the WebSocket because they need to be
 * authenticated, audited and idempotent - properties that are easy to give an
 * HTTP request and awkward to give a socket frame that might arrive twice on
 * a flaky connection.
 */

export interface RouteDeps {
  readonly client: Anthropic
  readonly bus: EventBus
}

export async function registerRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'agents-world-api',
    voice: voiceEnabled() ? 'enabled' : 'text-only',
    time: new Date().toISOString(),
  }))

  /** The agent roster. The island reads this to place and label its robots. */
  app.get('/agents', async () =>
    AGENT_REGISTRY.map((agent) => ({
      key: agent.key,
      name: agent.name,
      role: agent.role,
      zone: agent.zone,
      accent: agent.accent,
      enabled: agent.enabled,
      // Resolved from the shared catalogue rather than owned by the agent, so
      // the panel lists what this role can actually reach right now.
      tools: resolveTools(agent.toolIds).map((t) => ({
        id: t.id,
        label: t.label,
        effect: t.effect,
      })),
      instructions: agent.instructions,
    })),
  )

  /** The connector catalogue, for the Connect Tools screen. */
  app.get('/providers', async () =>
    PROVIDERS.map((p) => ({ ...p, ...effectiveStatus(p) })),
  )

  app.get('/connections', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      return await listConnections(ctx.workspaceId)
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  /** Begin a connect. Returns the URL rather than redirecting, so the mobile
   *  app can open it in a system browser instead of a webview. */
  app.get('/connect/:provider', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const { provider } = request.params as { provider: string }

      const definition = getProvider(provider)
      if (!definition) return reply.status(404).send({ error: 'Unknown provider' })

      // Derived from the same function the catalogue uses. Computing it
      // separately here is how a card that says "Connect" ends up beside an
      // endpoint that says "not available" for a different reason.
      const status = effectiveStatus(definition)
      if (status.status !== 'available') {
        return reply.status(409).send({ error: status.statusNote ?? 'Not available yet' })
      }

      const url = await startAuthorisation({
        provider: definition.id,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        returnTo: (request.query as { returnTo?: string }).returnTo,
      })

      return { url, permissions: definition.permissions }
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  /** OAuth callback. The one route that must work for a signed-out browser
   *  tab returning from Google, so it authenticates by `state`, not session. */
  app.get('/auth/:provider/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string }

    if (query.error) {
      return reply.redirect(`${config().APP_URL}/connect?error=${encodeURIComponent(query.error)}`)
    }
    if (!query.code || !query.state) {
      return reply.redirect(`${config().APP_URL}/connect?error=missing_code`)
    }

    const consumed = await consumeState(query.state)
    if (!consumed) {
      return reply.redirect(`${config().APP_URL}/connect?error=expired`)
    }

    try {
      const grant = await exchangeCode(consumed.provider, query.code, consumed.codeVerifier)
      await saveConnection(consumed.workspaceId, consumed.userId, consumed.provider, grant)
      return reply.redirect(consumed.returnTo ?? `${config().APP_URL}/connect?connected=${consumed.provider}`)
    } catch (err) {
      request.log.error({ err }, 'oauth exchange failed')
      return reply.redirect(`${config().APP_URL}/connect?error=exchange_failed`)
    }
  })

  app.delete('/connections/:id', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const { id } = request.params as { id: string }
      await revokeConnection(ctx.workspaceId, id)
      return { revoked: true }
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  // ----------------------------------------------------------------- sign in --

  /** Begin sign-in. Identity scopes only - no mail, no calendar. */
  app.get('/auth/:provider/signin', async (request, reply) => {
    const { provider } = request.params as { provider: string }
    if (provider !== 'google' && provider !== 'microsoft') {
      return reply.status(404).send({ error: 'Unknown sign-in provider' })
    }

    try {
      const url = await startSignIn(provider, (request.query as { returnTo?: string }).returnTo)
      return { url }
    } catch (err) {
      return reply.status(409).send({
        error: err instanceof Error ? err.message : 'Sign-in is not configured',
      })
    }
  })

  app.get('/auth/:provider/signin-callback', async (request, reply) => {
    const { provider } = request.params as { provider: string }
    const query = request.query as { code?: string; state?: string; error?: string }
    const appUrl = config().APP_URL.replace(/\/$/, '')

    if (provider !== 'google' && provider !== 'microsoft') {
      return reply.redirect(`${appUrl}/signin?error=unknown_provider`)
    }
    if (query.error || !query.code || !query.state) {
      return reply.redirect(`${appUrl}/signin?error=${encodeURIComponent(query.error ?? 'cancelled')}`)
    }

    const consumed = await consumeState(query.state)
    if (!consumed || consumed.provider !== `signin:${provider}`) {
      return reply.redirect(`${appUrl}/signin?error=expired`)
    }

    try {
      const identity = await completeSignIn(provider, query.code, consumed.codeVerifier)
      const { userId, workspaceId, isNew } = await resolveUser(provider, identity)
      const { token, expiresAt } = await issueSession({
        userId,
        workspaceId,
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
      })

      return reply
        .setCookie(SESSION_COOKIE, token, {
          httpOnly: true,
          // Not reachable from JavaScript, not sent on cross-site requests,
          // and TLS-only outside development.
          sameSite: 'lax',
          secure: config().NODE_ENV === 'production',
          path: '/',
          expires: expiresAt,
        })
        // A new account goes to Connect Tools, since an agent with no
        // integrations has nothing to work with.
        .redirect(consumed.returnTo ?? `${appUrl}/${isNew ? 'connect' : 'world'}`)
    } catch (err) {
      request.log.error({ err }, 'sign-in failed')
      return reply.redirect(`${appUrl}/signin?error=signin_failed`)
    }
  })

  app.post('/auth/signout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) await revokeSession(token)
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ signedOut: true })
  })

  /** Who am I, and what can I reach. The client's first call on load. */
  app.get('/me', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const [user] = await db()
        .select({
          id: schema.users.id,
          email: schema.users.email,
          name: schema.users.name,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.userId))
        .limit(1)

      const workspace = await getWorkspace(ctx.workspaceId)

      return {
        user,
        workspace: workspace
          ? {
              id: workspace.id,
              name: workspace.name,
              autonomyLevel: workspace.autonomyLevel,
              role: ctx.membership.role,
            }
          : null,
        connections: await listConnections(ctx.workspaceId),
      }
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  // ------------------------------------------------------------------ goals --

  const submitGoal = z.object({
    prompt: z.string().min(1).max(4000),
    timezone: z.string().default('UTC'),
  })

  /**
   * Submit a goal.
   *
   * Returns as soon as the goal row exists; execution continues server-side.
   * The client then watches over the WebSocket. This is what makes closing
   * the app harmless - nothing about the run depends on the tab staying open.
   */
  app.post('/goals', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const body = submitGoal.safeParse(request.body)
      if (!body.success) return reply.status(400).send({ error: 'A goal is required' })

      const [goal] = await db()
        .insert(schema.goals)
        .values({
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          prompt: body.data.prompt,
        })
        .returning({ id: schema.goals.id })

      if (!goal) return reply.status(500).send({ error: 'Could not create the goal' })

      void runGoal(deps, {
        goalId: goal.id,
        workspaceId: ctx.workspaceId,
        prompt: body.data.prompt,
        timezone: body.data.timezone,
      }).catch((err) => request.log.error({ err, goalId: goal.id }, 'goal failed'))

      return reply.status(202).send({ goalId: goal.id })
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  app.get('/goals', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      return await db()
        .select({
          id: schema.goals.id,
          prompt: schema.goals.prompt,
          state: schema.goals.state,
          createdAt: schema.goals.createdAt,
          completedAt: schema.goals.completedAt,
        })
        .from(schema.goals)
        .where(eq(schema.goals.workspaceId, ctx.workspaceId))
        .orderBy(desc(schema.goals.createdAt))
        .limit(50)
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  /** Everything needed to render a goal, including the replay cursor. */
  app.get('/goals/:id', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const { id } = request.params as { id: string }

      const [goal] = await db()
        .select()
        .from(schema.goals)
        .where(eq(schema.goals.id, id))
        .limit(1)

      if (!goal || goal.workspaceId !== ctx.workspaceId) {
        return reply.status(404).send({ error: 'Not found' })
      }

      const [tasks, runs, artifacts] = await Promise.all([
        db().select().from(schema.tasks).where(eq(schema.tasks.goalId, id)),
        db().select().from(schema.agentRuns).where(eq(schema.agentRuns.goalId, id)),
        db().select().from(schema.artifacts).where(eq(schema.artifacts.goalId, id)),
      ])

      return {
        goal: {
          id: goal.id,
          prompt: goal.prompt,
          state: goal.state,
          summary: goal.summary,
          error: goal.error,
          // The client subscribes from here, so a page load and a live socket
          // never double-apply the same event.
          nextSeq: goal.nextSeq,
        },
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          agentKey: t.agentKey,
          state: t.state,
          wave: t.wave,
          dependsOn: t.dependsOn,
          error: t.error,
        })),
        runs: runs.map((r) => ({
          taskId: r.taskId,
          agentKey: r.agentKey,
          state: r.state,
          completedSteps: r.completedSteps,
          error: r.error,
        })),
        artifacts: artifacts.map((a) => ({ id: a.id, title: a.title, kind: a.kind })),
      }
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  /** The Activity tab of the agent detail panel. */
  app.get('/goals/:id/activity', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const { id } = request.params as { id: string }

      // Scoped by workspace in the query, not filtered afterwards: the goal id
      // arrives in the URL and is not evidence of anything until it is matched
      // against the caller's own workspace.
      return await db()
        .select({
          agentKey: schema.toolCalls.agentKey,
          toolId: schema.toolCalls.toolId,
          summary: schema.toolCalls.summary,
          outcome: schema.toolCalls.outcome,
          permission: schema.toolCalls.permission,
          createdAt: schema.toolCalls.createdAt,
        })
        .from(schema.toolCalls)
        .innerJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.toolCalls.runId))
        .where(
          and(
            eq(schema.agentRuns.goalId, id),
            eq(schema.toolCalls.workspaceId, ctx.workspaceId),
          ),
        )
        .orderBy(desc(schema.toolCalls.createdAt))
        .limit(200)
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  /** An artifact's content, for the results panel and for download. */
  app.get('/artifacts/:id', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const { id } = request.params as { id: string }

      const [artifact] = await db()
        .select()
        .from(schema.artifacts)
        .where(
          and(
            eq(schema.artifacts.id, id),
            // Scoped in the query, not checked afterwards: an id in a URL is
            // not evidence of anything until it is matched to the caller.
            eq(schema.artifacts.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1)

      if (!artifact) return reply.status(404).send({ error: 'Not found' })

      const download = (request.query as { download?: string }).download === '1'
      if (download) {
        // Content-Disposition on a text/plain body, so the browser saves the
        // file instead of rendering it in a tab.
        const filename = `${artifact.title.replace(/[^\w. -]/g, '_')}.txt`
        return reply
          .header('content-type', 'text/plain; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(artifact.content ?? '')
      }

      return {
        id: artifact.id,
        title: artifact.title,
        kind: artifact.kind,
        content: artifact.content,
        createdAt: artifact.createdAt,
      }
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  // -------------------------------------------------------------- approvals --

  app.get('/approvals', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      return await listPendingApprovals(ctx.workspaceId)
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  const decision = z.object({
    decision: z.enum(['approved', 'rejected']),
    remember: z.boolean().default(false),
  })

  app.post('/approvals/:id', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const { id } = request.params as { id: string }
      const body = decision.safeParse(request.body)
      if (!body.success) return reply.status(400).send({ error: 'A decision is required' })

      const result = await resolveApproval(deps, {
        approvalId: id,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        decision: body.data.decision,
        remember: body.data.remember,
      })

      return result
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  // ---------------------------------------------------------------- settings --

  const autonomy = z.object({
    level: z.enum(['ask_always', 'ask_once_per_type', 'autonomous']),
  })

  app.put('/settings/autonomy', async (request, reply) => {
    try {
      // Owner or admin only: this setting decides whether an agent can act
      // without asking, which is not a per-member preference.
      const ctx = await authenticate(request)
      if (ctx.membership.role === 'member') {
        return reply.status(403).send({ error: 'Only an admin can change autonomy.' })
      }

      const body = autonomy.safeParse(request.body)
      if (!body.success) return reply.status(400).send({ error: 'Invalid level' })

      await setAutonomyLevel(ctx.workspaceId, body.data.level)
      return { level: body.data.level }
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  // ------------------------------------------------------------------- voice --

  const speech = z.object({ text: z.string().min(1).max(5000) })

  /**
   * Render agent text to speech.
   *
   * Server-side so the ElevenLabs key never reaches a browser or a phone.
   * Returns 204 when voice is unavailable, which the client reads as "show the
   * text, play nothing" rather than as an error.
   */
  app.post('/speak', async (request, reply) => {
    try {
      await authenticate(request)
      const body = speech.safeParse(request.body)
      if (!body.success) return reply.status(400).send({ error: 'Text is required' })

      const result = await speak(body.data.text)
      if (!result) return reply.status(204).send()

      return reply.header('content-type', result.contentType).send(result.audio)
    } catch (err) {
      return respondWithError(reply, err)
    }
  })
}

/**
 * A provider's real status on this deployment.
 *
 * The catalogue says what a provider is in principle; this says whether it can
 * actually complete a connect right now. The connect card and the connect
 * endpoint both read it, so a card can never offer a button the endpoint will
 * refuse.
 */
function effectiveStatus(p: ProviderDefinition): {
  status: ProviderStatus
  statusNote: string | null
} {
  if (p.status === 'available' && !isConfigured(p.id)) {
    return { status: 'blocked', statusNote: 'Not configured on this deployment yet.' }
  }
  return { status: p.status, statusNote: p.statusNote }
}

/** Whether this deployment holds credentials for a provider. */
function isConfigured(provider: ConnectionProvider): boolean {
  const c = config()
  switch (provider) {
    case 'google':
      return Boolean(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET && c.GOOGLE_REDIRECT_URI)
    case 'slack':
      return Boolean(c.SLACK_CLIENT_ID && c.SLACK_CLIENT_SECRET && c.SLACK_REDIRECT_URI)
    default:
      return false
  }
}
