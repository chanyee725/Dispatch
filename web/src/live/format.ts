// Pure display helpers for the agent live view (E559, #728). No React, so tests can import them.
import type { SessionState } from '../../../shared/dispatch/types.ts';

/** "12초", "12분", "1시간 4분". */
export function span(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

/** A running tool's own clock: "0:42", "12:05", "1:02:03". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** "14:02" (local time). */
export function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Middle truncation for paths and commands: "server/…/app.js". The full value goes in `title`. */
export function middle(s: string, max = 44): string {
  if (s.length <= max) return s;
  const keep = max - 1;
  const tail = Math.ceil(keep * 0.6);
  return `${s.slice(0, keep - tail)}…${s.slice(s.length - tail)}`;
}

const LABEL: Record<SessionState, string> = {
  working: '작업 중',
  waiting: '사람 기다림',
  stuck: '멈춤',
  failed: '실패',
  resting: '쉼',
  done: '끝났어요',
};

/** The status words (the board's, plus 생각 중 while working with no tool running). */
export function liveStateLabel(state: SessionState, running: boolean): string {
  if (state === 'working' && !running) return '생각 중';
  return LABEL[state] ?? LABEL.resting;
}

/** Tone class of the status dot. */
export function liveStateTone(state: SessionState): 'ok' | 'warn' | 'bad' | 'idle' {
  return state === 'working' ? 'ok' : state === 'waiting' || state === 'stuck' ? 'warn' : state === 'failed' ? 'bad' : 'idle';
}

/** Whether the clocks still move: frozen once the session ended or stopped. */
export const ticking = (state: SessionState) => state !== 'done' && state !== 'failed';

/**
 * What a waiting session waits for (#886): a permission prompt, or the question its turn ended with (the server's
 * redacted `ask`). Never blank, and never "권한 요청" for a question.
 */
export function waitNote(s: { pending?: readonly unknown[]; status?: string; ask?: string | null } | null): string {
  if (s && ((s.pending?.length ?? 0) > 0 || s.status === 'waiting')) return '권한 요청이 있어요';
  return s?.ask ? `답을 기다려요: ${s.ask}` : '답을 기다려요(내용 없음)';
}
