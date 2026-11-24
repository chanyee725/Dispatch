// Types of agents-format.mjs for the hooks module (agents.tsx).
import type { AgentsView } from '../types'

export type PaneLead = {
  head: string
  status: string
  stuck: boolean
  tasks: { text: string; late: boolean; stuck: string | null }[]
  team: { text: string; status: string; stuck: boolean }[]
  issues: { text: string; prs: { label: string; href: string | null }[] }[]
}

export type PaneModel =
  | { kind: 'none' | 'offline'; text: string }
  | { kind: 'online'; title: string; usage: string[]; leads: PaneLead[] }

export function parsePort(raw: unknown): number | null
export function githubRepo(gitConfig: unknown): string | null
export function prUrl(repo: string | null, n: number): string | null
export function percent(v: unknown): string
export function duration(ms: number): string
export function usageLine(label: string, w: { used: number | null; reset: number | null } | undefined, now: number): string
export function statusLabel(status: string): string
export function stageLabel(stage: string): string
export function etaLabel(t: { etaAt: number | null } | undefined, now: number): string
export function statusLine(view: AgentsView | undefined): string | undefined
export function paneModel(view: AgentsView | undefined, repo: string | null, now: number): PaneModel
export function asSummary(body: unknown): import('../types').AgentsSummary | null
