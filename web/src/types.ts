export type Provider = "claude" | "openai";
export type Status = "starting" | "running" | "waiting" | "idle" | "done" | "error";

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface Pending {
  requestId: string;
  tool: string;
  input: unknown;
  description: string;
  suggestions: unknown[];
}

export interface Session {
  id: string;
  n: number;
  name: string;
  role: string;
  roleName: string;
  provider: Provider;
  model: string;
  modelLabel: string;
  effort: string | null;
  perm: string;
  prompt: string;
  canSpawn: boolean;
  cwd: string;
  branch: string | null;
  worktree: boolean;
  parent: string | null;
  status: Status;
  startedAt: number;
  updatedAt: number;
  last: string;
  turns: number;
  ctx: number;
  ctxWindow: number;
  usage: Usage;
  cost: number | null;
  providerSessionId: string | null;
  error: string | null;
  pending: Pending[];
}

export interface Entry {
  kind: "user" | "assistant" | "tool" | "tool_result" | "perm" | "error" | "system";
  text: string;
  name?: string;
  label?: string;
  tool?: string;
  error?: boolean;
  at: number;
}

export interface Model {
  id: string;
  label: string;
  provider: Provider;
  efforts: string[];
  defaultEffort: string | null;
  contextWindow: number;
}

export interface Role {
  id: string;
  name: string;
  model: string;
  perm: string;
  prompt: string;
  canSpawn?: boolean;
}

export interface ProviderStatus {
  name: string;
  installed: boolean;
  cli: string | null;
  connected: boolean;
  method: string | null;
  busy: boolean;
  url: string | null;
  error: string | null;
  store: string;
  run: string;
  keySupported: boolean;
}

export interface Limits {
  five: number | null;
  seven: number | null;
  fiveReset: number | null;
  sevenReset: number | null;
  updatedAt: number | null;
}

export interface Settings { guard: { enabled: boolean; five: number; seven: number } }

export interface Project { name: string; path: string; branch: string | null }

export interface Snapshot {
  project: Project;
  roles: Role[];
  perms: string[];
  models: Model[];
  providers: Record<Provider, ProviderStatus>;
  limits: Limits;
  settings: Settings;
  sessions: Session[];
}

export interface UsageDay {
  day: string;
  cost: number;
  models: Record<string, Usage & { cost: number }>;
  roles: Record<string, number>;
}

export interface Diff { files: number; add: number; del: number; untracked: string[]; patch: string }
