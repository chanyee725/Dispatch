// Which 확인 필요 rows interrupt with a browser notification, and when.
// Pure and free of "@/" imports so the node test runner can load it (type imports are erased).
import type { AttentionItem } from "./attention";

/** A session waiting on a person alerts once it has waited this long. */
export const WAIT_ALERT_MS = 3 * 60_000;
/** A Claude limit alerts at or past this share used (percent, as the row shows it). */
export const LIMIT_ALERT_PCT = 90;

/** The four reasons that may interrupt. Progress and completion never do. */
export type AlertReason = "wait" | "stuck" | "failed" | "limit";

export interface Alert {
  /** Same row + same reason → same key; it fires once until the condition clears. */
  key: string;
  reason: AlertReason;
  /** Session to open on click; null for limit rows. */
  sessionId: string | null;
  /** Notification title: the session name (or the limit's name). */
  title: string;
  /** One line, no transcript text. */
  body: string;
}

const BODY: Record<Exclude<AlertReason, "limit">, string> = {
  wait: `${WAIT_ALERT_MS / 60_000}분 넘게 사람을 기다려요`,
  stuck: "멈췄어요",
  failed: "오류로 끝났어요",
};

/** Task-row body: a server over-eta flag means "running long", not "stopped". */
const taskBody = (i: AttentionItem, reason: Exclude<AlertReason, "limit">) =>
  i.kind === "late" && reason === "stuck" ? "작업이 예상보다 오래 걸려요" : `작업이 ${BODY[reason]}`;

function reasonOf(i: AttentionItem, now: number): AlertReason | null {
  if (i.kind === "limit") return (i.used ?? 0) >= LIMIT_ALERT_PCT ? "limit" : null;
  if (i.kind === "session" && i.state === "failed") return "failed";
  if (i.kind === "session" && i.state === "waiting") return i.since != null && now - i.since >= WAIT_ALERT_MS ? "wait" : null;
  // Only a server stuck flag counts; a watchdog stall or a client-side "past the estimate" stays in the strip.
  if (i.flagged && (i.kind === "session" || i.kind === "late" || i.kind === "mismatch")) return "stuck";
  return null;
}

/**
 * Rows of the strip that qualify for an alert right now.
 * `nameOf` turns a session id into its name, so task rows are titled by their session, not the task text.
 */
export function alertCandidates(items: AttentionItem[], now: number, nameOf: (id: string) => string | undefined): Alert[] {
  const out: Alert[] = [];
  for (const i of items) {
    const reason = reasonOf(i, now);
    if (!reason) continue;
    const sessionId = i.kind === "limit" ? null : i.sessionId ?? null;
    const title = i.kind === "limit" ? i.who : i.kind === "session" ? i.who : (sessionId && nameOf(sessionId)) || "작업";
    const body = reason === "limit" ? `${i.used}% 썼어요` : i.kind === "session" ? BODY[reason] : taskBody(i, reason);
    out.push({ key: `${i.key}|${reason}`, reason, sessionId, title, body });
  }
  return out;
}

/**
 * Dedupe across polls. `active` is what qualifies now and becomes the next `prev`;
 * a key that dropped out of it (resolved) may fire again later.
 */
export function nextAlerts(prev: ReadonlySet<string>, candidates: Alert[]): { fire: Alert[]; active: Set<string> } {
  const active = new Set(candidates.map(a => a.key));
  return { fire: candidates.filter(a => !prev.has(a.key)), active };
}

/** Tab title with the strip's count: "(2) Dispatch", or plain "Dispatch" when nothing waits. */
export const badgeTitle = (count: number, base = "Dispatch") => (count > 0 ? `(${count}) ${base}` : base);
