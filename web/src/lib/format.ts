import type { BurnWarn, SessionState, Status, Usage } from "@/types";

export const fmtK = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
export const fmtUsd = (n: number | null | undefined) => (n == null ? "—" : "$" + n.toFixed(n < 10 ? 3 : 2));
export const pct = (x: number | null | undefined) => (x == null || !isFinite(x) ? "—" : Math.round(x * 100) + "%");
export const totalTok = (u: Usage) => u.input + u.output + u.cacheRead + u.cacheWrite;
export const isOpen = (s: { status: Status }) => s.status !== "done" && s.status !== "error";
export const level = (x: number | null | undefined) => (x == null ? "none" : x >= 0.9 ? "bad" : x >= 0.75 ? "warn" : "ok");

export function until(t: number | null) {
  if (!t) return "—";
  const m = Math.max(0, Math.round((t - Date.now()) / 60e3));
  if (m >= 1440) return `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간`;
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return `${m}분`;
}

export function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60e3);
  if (m < 1) return "방금";
  if (m >= 1440) return `${Math.floor(m / 1440)}일 전`;
  if (m >= 60) return `${Math.floor(m / 60)}시간 전`;
  return `${m}분 전`;
}

// Labels and colours for the server-decided states. The shape (icon) is chosen in StatusBadge, so a
// badge never relies on colour alone.
export const STATE: Record<SessionState, { label: string; color: string }> = {
  working: { label: "작업 중", color: "var(--ok)" },
  waiting: { label: "사람 기다림", color: "var(--warn)" },
  stuck: { label: "멈춤", color: "var(--warn)" },
  failed: { label: "실패", color: "var(--bad)" },
  resting: { label: "쉼", color: "var(--idle)" },
  done: { label: "완료", color: "var(--idle)" },
};

const FROM_STATUS: Record<Status, SessionState> = {
  starting: "working", running: "working", waiting: "waiting", idle: "resting", done: "done", error: "failed",
};
/** The session's state, falling back to its raw status when the server is older than the state model. */
export const stateOf = (s: { status: Status; state?: SessionState }): SessionState => s.state ?? FROM_STATUS[s.status] ?? "resting";

export const PERM_LABEL: Record<string, string> = {
  manual: "매번 승인",
  acceptEdits: "편집 자동 승인",
  auto: "자동",
  plan: "계획만 (읽기 전용)",
};

const ROLE_VARS = ["lead", "impl", "review", "test", "design", "docs"];
export const roleColor = (id: string) => (ROLE_VARS.includes(id) ? `var(--role-${id})` : "var(--muted-foreground)");

export const LEVEL_COLOR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", none: "var(--muted-foreground)" };

/** "$2.10/h"-style rate; "—" when there is no rate. */
export const fmtRate = (n: number | null | undefined) => (n == null ? "—" : `${fmtUsd(n)}/h`);

/** The burnWarn codes as sentences: the reasons, then the advice (when there is one). */
export function burnWarnText(w: BurnWarn): { reasons: string[]; advice: string | null } {
  const reasons = w.reasons.map(r =>
    r === "spike" ? `시간당 비용이 팀 중앙값(${fmtRate(w.medianPerHour)})의 ${w.ratio}배예요`
      : `컨텍스트 ${pct(w.ctxShare)}로 ${w.hours}시간째 이어지고 있어요`);
  const advice = w.advice === "swapLead" ? "새 관리자 세션으로 교대하는 게 좋아요" : null;
  return { reasons, advice };
}
