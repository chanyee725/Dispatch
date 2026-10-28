import type { Status, Usage } from "@/types";

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

export const STATUS: Record<Status, { label: string; color: string }> = {
  starting: { label: "시작 중", color: "var(--idle)" },
  running: { label: "실행 중", color: "var(--ok)" },
  waiting: { label: "승인 대기", color: "var(--warn)" },
  idle: { label: "대기", color: "var(--idle)" },
  done: { label: "완료", color: "var(--muted-foreground)" },
  error: { label: "오류", color: "var(--bad)" },
};

export const PERM_LABEL: Record<string, string> = {
  manual: "매번 승인",
  acceptEdits: "편집 자동 승인",
  auto: "자동",
  plan: "계획만 (읽기 전용)",
};

const ROLE_VARS = ["lead", "impl", "review", "test", "design", "docs"];
export const roleColor = (id: string) => (ROLE_VARS.includes(id) ? `var(--role-${id})` : "var(--muted-foreground)");

export const LEVEL_COLOR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", none: "var(--muted-foreground)" };
