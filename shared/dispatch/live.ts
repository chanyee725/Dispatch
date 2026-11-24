// Live agent view (E559, issue #728; design docs/design/agent-live-view.md). Built by server/dispatch/live.js from the
// hub's in-memory tool entries, metadata only (never transcript text, tool input bodies or output), never on disk.
//   GET /api/sessions/:id/live -> { session, live: AgentLive }   (404 for an unknown id)
//   SSE `live` on /api/events -> LiveDelta, coalesced per session, at most one every 250 ms (4/s)

export type LiveKind = 'read' | 'edit' | 'command' | 'test' | 'build' | 'search' | 'browser' | 'team' | 'other';

export interface LiveAction {
  /** Transcript entry id of the tool call (unique per session). */
  id: number;
  at: number;
  kind: LiveKind;
  /** activityOf(name, text): "파일 수정", "단위 테스트". */
  label: string;
  /** Tool name without the MCP prefix: "Edit", "Bash", "browser_snapshot". */
  tool: string;
  /** Shown path, or a command's first line (masked, clipped to 80); '' when there is none. */
  target: string;
  /** Set when the call's result arrives; absent while it runs. */
  ok?: boolean;
  endedAt?: number;
}

export interface LiveFile {
  /** Workspace-relative for Drawing documents, else relative to the session's folder, else the basename only. */
  path: string;
  edited: boolean;
  at: number;
  /** A workspace document (`.dpx.json`) that opens in Drawing. */
  doc: boolean;
  /** Outside the workspace and the session's folder (only its basename is kept): shown, never linked. */
  outside?: boolean;
}

export interface AgentLive {
  sid: string;
  /** The running tool call, null between tools. */
  current: LiveAction | null;
  /** Newest first, at most 12. */
  recent: LiveAction[];
  /** Newest first, at most 30. */
  files: LiveFile[];
}

/** One `live` event: only what changed. `current` present = replaced (null = nothing running); actions/files upsert by id/path, newest first. */
export interface LiveDelta {
  sid: string;
  current?: LiveAction | null;
  actions?: LiveAction[];
  files?: LiveFile[];
}

export const LIVE_RECENT = 12;
export const LIVE_FILES = 30;

/** Applies one `live` event to a snapshot (client side); returns a new object. */
export function applyLiveDelta(live: AgentLive, d: LiveDelta): AgentLive {
  if (d.sid !== live.sid) return live;
  let { current, recent, files } = live;
  if (d.current !== undefined) current = d.current;
  if (d.actions?.length) {
    const byId = new Map(recent.map(a => [a.id, a]));
    for (const a of d.actions) byId.set(a.id, a);
    recent = [...byId.values()].sort((a, b) => b.id - a.id).slice(0, LIVE_RECENT);
    // A finished action also updates `current` when it is the one shown there.
    if (current) { const fresh = byId.get(current.id); if (fresh?.endedAt) current = null; else if (fresh) current = fresh; }
  }
  if (d.files?.length) {
    const changed = new Set(d.files.map(f => f.path));
    files = [...d.files, ...files.filter(f => !changed.has(f.path))].slice(0, LIVE_FILES);
  }
  return { sid: live.sid, current, recent, files };
}
