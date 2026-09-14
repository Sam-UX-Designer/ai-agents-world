import { NextResponse } from 'next/server'
import {
  AGENT_REGISTRY,
  INTEGRATIONS,
  PROVIDERS,
  TOOL_CATALOGUE,
  agentsWithAccess,
  capabilitiesFor,
  integrationIcon,
  permissionsFor,
} from '@agents-world/shared'

/**
 * Preview mode.
 *
 * These handlers only exist when `API_URL` is unset. When it is set,
 * next.config.ts registers a rewrite instead and every /api call is proxied to
 * the real backend, so none of this code is reachable.
 *
 * Why it exists: a Vercel deployment has no API behind it until one is hosted
 * separately, and until then every screen answered 404 and the app looked
 * broken. The API cannot run on Vercel - it holds WebSockets open and runs
 * agents for minutes at a time - so the honest middle ground is to serve the
 * parts of the product that are static facts about it.
 *
 * What is real here: the agent roster, the tool catalogue, the integration
 * list, and every permission - all read from `@agents-world/shared`, the same
 * module the backend reads. A capability shown here is a capability that
 * exists.
 *
 * What is not: there is no database, no session and no agent runtime, so
 * anything that would change state or run an agent says so plainly rather than
 * pretending. Running agents needs `pnpm dev` locally, or the API deployed.
 */

const PREVIEW_USER = {
  id: 'preview-user',
  email: 'preview@agents-world.app',
  name: 'Preview',
  avatarUrl: null,
}

const json = (body: unknown, status = 200) => NextResponse.json(body, { status })

/** One message, used everywhere a write would have happened. */
const needsApi = (action: string) =>
  json(
    {
      error: `${action} needs the API running. Clone the repo and run "pnpm dev", or deploy apps/api and set API_URL.`,
    },
    503,
  )

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = `/${(await params).path.join('/')}`

  switch (path) {
    case '/health':
      return json({ ok: true, mode: 'preview' })

    case '/me':
      return json({
        user: PREVIEW_USER,
        workspace: {
          id: 'preview-workspace',
          name: 'Preview Workspace',
          autonomyLevel: 'balanced',
          role: 'owner',
        },
        // Nothing is connected, because nothing can be: there is no token
        // store here. The Tools screen shows every integration as available
        // to connect, which is the truth.
        connections: [],
      })

    case '/agents':
      // The real roster, resolved the way the API resolves it.
      return json(
        AGENT_REGISTRY.map((agent) => ({
          ...agent,
          tools: agent.toolIds
            .map((id) => TOOL_CATALOGUE.find((t) => t.id === id))
            .filter((t) => t !== undefined)
            .map((t) => ({ id: t.id, label: t.label, effect: t.effect })),
        })),
      )

    case '/providers':
      return json(PROVIDERS)

    case '/integrations':
      return json(
        INTEGRATIONS.map((integration) => ({
          ...integration,
          icon: integrationIcon(integration.id),
          // Not "available": connecting needs OAuth credentials that live on
          // the API. Saying available would put a Connect button on screen
          // that cannot work.
          status: integration.status === 'available' ? 'blocked' : 'planned',
          statusNote:
            integration.status === 'available'
              ? 'Connecting needs the API running.'
              : integration.statusNote,
          connection: null,
          capabilities: capabilitiesFor(integration).map((c) => ({
            id: c.id,
            label: c.label,
            description: c.description,
          })),
          permissions: permissionsFor(integration),
          agents: agentsWithAccess(integration),
        })),
      )

    case '/goals':
      return json([])

    case '/approvals':
      return json([])

    default:
      if (path.startsWith('/connect/')) {
        return needsApi('Connecting a tool')
      }
      if (path.startsWith('/auth/')) {
        return needsApi('Signing in with Google or Microsoft')
      }
      return json({ error: `No such route: ${path}` }, 404)
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = `/${(await params).path.join('/')}`

  // A tool request is the one write that costs nothing to accept and would be
  // a shame to lose, so it is acknowledged rather than refused.
  if (path === '/integrations/requests') return json({ received: true, name: 'noted' })
  if (path === '/goals') return needsApi('Running a goal')
  return needsApi('That')
}

export async function DELETE() {
  return needsApi('That')
}
