'use client'

import type { ProviderDefinition } from '@agents-world/shared'

/**
 * What /agents returns.
 *
 * Not AgentDefinition: the server resolves `toolIds` against the shared
 * catalogue before sending, so the client receives the tools this role can
 * actually reach rather than a list of ids it would have to resolve itself.
 */
export interface AgentInfo {
  key: string
  name: string
  role: string
  instructions: string
  zone: { id: string; label: string; position: [number, number, number]; station: [number, number] }
  accent: string
  enabled: boolean
  tools: { id: string; label: string; effect: string }[]
}

/**
 * The HTTP client.
 *
 * Every call goes to this origin's /api, which Next rewrites to the backend.
 * That keeps the session cookie first-party and keeps the API's real hostname
 * out of the browser entirely.
 */

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (response.status === 204) return undefined as T

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`)
  }

  return (await response.json()) as T
}

export interface Me {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null }
  workspace: { id: string; name: string; autonomyLevel: string; role: string } | null
  connections: { id: string; provider: string; accountLabel: string }[]
}

/** What /integrations returns: the catalogue merged with live connection state. */
export interface IntegrationInfo {
  id: string
  name: string
  description: string
  category: string
  provider: string | null
  icon: string
  status: 'available' | 'planned' | 'blocked'
  statusNote: string | null
  connection: { id: string; accountLabel: string; connectedAt: string } | null
  capabilities: { id: string; label: string; description: string }[]
  permissions: { toolId: string; label: string; kind: 'read' | 'write' | 'approval'; description: string }[]
  agents: {
    agentKey: string
    agentName: string
    accent: string
    grantedCount: number
    totalCount: number
    level: 'read' | 'write' | 'act'
  }[]
}

export const api = {
  me: () => request<Me>('/me'),

  signInUrl: (provider: 'google' | 'microsoft') =>
    request<{ url: string }>(`/auth/${provider}/signin`),

  signOut: () => request<{ signedOut: boolean }>('/auth/signout', { method: 'POST' }),

  agents: () => request<AgentInfo[]>('/agents'),

  providers: () => request<ProviderDefinition[]>('/providers'),

  integrations: () => request<IntegrationInfo[]>('/integrations'),

  requestTool: (name: string, reason?: string) =>
    request<{ received: boolean; name: string }>('/integrations/requests', {
      method: 'POST',
      body: JSON.stringify({ name, reason }),
    }),

  connectUrl: (provider: string) =>
    request<{ url: string; permissions: string[] }>(`/connect/${provider}`),

  disconnect: (id: string) => request<{ revoked: boolean }>(`/connections/${id}`, { method: 'DELETE' }),

  submitGoal: (prompt: string) =>
    request<{ goalId: string }>('/goals', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        // Read from the browser so "tomorrow" resolves to the user's day, not
        // the server's.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    }),

  goals: () =>
    request<{ id: string; prompt: string; state: string; createdAt: string }[]>('/goals'),

  goal: (id: string) =>
    request<{
      goal: { id: string; prompt: string; state: string; summary: string | null; nextSeq: number }
      tasks: { id: string; title: string; agentKey: string; state: string; wave: number }[]
      runs: { taskId: string; agentKey: string; state: string; completedSteps: number }[]
      artifacts: { id: string; title: string; kind: string }[]
    }>(`/goals/${id}`),

  artifact: (id: string) =>
    request<{ id: string; title: string; kind: string; content: string | null }>(
      `/artifacts/${id}`,
    ),

  /**
   * A direct link to download an artifact.
   *
   * A URL rather than a fetch-and-blob: the browser's own download handling
   * gets the filename from Content-Disposition, streams large files without
   * holding them in memory, and shows the download in the normal place the
   * user looks for one.
   */
  artifactDownloadUrl: (id: string) => `/api/artifacts/${id}?download=1`,

  resolveApproval: (id: string, decision: 'approved' | 'rejected', remember = false) =>
    request<{ resumed: boolean }>(`/approvals/${id}`, {
      method: 'POST',
      body: JSON.stringify({ decision, remember }),
    }),

  /**
   * Fetch spoken audio for a reply.
   *
   * Returns null on 204, which is what the server sends when voice is not
   * configured. The caller shows the text and plays nothing - a missing voice
   * is never an error the user has to see.
   */
  speak: async (text: string): Promise<Blob | null> => {
    const response = await fetch('/api/speak', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (response.status === 204 || !response.ok) return null
    return response.blob()
  },
}

export { ApiError }
