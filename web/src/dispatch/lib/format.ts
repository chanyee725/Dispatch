// Number, time and label formatting for the Dispatch screens. Pure: node --test loads it directly.
import { whenLabel } from '../../lib/when.ts';
import type { BurnWarn, SessionState, Status, Usage } from '../../../../shared/dispatch/types.ts';

export const fmtK = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
export const fmtUsd = (n: number | null | undefined) => (n == null ? '—' : '$' + n.toFixed(n < 10 ? 3 : 2));
export const pct = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : Math.round(x * 100) + '%');
export const totalTok = (u: Usage) => u.input + u.output + u.cacheRead + u.cacheWrite;
export const isOpen = (s: { status: Status }) => s.status !== 'done' && s.status !== 'error';
export type Level = 'none' | 'ok' | 'warn' | 'bad';
export const level = (x: number | null | undefined): Level => (x == null ? 'none' : x >= 0.9 ? 'bad' : x >= 0.75 ? 'warn' : 'ok');

/** Display names per provider id. Old saved sessions may still say openai or gemini, so those stay. */
export const PROVIDER: Record<string, string> = { claude: 'Claude', openai: 'GPT', gemini: 'Gemini' };
export const providerName = (id: string) => PROVIDER[id] ?? id;

/** Time until `t`: "12분", "3시간 5분", "2일 4시간"; "—" when unknown. */
export function until(t: number | null, now = Date.now()) {
  if (!t) return '—';
  const m = Math.max(0, Math.round((t - now) / 60e3));
  if (m >= 1440) return `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간`;
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return `${m}분`;
}

/** The app's time label (lib/when.ts): relative inside a week, then a date. */
export const ago = (t: number, now = Date.now()) => whenLabel(t, now);

/** Tone of a state: drives the Tailwind status classes (text-ok, text-warn, text-destructive, muted). */
export type Tone = 'ok' | 'warn' | 'bad' | 'idle';

export const STATE: Record<SessionState, { label: string; tone: Tone }> = {
  working: { label: '작업 중', tone: 'ok' },
  waiting: { label: '사람 기다림', tone: 'warn' },
  stuck: { label: '멈춤', tone: 'warn' },
  failed: { label: '실패', tone: 'bad' },
  resting: { label: '쉼', tone: 'idle' },
  done: { label: '완료', tone: 'idle' },
};

/** Text colour class per tone. Failure uses the destructive token; quiet states stay muted. */
export const TONE_TEXT: Record<Tone | 'none', string> = {
  ok: 'text-ok', warn: 'text-warn', bad: 'text-destructive', idle: 'text-muted-foreground', none: 'text-muted-foreground',
};
/** Fill colour class per tone (meters). */
export const TONE_BG: Record<Tone | 'none', string> = {
  ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-destructive', idle: 'bg-muted-foreground', none: 'bg-muted-foreground',
};
export const levelTone = (l: Level): Tone | 'none' => (l === 'none' ? 'none' : l);

const FROM_STATUS: Record<Status, SessionState> = {
  starting: 'working', running: 'working', waiting: 'waiting', idle: 'resting', done: 'done', error: 'failed',
};
/** The session's state, falling back to its raw status when the server sends none. */
export const stateOf = (s: { status: Status; state?: SessionState }): SessionState => s.state ?? FROM_STATUS[s.status] ?? 'resting';

export const PERM_LABEL: Record<string, string> = {
  manual: '매번 승인',
  acceptEdits: '편집 자동 승인',
  auto: '자동',
  plan: '계획만 (읽기 전용)',
};
export const permLabel = (p: string) => PERM_LABEL[p] ?? p;

/** "$2.10/h"-style rate; "—" when there is no rate. */
export const fmtRate = (n: number | null | undefined) => (n == null ? '—' : `${fmtUsd(n)}/h`);

/** The burnWarn codes as sentences: the reasons, then the advice (when there is one). */
export function burnWarnText(w: BurnWarn): { reasons: string[]; advice: string | null } {
  const reasons = w.reasons.map(r =>
    r === 'spike' ? `시간당 비용이 팀 중앙값(${fmtRate(w.medianPerHour)})의 ${w.ratio}배예요`
      : `컨텍스트 ${pct(w.ctxShare)}로 ${w.hours}시간째 이어지고 있어요`);
  const advice = w.advice === 'swapLead' ? '새 관리자 세션으로 교대하는 게 좋아요' : null;
  return { reasons, advice };
}
