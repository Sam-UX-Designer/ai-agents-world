import type Anthropic from '@anthropic-ai/sdk'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  AGENT_REGISTRY,
  PROVIDERS,
  getProvider,
  resolveTools,
  INTEGRATIONS,
  agentsWithAccess,
  capabilitiesFor,
  integrationIcon,
  permissionsFor,
  type ConnectionProvider,
  type ProviderDefinition,
  type ProviderStatus,
} from '@agents-world/shared'
import {
  getInstructions,
  listAgentNames,
  listInstructions,
  MAX_AGENT_NAME_LENGTH,
  MAX_INSTRUCTION_LENGTH,
  normaliseAgentName,
  setAgentName,
  setInstructions,
} from '../agents/overrides.js'
import { AuthError, login, MIN_PASSWORD_LENGTH, register } from '../auth/password.js'
import { issueSession, revokeSession, SESSION_COOKIE } from '../auth/sessions.js'
import { completeSignIn, resolveUser, startSignIn } from '../auth/signin.js'
import { getWorkspace, setAutonomyLevel } from '../auth/workspaces.js'
import { db, schema } from '../db/client.js'
import type { EventBus } from '../realtime/bus.js'
import { resolveApproval, listPendingApprovals } from '../runtime/approvals.js'
import { runGoal } from '../runtime/orchestration.js'
import { balanceOf, ledgerFor, spendForGoal } from '../billing/wallet.js'
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

  /**
   * The workspace whose settings apply to this request, or null.
   *
   * The roster is readable without signing in - the marketing page and the
   * sign-in screen both draw the island - so a missing session is a normal
   * answer here rather than an error. Signed in, it is how the caller's own
   * names for its agents are found.
   */
  const workspaceOrNull = async (request: FastifyRequest): Promise<string | null> => {
    try {
      return (await authenticate(request)).workspaceId
    } catch {
      return null
    }
  }

  /** The agent roster. The island reads this to place and label its robots. */
  app.get('/agents', async (request) => {
    const workspaceId = await workspaceOrNull(request)
    const names = workspaceId ? await listAgentNames(workspaceId) : {}

    return AGENT_REGISTRY.map((agent) => ({
      key: agent.key,
      // What this workspace calls it. Everything on screen reads this field,
      // so a rename reaches the island, the panel and the active list at once.
      name: names[agent.key] ?? agent.name,
      // The built-in name, always. The panel needs it to offer the default
      // back, and it is the only way to tell a renamed agent from one whose
      // chosen name happens to match.
      defaultName: agent.name,
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
    }))
  })

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
    // A state with no owner belongs to a sign-in, not to a connection. It
    // cannot be completed here, and quietly treating it as one would attach
    // someone's mailbox token to nobody.
    if (!consumed.userId || !consumed.workspaceId) {
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
    if (provider !== 'google' && provider !== 'apple' && provider !== 'microsoft') {
      return reply.status(404).send({ error: 'Unknown sign-in provider' })
    }

    try {
      const url = await startSignIn(provider, (request.query as { returnTo?: string }).returnTo)
      return { url }
    } catch (err) {
      /*
       * Never hand the browser the raw failure.
       *
       * This route once returned err.message straight through, so a failing
       * INSERT put the whole statement - table, columns, parameter values -
       * on the sign-in screen. It told an attacker the schema and told the
       * user nothing they could act on.
       *
       * "Not configured" is a deliberate exception: it is the one cause a
       * person can actually do something about.
       */
      request.log.error({ err, provider }, 'sign-in could not be started')
      const notConfigured = err instanceof Error && /not configured/i.test(err.message)
      return reply.status(notConfigured ? 409 : 500).send({
        error: notConfigured
          ? `${PROVIDER_NAMES[provider]} sign-in is not set up on this deployment yet.`
          : 'Could not start sign-in. Please try again.',
      })
    }
  })

  // ------------------------------------------------- email and password --


  const PROVIDER_NAMES: Record<string, string> = {
    google: 'Google',
    apple: 'Apple',
    microsoft: 'Microsoft',
  }

  const registration = z.object({
    name: z.string().min(1, 'Your name is required').max(120),
    email: z.email('Enter a valid email address').max(254),
    password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
    phone: z.string().max(40).optional(),
  })

  /** Issue the session cookie both password routes end with. */
  const signInAs = async (
    reply: FastifyReply,
    who: { userId: string; workspaceId: string },
    request: FastifyRequest,
  ) => {
    const { token, expiresAt } = await issueSession({
      ...who,
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    })

    return reply
      .setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config().NODE_ENV === 'production',
        path: '/',
        expires: expiresAt,
      })
      .send({ signedIn: true })
  }

  app.post('/auth/register', async (request, reply) => {
    const body = registration.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({
        error: body.error.issues[0]?.message ?? 'Check the details and try again.',
      })
    }

    try {
      return await signInAs(reply, await register(body.data), request)
    } catch (err) {
      if (err instanceof AuthError) return reply.status(err.status).send({ error: err.message })
      request.log.error({ err }, 'registration failed')
      return reply.status(500).send({ error: 'Could not create your account. Please try again.' })
    }
  })

  app.post('/auth/login', async (request, reply) => {
    const body = z
      .object({ email: z.string().min(1).max(254), password: z.string().min(1).max(200) })
      .safeParse(request.body)

    if (!body.success) {
      return reply.status(400).send({ error: 'Enter your email and password.' })
    }

    try {
      return await signInAs(reply, await login(body.data.email, body.data.password), request)
    } catch (err) {
      if (err instanceof AuthError) return reply.status(err.status).send({ error: err.message })
      request.log.error({ err }, 'login failed')
      return reply.status(500).send({ error: 'Could not sign you in. Please try again.' })
    }
  })

  /**
   * The sign-in callback.
   *
   * Registered twice: Google and Microsoft redirect back with a GET, but
   * Apple insists on a form POST whenever the request asked for name or
   * email. Same handler either way, reading the payload from whichever side
   * of the request carries it.
   */
  const handleSignInCallback = async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider } = request.params as { provider: string }
    const source = { ...(request.query as object), ...(request.body as object | undefined) }
    const query = source as { code?: string; state?: string; error?: string }
    const appUrl = config().APP_URL.replace(/\/$/, '')

    if (provider !== 'google' && provider !== 'apple' && provider !== 'microsoft') {
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
  }

  app.get('/auth/:provider/signin-callback', handleSignInCallback)
  app.post('/auth/:provider/signin-callback', handleSignInCallback)

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

  /**
   * The integration catalogue, merged with this workspace's live connections.
   *
   * Status is computed per request rather than stored on the catalogue: a
   * deployment without Slack credentials must not offer a Connect button that
   * cannot complete, and a workspace that has already connected Google should
   * see Gmail and Calendar as connected without either being re-declared.
   */
  app.get('/integrations', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const connections = await listConnections(ctx.workspaceId)
      const agentNames = await listAgentNames(ctx.workspaceId)

      return INTEGRATIONS.map((integration) => {
        // A provider token is shared across the integrations that sit on it -
        // Gmail, Calendar and Drive are all one Google grant. But an
        // integration with nothing built behind it must never report itself
        // connected off the back of a sibling's token: the user would reach
        // for a capability that does not exist.
        const connection =
          integration.provider && integration.status === 'available'
            ? connections.find((c) => c.provider === integration.provider)
            : undefined

        const configured =
          integration.provider !== null && isConfigured(integration.provider)

        const status: string =
          integration.status !== 'available'
            ? 'planned'
            : configured
              ? 'available'
              : 'blocked'

        return {
          ...integration,
          icon: integrationIcon(integration.id),
          status,
          statusNote:
            status === 'blocked'
              ? 'Not configured on this deployment yet.'
              : integration.statusNote,
          connection: connection
            ? {
                id: connection.id,
                accountLabel: connection.accountLabel,
                connectedAt: connection.connectedAt,
              }
            : null,
          capabilities: capabilitiesFor(integration).map((c) => ({
            id: c.id,
            label: c.label,
            description: c.description,
          })),
          permissions: permissionsFor(integration),
          // Renamed agents are renamed everywhere. Seeing "Finance Agent" here
          // and "Muse" on the island would read as two different agents.
          agents: agentsWithAccess(integration).map((a) => ({
            ...a,
            agentName: agentNames[a.agentKey] ?? a.agentName,
          })),
        }
      })
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  /**
   * A request for an integration that does not exist yet.
   *
   * Recorded rather than emailed: what matters is knowing which integrations
   * customers keep asking for, and a row is easier to count than an inbox.
   */
  const toolRequest = z.object({
    name: z.string().min(1).max(120),
    reason: z.string().max(1000).optional(),
  })

  app.post('/integrations/requests', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const body = toolRequest.safeParse(request.body)
      if (!body.success) return reply.status(400).send({ error: 'A tool name is required' })

      request.log.info(
        { workspaceId: ctx.workspaceId, tool: body.data.name, reason: body.data.reason },
        'integration requested',
      )

      return { received: true, name: body.data.name }
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

      /*
       * The gate, and the only one.
       *
       * It sits here - before runGoal, before a single token is bought -
       * because anywhere later is not a limit. The goal row is written first
       * so the refusal is recorded against something and the user can see in
       * History that they asked and why it did not run.
       */
      const spend = await spendForGoal(ctx.workspaceId, goal.id)
      if (!spend.ok) {
        await db()
          .update(schema.goals)
          .set({ state: 'failed', error: spend.reason, completedAt: new Date() })
          .where(eq(schema.goals.id, goal.id))
          .catch(() => undefined)

        // 402 rather than 403: this is not "you may not", it is "not yet".
        return reply.status(402).send({ error: spend.reason, upgrade: true })
      }

      void runGoal(deps, {
        goalId: goal.id,
        workspaceId: ctx.workspaceId,
        prompt: body.data.prompt,
        timezone: body.data.timezone,
        billing: spend.plan,
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

  /**
   * History: past goals with everything the list needs to render a row.
   *
   * Three queries regardless of how many goals come back, rather than one per
   * goal for its agents and another for its tools. At fifty rows that is the
   * difference between three round trips and a hundred and fifty.
   *
   * Every field is stored fact. Duration is completedAt minus createdAt and is
   * null while a goal is still running - an in-flight goal has no duration yet,
   * and inventing one would be the first lie on a screen whose whole job is to
   * be the record.
   */
  app.get('/history', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const days = Number((request.query as { days?: string }).days)
      const since =
        Number.isFinite(days) && days > 0
          ? new Date(Date.now() - days * 86_400_000)
          : null

      const goals = await db()
        .select({
          id: schema.goals.id,
          prompt: schema.goals.prompt,
          state: schema.goals.state,
          summary: schema.goals.summary,
          error: schema.goals.error,
          createdAt: schema.goals.createdAt,
          completedAt: schema.goals.completedAt,
        })
        .from(schema.goals)
        .where(
          since
            ? and(
                eq(schema.goals.workspaceId, ctx.workspaceId),
                gte(schema.goals.createdAt, since),
              )
            : eq(schema.goals.workspaceId, ctx.workspaceId),
        )
        .orderBy(desc(schema.goals.createdAt))
        .limit(100)

      if (goals.length === 0) return []

      const ids = goals.map((g) => g.id)

      const [taskRows, toolRows, artifactRows] = await Promise.all([
        db()
          .select({
            goalId: schema.tasks.goalId,
            agentKey: schema.tasks.agentKey,
            title: schema.tasks.title,
            state: schema.tasks.state,
          })
          .from(schema.tasks)
          .where(inArray(schema.tasks.goalId, ids)),
        // Tool calls hang off a run, and a run knows its goal.
        db()
          .select({ goalId: schema.agentRuns.goalId, toolId: schema.toolCalls.toolId })
          .from(schema.toolCalls)
          .innerJoin(schema.agentRuns, eq(schema.toolCalls.runId, schema.agentRuns.id))
          .where(inArray(schema.agentRuns.goalId, ids)),
        db()
          .select({
            goalId: schema.artifacts.goalId,
            id: schema.artifacts.id,
            title: schema.artifacts.title,
            kind: schema.artifacts.kind,
          })
          .from(schema.artifacts)
          .where(inArray(schema.artifacts.goalId, ids)),
      ])

      /** Group rows by goal, preserving first-seen order. */
      const group = <T, K>(rows: T[], goalId: (r: T) => string, pick: (r: T) => K) => {
        const out = new Map<string, K[]>()
        for (const row of rows) {
          const list = out.get(goalId(row)) ?? []
          list.push(pick(row))
          out.set(goalId(row), list)
        }
        return out
      }

      const tasksByGoal = group(taskRows, (r) => r.goalId, (r) => r)
      const toolsByGoal = group(toolRows, (r) => r.goalId, (r) => r.toolId)
      const artifactsByGoal = group(artifactRows, (r) => r.goalId, (r) => ({
        id: r.id,
        title: r.title,
        kind: r.kind,
      }))

      return goals.map((goal) => {
        const tasks = tasksByGoal.get(goal.id) ?? []
        return {
          id: goal.id,
          prompt: goal.prompt,
          state: goal.state,
          summary: goal.summary,
          error: goal.error,
          createdAt: goal.createdAt,
          completedAt: goal.completedAt,
          durationMs:
            goal.completedAt
              ? goal.completedAt.getTime() - goal.createdAt.getTime()
              : null,
          agentKeys: [...new Set(tasks.map((t) => t.agentKey))],
          toolIds: [...new Set(toolsByGoal.get(goal.id) ?? [])],
          taskCount: tasks.length,
          tasksDone: tasks.filter((t) => t.state === 'succeeded').length,
          taskTitles: tasks.map((t) => t.title),
          artifacts: artifactsByGoal.get(goal.id) ?? [],
        }
      })
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  // ------------------------------------------------ agent instructions --

  /** Every agent's workspace instructions, keyed by agent. */
  app.get('/agents/instructions', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      return await listInstructions(ctx.workspaceId)
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  app.put('/agents/:key/instructions', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const { key } = request.params as { key: string }

      // Only agents that exist. A typo would otherwise write a row that never
      // reaches a run, and look like the feature silently not working.
      if (!AGENT_REGISTRY.some((a) => a.key === key)) {
        return reply.status(404).send({ error: 'Unknown agent' })
      }

      const body = z
        .object({ instructions: z.string().max(MAX_INSTRUCTION_LENGTH) })
        .safeParse(request.body)

      if (!body.success) {
        return reply.status(400).send({
          error: `Instructions must be ${MAX_INSTRUCTION_LENGTH} characters or fewer.`,
        })
      }

      await setInstructions(ctx.workspaceId, key, body.data.instructions)
      return { saved: true }
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  /**
   * Rename an agent, for this workspace only.
   *
   * The roster itself is code, so this does not edit it: it records what one
   * workspace calls one of its agents, and the roster is read through that.
   * Another customer's Finance Agent is unaffected, and the agent's key - what
   * events, tasks and history are written against - never moves.
   *
   * An empty name is not a failure. It means "use the built-in name again",
   * which is the only way back once someone has renamed something.
   */
  app.put('/agents/:key/name', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const { key } = request.params as { key: string }

      const agent = AGENT_REGISTRY.find((a) => a.key === key)
      if (!agent) {
        return reply.status(404).send({ error: 'Unknown agent' })
      }

      const body = z.object({ name: z.string() }).safeParse(request.body)
      if (!body.success) {
        return reply.status(400).send({ error: 'A name is required.' })
      }

      // Measured after tidying, not before: a name padded out with spaces is
      // not 40 characters long, and rejecting it would be rejecting something
      // the user cannot see.
      const tidied = normaliseAgentName(body.data.name)
      if (tidied && tidied.length > MAX_AGENT_NAME_LENGTH) {
        return reply.status(400).send({
          error: `That name is too long. Keep it to ${MAX_AGENT_NAME_LENGTH} characters or fewer.`,
        })
      }

      const saved = await setAgentName(ctx.workspaceId, key, body.data.name)
      return { name: saved ?? agent.name, isDefault: saved === null }
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  // ------------------------------------------------------------- usage --

  /**
   * What this workspace has spent this month.
   *
   * Counted from agent_runs, which records tokens per run, and from goals -
   * both stored facts. Nothing here is estimated: a usage meter that guesses
   * is worse than no meter, because a person will budget against it.
   */
  /**
   * What this workspace may spend, and the statement behind it.
   *
   * Read by the command bar before it lets someone type, and by the account
   * menu. The plan itself comes back whole rather than as a name, so the
   * client never has to hold its own copy of what a plan includes.
   */
  app.get('/billing', async (request, reply) => {
    try {
      const ctx = await authenticate(request)
      const [balance, ledger] = await Promise.all([
        balanceOf(ctx.workspaceId),
        ledgerFor(ctx.workspaceId, 20),
      ])

      return {
        ...balance,
        ledger: ledger.map((entry) => ({
          id: entry.id,
          delta: entry.delta,
          reason: entry.reason,
          balanceAfter: entry.balanceAfter,
          note: entry.note,
          at: entry.createdAt.toISOString(),
        })),
      }
    } catch (err) {
      return respondWithError(reply, err)
    }
  })

  app.get('/usage', async (request, reply) => {
    try {
      const ctx = await authenticate(request)

      const now = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

      const [runs, goals] = await Promise.all([
        db()
          .select({
            inputTokens: schema.agentRuns.inputTokens,
            outputTokens: schema.agentRuns.outputTokens,
            startedAt: schema.agentRuns.startedAt,
            completedAt: schema.agentRuns.completedAt,
          })
          .from(schema.agentRuns)
          .where(
            and(
              eq(schema.agentRuns.workspaceId, ctx.workspaceId),
              gte(schema.agentRuns.startedAt, monthStart),
            ),
          ),
        db()
          .select({ id: schema.goals.id, state: schema.goals.state })
          .from(schema.goals)
          .where(
            and(
              eq(schema.goals.workspaceId, ctx.workspaceId),
              gte(schema.goals.createdAt, monthStart),
            ),
          ),
      ])

      const inputTokens = runs.reduce((n, r) => n + r.inputTokens, 0)
      const outputTokens = runs.reduce((n, r) => n + r.outputTokens, 0)

      // Agent time is wall-clock across finished runs. Runs overlap when waves
      // dispatch in parallel, so this is time worked, not elapsed - which is
      // the number that answers "how much did my workforce do".
      const agentMs = runs.reduce(
        (ms, r) =>
          r.completedAt ? ms + (r.completedAt.getTime() - r.startedAt.getTime()) : ms,
        0,
      )

      return {
        monthStart: monthStart.toISOString(),
        inputTokens,
        outputTokens,
        // One credit = one thousand tokens. Stated in the response so the
        // client never invents its own conversion.
        creditsUsed: Math.round((inputTokens + outputTokens) / 1000),
        tokensPerCredit: 1000,
        agentMinutes: Math.round(agentMs / 60_000),
        goalsRun: goals.length,
        goalsCompleted: goals.filter((g) => g.state === 'completed').length,
        plan: 'Pro plan',
      }
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
