import type { FastifyReply, FastifyRequest } from 'fastify'
import { resolveSession, SESSION_COOKIE } from '../auth/sessions.js'
import { requireMembership, type Membership } from '../auth/workspaces.js'

/**
 * Per-request identity.
 *
 * Handlers never read a workspace id out of a URL or body. They call
 * `authenticate`, which resolves the session and proves membership, and work
 * only with what it returns. That is the whole tenant boundary in one place -
 * if a handler cannot reach a workspace id any other way, it cannot serve the
 * wrong customer's data by mistake.
 */

export interface RequestContext {
  readonly userId: string
  readonly workspaceId: string
  readonly membership: Membership
}

export class Unauthenticated extends Error {
  constructor() {
    super('Sign in to continue')
    this.name = 'Unauthenticated'
  }
}

export class NoWorkspace extends Error {
  constructor() {
    super('This account is not in a workspace yet')
    this.name = 'NoWorkspace'
  }
}

export async function authenticate(request: FastifyRequest): Promise<RequestContext> {
  const session = await resolveSession(request.cookies[SESSION_COOKIE])
  if (!session) throw new Unauthenticated()
  if (!session.workspaceId) throw new NoWorkspace()

  const membership = await requireMembership(session.userId, session.workspaceId)
  return { userId: session.userId, workspaceId: session.workspaceId, membership }
}

/** Map a thrown error to a status and a message written for a person. */
export function respondWithError(reply: FastifyReply, err: unknown): FastifyReply {
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : 'Something went wrong'

  switch (name) {
    case 'Unauthenticated':
      return reply.status(401).send({ error: message })
    case 'NoWorkspace':
      return reply.status(403).send({ error: message })
    case 'NotAMemberError':
      // Deliberately the same answer a missing record gives. Telling a caller
      // that a workspace exists but is not theirs is still telling them it
      // exists.
      return reply.status(404).send({ error: 'Not found' })
    case 'InsufficientRoleError':
      return reply.status(403).send({ error: message })
    case 'ApprovalNotFoundError':
      return reply.status(404).send({ error: 'This approval is no longer pending' })
    case 'NoConnectionError':
    case 'MissingScopeError':
      return reply.status(409).send({ error: message })
    default:
      return reply.status(500).send({ error: message })
  }
}
