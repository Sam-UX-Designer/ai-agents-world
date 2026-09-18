'use client'

import type { AgentInfo } from '@/lib/api'

/**
 * Small shared pieces for History.
 *
 * Kept out of the page so the page reads as layout rather than as a pile of
 * lookup tables.
 */

/**
 * A readable name for an agent key when the roster has not loaded yet, or
 * when a past goal used an agent that no longer exists. History outlives the
 * registry - a run from last month is still a fact after the agent is renamed.
 */
export const AGENT_LABELS: Record<string, string> = {
  orchestrator: 'Orchestrator',
  general: 'General Agent',
  hr: 'HR Agent',
  finance: 'Finance Agent',
  marketing: 'Marketing Agent',
  sales: 'Sales Agent',
  operations: 'Operations Agent',
  development: 'Development Agent',
  design: 'Design Agent',
}

export function agentLabel(key: string, agents: readonly AgentInfo[]): string {
  return (
    agents.find((a) => a.key === key)?.name ??
    AGENT_LABELS[key] ??
    // Last resort for a key with no name anywhere: "some_agent" -> "Some agent".
    key.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())
  )
}

/**
 * Which service a tool belongs to.
 *
 * Tool ids are namespaced ("gmail.search"), so the prefix is the integration -
 * which is also the icon filename under public/tools/.
 */
const SERVICE_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  gcal: 'Google Calendar',
  slack: 'Slack',
  web: 'Web search',
}

const SERVICE_ICONS: Record<string, string> = {
  gcal: 'google-calendar',
}

export function ToolChip({ toolId }: { toolId: string }) {
  const service = toolId.split('.')[0] ?? toolId
  const name = SERVICE_NAMES[service] ?? service
  const icon = SERVICE_ICONS[service] ?? service

  return (
    <span className="toolchip" title={toolId}>
      {/* The uploaded logo when one exists, a lettermark until then - the same
          fallback the Tools grid uses, so a missing file never reads as a bug. */}
      <img
        className="toolchip__icon"
        src={`/tools/${icon}.png`}
        alt=""
        onError={(e) => {
          const img = e.currentTarget
          img.style.display = 'none'
          img.nextElementSibling?.removeAttribute('hidden')
        }}
      />
      <span className="toolchip__fallback" hidden aria-hidden="true">
        {name.charAt(0)}
      </span>
      {name}
    </span>
  )
}
