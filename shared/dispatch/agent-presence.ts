// Live agent list (E528, issue #592): the agent sessions working in the workspace right now and the file each one
// holds. Built by server/cursor/agents.js (memory only, never on disk).
//   GET /api/workspace/agents[?project=<top folder>] -> AgentList
//   SSE `agents` event on /api/events -> AgentList for the whole workspace (once on connect, then on every change)

export interface AgentPresence {
  /** Hub session id, or `outside:<label>` for an outside API writer that sent `x-drawing-session`. */
  sid: string;
  /** The session's own name ("Otto"), or the outside writer's cleaned label. Never a real name or email. */
  name: string;
  /** Hub creation number (1, 2, …) and the lead that created it, for a fixed team order (#785); absent for outside writers. */
  n?: number;
  parent?: string;
  /** Role id (`impl`, `lead`, ...); '' for an outside writer. */
  role: string;
  roleName?: string;
  /** Cursor colour `#rrggbb` of the session (server/dispatch/colors.js); absent for outside writers. */
  color?: string;
  model: string | null;
  modelLabel?: string;
  /** Provider of the session's model: claude | openai | gemini. */
  provider?: string;
  /** What its current turn is doing ("코드 읽기", from the hub's tool activity); absent between turns. Memory only. */
  activity?: string;
  /** Short status label from the cursor module ("다이어그램 작성 중…", shared/dispatch/agent-status.ts); absent when idle. Memory only. */
  statusLabel?: string;
  /** Title of the pipeline step it works on (the plan diagram's node label); absent outside a running plan. */
  step?: string;
  /** Hub status: starting | running | waiting | idle (only live sessions are listed; done and error are not). */
  status: string;
  /** Monitoring state (shared/dispatch/types.ts SessionState), null when not known yet. */
  state: string | null;
  /** Top-level folder the session works in: its own folder, else the folder of the file it holds. */
  project: string | null;
  /** Workspace-relative path of the file it edited last (held now); null before its first edit. */
  file: string | null;
  /** Last activity (ms). */
  at: number | null;
  /** True for an outside API writer (no role, model or colour). */
  outside?: true;
}

export interface AgentList {
  agents: AgentPresence[];
}
