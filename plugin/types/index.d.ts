// State contract of the /agents mod (hooks/agents.tsx, #755). Metadata only: the summary is the
// GET /api/agents/summary body (server/dispatch/agents-summary.js).
export type AgentsMember = {
  name: string
  role: string
  model: string
  status: 'running' | 'idle' | 'asking' | 'done' | 'failed'
  stuck: boolean
  issue: number | null
}

export type AgentsTask = {
  title: string
  stage: string
  owner: string | null
  etaAt: number | null
  late: boolean
  stuck: string | null
  updatedAt: number | null
}

export type AgentsLead = AgentsMember & {
  issues: { number: number; prs: { number: number; state?: string }[] }[]
  tasks: AgentsTask[]
  team: AgentsMember[]
}

export type AgentsSummary = {
  v: 1
  at: number
  project: { name: string }
  usage: {
    fiveHour: { used: number | null; reset: number | null }
    weekly: { used: number | null; reset: number | null }
  }
  leads: AgentsLead[]
}

export type AgentsView =
  | { kind: 'none' }
  | { kind: 'offline'; port: number; lastAt: number | null }
  | { kind: 'online'; port: number; at: number; summary: AgentsSummary }

declare module 'claude-code' {
  interface PluginState {
    atelier: { agentsView: Shaped<AgentsView>; agentsRepo: Shaped<string | null> }
  }
}
