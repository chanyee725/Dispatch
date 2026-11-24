// What the 정보 tab shows as 역할 프롬프트 (#943). A session's own prompt lives in server memory only (MEMORY_ONLY in
// server/dispatch/dispatch-store.js), so after a server restart it is gone; the tab then falls back to the role's
// default prompt from the snapshot's roles (server/dispatch/roles.js) and says the task text was not kept.

export const PROMPT_CLEARED = '작업 지시는 서버 재시작 때 지워졌어요(저장하지 않아요)';

export interface ShownPrompt { text: string; fallback: boolean }

export function shownPrompt(s: { prompt?: string | null; role: string }, roles: readonly { id: string; prompt?: string }[]): ShownPrompt {
  if (s.prompt) return { text: s.prompt, fallback: false };
  // No role default either: empty text, so the sheet shows only the PROMPT_CLEARED notice (no '—' next to it).
  return { text: roles.find(r => r.id === s.role)?.prompt || '', fallback: true };
}
