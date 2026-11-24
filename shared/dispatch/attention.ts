// What needs a person right now, gathered for the attention strip at the top of 세션.
// Pure and free of "@/" imports so the server's node test runner can load it (type imports are erased).
import type { Limits, Session, SessionState } from "./types.ts";

export interface MergeCheck {
  ok: boolean | null; commit: string | null; base: string | null; reason: string | null; at: number;
  /** Set by the server's auto close (#930): which evidence closed it and a short sentence about it. */
  auto?: boolean; via?: "commit" | "pr" | "issue"; evidence?: string;
}
/** The task fields the strip reads; the board's task type plus the server's merge check. */
export interface AttentionTask {
  id: string; lead: string | null; title: string; stage: string; owner: string | null;
  etaAt: number | null; mergeCheck?: MergeCheck | null;
  /** etaAt is the server's guess (#1028); passing a guess shows on the row only, not here. */
  etaEstimated?: boolean;
  /** Last change the lead made (server/dispatch/hub.js setTask); older servers may leave it out. */
  updatedAt?: number;
  /** Server's flag (server/state.js taskStuck); absent or null while the task looks fine. */
  stuck?: TaskStuck | null;
  /** Why the server's auto close (#930, server/dispatch/task-close.js) left this open task as it is. */
  autoCheck?: { reason: string; at: number } | null;
}

/** server/state.js taskStuck: past 1.5× the estimate, or the board stage disagrees with what the owner does. */
export interface TaskStuck {
  reason: "stage-mismatch" | "over-eta";
  /** Korean sentence for people ("예상 20분의 1.5배를 넘겼어요"). */
  label: string;
  stage: string;
  sinceMs: number | null;
  activity?: string; count?: number; etaMinutes?: number;
}

/** Usage-limit guard thresholds (settings.guard): at or past them a limit row is urgent. */
export interface LimitGuard { five: number; seven: number }

export type AttentionKind = "session" | "late" | "mismatch" | "limit" | "merge";
export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  level: "bad" | "warn";
  /** Session state for session rows, so the row shows the same shape + label as the card. */
  state?: SessionState;
  /** Who or what: a session name, a task title, "Claude 5시간 한도". */
  who: string;
  role?: string;
  reason: string;
  /** Start of the problem (for "N분째"); null when unknown. */
  since: number | null;
  /** Limit rows: when the window resets. */
  resetAt?: number | null;
  /** Session to open from the row; limit rows go to the usage page instead. */
  sessionId?: string | null;
  /** The server's stuck flag stands behind the row (session state "stuck", task stuck), not a client guess. */
  flagged?: boolean;
  /** Limit rows: rounded percent used, the same number the row shows. */
  used?: number;
}

export const LIMIT_WARN = 0.75;
/** Used when no guard settings are loaded; the server's defaults. */
export const DEFAULT_GUARD: LimitGuard = { five: 0.9, seven: 0.85 };
/** A task row nobody has touched for this long, with no one working on it, no longer says what is going on (#897). */
export const STALE_TASK_MS = 12 * 3600_000;
const pct = (x: number) => Math.round(x * 100);
const ACTIVE: SessionState[] = ["failed", "waiting", "stuck"];

/** Fallback for servers that predate `attention`: the same rules as server/state.js attentionOf. */
function sessionAttention(s: Session, state: SessionState) {
  if (s.attention !== undefined) return s.attention;
  if (state === "failed") return { level: "bad" as const, reason: "오류로 멈췄어요", since: s.stateSince ?? s.updatedAt };
  if (state === "waiting") return { level: "warn" as const, reason: s.pending.length ? "권한 승인을 기다려요" : "사용자 답을 기다려요", since: s.stateSince ?? s.updatedAt };
  if (state === "stuck") return { level: "warn" as const, reason: s.stuck?.label || "멈춘 것 같아요", since: s.stuck?.sinceMs ?? s.stateSince ?? s.updatedAt };
  return null;
}

/** First open session whose name appears as a word in the owner text ("Remy", "Remy·Ivo"). */
function ownerSession(owner: string | null, sessions: Session[]) {
  if (!owner) return null;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sessions.find(s => s.status !== "done" && new RegExp(`(^|[^\\p{L}\\d])${esc(s.name)}($|[^\\p{L}\\d])`, "u").test(owner)) ?? null;
}

const busy = (s: Session | null | undefined) => s?.status === "running" || s?.status === "starting";

/**
 * Whether a task's late or merge row no longer matches what is going on (#897): its lead has ended (done or error,
 * so no one is left to close it), or nobody changed it for STALE_TASK_MS while neither its lead nor its owner works.
 * Such rows sat in the strip for days ("17시간 지연" on work merged long ago). The 작업 보드 still lists the task.
 */
export function staleTask(t: AttentionTask, lead: Session | null | undefined, owner: Session | null, now: number) {
  if (lead && (lead.status === "done" || lead.status === "error")) return true;
  const last = Math.max(t.updatedAt ?? 0, t.mergeCheck?.at ?? 0);
  return last > 0 && now - last > STALE_TASK_MS && !busy(lead) && !busy(owner);
}

/**
 * Rows for the strip, most urgent first: `bad` before `warn`, then the longest-standing.
 * `stateOf` is passed in so this file stays free of app imports.
 */
export function attentionItems(
  { sessions, tasks, limits, guard, now, stateOf }:
  { sessions: Session[]; tasks: AttentionTask[]; limits: Limits | null; guard?: LimitGuard | null; now: number; stateOf: (s: Session) => SessionState },
): AttentionItem[] {
  const out: AttentionItem[] = [];

  for (const s of sessions) {
    const state = stateOf(s);
    const a = ACTIVE.includes(state) ? sessionAttention(s, state) : null;
    if (a) {
      out.push({ key: `s:${s.id}`, kind: "session", level: a.level, state, who: s.name, role: s.role, reason: a.reason, since: a.since, sessionId: s.id, flagged: state === "stuck" });
    } else if (s.stall && state !== "done") {
      // Watchdog flag on an otherwise quiet session (no lead hears it, or the team idles).
      out.push({ key: `s:${s.id}`, kind: "session", level: "warn", state: "stuck", who: s.name, role: s.role, reason: s.stall.reason, since: s.stall.since, sessionId: s.id });
    }
  }

  for (const t of tasks) {
    if (t.stage === "done") continue;
    const owner = ownerSession(t.owner, sessions);
    if (staleTask(t, t.lead ? sessions.find(s => s.id === t.lead) : null, owner, now)) continue;
    const target = owner?.id ?? t.lead;
    if (t.mergeCheck?.ok === false) {
      out.push({ key: `m:${t.id}`, kind: "merge", level: "bad", who: t.title, reason: t.mergeCheck.reason || "병합을 확인하지 못했어요", since: t.mergeCheck.at, sessionId: t.lead ?? target });
    }
    // One row per task. A stage mismatch adds nothing only when the owner session was found and its row is
    // the repeat-fail flag about the same loop; any other row (waiting, silent, the lead fallback) says something else.
    const st = t.stuck;
    const by = (x: string) => (t.owner ? `${x} · ${t.owner}` : x);
    const folded = owner?.stuck?.reason === "repeat-fail" && out.some(i => i.kind === "session" && i.sessionId === owner.id);
    if (st?.reason === "stage-mismatch" && !folded) {
      out.push({ key: `t:${t.id}`, kind: "mismatch", level: "warn", who: t.title, reason: by(st.label), since: st.sinceMs ?? null, sessionId: target, flagged: true });
    } else if (st?.reason === "over-eta" || (t.etaAt != null && t.etaAt < now && !t.etaEstimated)) {
      // Lateness counts from the estimate either way; the server's sentence says how far past it is.
      // The auto close found no evidence it landed (#930): say why, so the reader knows to check it by hand.
      const base = st?.reason === "over-eta" ? st.label : "예상 시간을 넘겼어요";
      const reason = t.autoCheck?.reason ? `${base} · ${t.autoCheck.reason}` : base;
      out.push({ key: `t:${t.id}`, kind: "late", level: "warn", who: t.title, reason: by(reason), since: t.etaAt ?? st?.sinceMs ?? null, sessionId: target, flagged: st?.reason === "over-eta" });
    }
  }

  if (limits) {
    const windows = [
      { id: "five", guard: "five" as const, label: "Claude 5시간 한도", value: limits.five, reset: limits.fiveReset },
      { id: "seven", guard: "seven" as const, label: "Claude 주간 한도", value: limits.seven, reset: limits.sevenReset },
      { id: "fable", guard: "seven" as const, label: "Fable 주간 한도", value: limits.fable ?? null, reset: limits.fableReset ?? null },
    ];
    for (const w of windows) {
      // A window past its reset time is stale until the next poll; it has already started over.
      if (w.value == null || (w.reset && w.reset <= now)) continue;
      // One rounded number decides the colour and is what the row shows, so "90%" is never amber.
      const used = pct(w.value);
      const urgent = pct((guard ?? DEFAULT_GUARD)[w.guard]);
      if (used < Math.min(pct(LIMIT_WARN), urgent)) continue;
      out.push({
        key: `l:${w.id}`, kind: "limit", level: used >= urgent ? "bad" : "warn", who: w.label,
        reason: `${used}% 썼어요`, since: null, resetAt: w.reset, used,
      });
    }
  }

  const rank = (i: AttentionItem) => (i.level === "bad" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || (a.since ?? Infinity) - (b.since ?? Infinity));
}

/** How long a row has stood: "8분", "1시간 12분", "2일"; "" under a minute; null when unknown. */
export function elapsed(since: number | null, now: number) {
  if (since == null) return null;
  const m = Math.floor(Math.max(0, now - since) / 60_000);
  if (m < 1) return "";
  if (m >= 1440) return `${Math.floor(m / 1440)}일`;
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return `${m}분`;
}
