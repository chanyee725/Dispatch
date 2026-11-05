export type Provider = "claude" | "openai" | "gemini";
export type Status = "starting" | "running" | "waiting" | "idle" | "done" | "error";
/** Monitoring state decided by the server: what the session needs from a person. */
export type SessionState = "working" | "waiting" | "stuck" | "failed" | "resting" | "done";
export interface Attention { level: "bad" | "warn"; reason: string; since: number | null }

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
  /** Watchdog flag: a teammate no lead hears, or a whole team idle for a long time. */
  stall?: { reason: string; since: number } | null;
  /** What a running session is doing right now ("e2e 실행"), and since when; null when idle. */
  activity?: { label: string; since: number } | null;
  pending: Pending[];
  /** Server-decided state; older servers omit it (see stateOf). */
  state?: SessionState;
  /** When the session entered its current state. */
  stateSince?: number;
  /** Why a person should look (failed, waiting, stuck); null otherwise. */
  attention?: Attention | null;
  /** Per-session stuck flag (repeat-fail, silent); the server folds it into state and attention. */
  stuck?: { reason: string; label: string; sinceMs: number | null; count?: number; kind?: string } | null;
  /** $/h over the last 30 minutes (perHour null while under 5 minutes); null when the provider reports no cost. */
  burn?: { perHour: number | null; windowMin: number } | null;
  /** Why this session's spending needs a look; null otherwise. */
  burnWarn?: BurnWarn | null;
}

export interface BurnWarn {
  reasons: ("spike" | "longLived")[];
  /** spike: × the team median $/h */
  ratio?: number;
  medianPerHour?: number;
  /** longLived: context share and whole hours since start */
  ctxShare?: number;
  hours?: number;
  advice: "swapLead" | null;
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
  /** The CLI itself is logged in on this machine (independent of the Dispatch connection). */
  cliLoggedIn: boolean;
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

export interface TeamSettings {
  rotateLead: number;
  rotateOthers: number;
  maxChildren: number;
  replyStyle: boolean;
  shareDeps: boolean;
  dropWorktrees: boolean;
  roleModels: Record<string, string>;
}
export interface Settings { guard: { enabled: boolean; five: number; seven: number }; team: TeamSettings }

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
  /** Cost per session that day; missing on days recorded by older servers. */
  sessions?: Record<string, { name: string; role: string; cost: number }>;
}

export interface Diff { files: number; add: number; del: number; untracked: string[]; patch: string }
