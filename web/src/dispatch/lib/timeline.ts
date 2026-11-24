// 타임라인 card (#879, #928): which sessions it draws, grouped by team (a lead and the sessions under it). Pure: node --test loads it directly.
import { inScope, type Scope } from './folder.ts';
import type { Session, SessionState } from '../../../../shared/dispatch/types.ts';

export type Team<S> = { lead: S; members: S[] };
type Row = Pick<Session, 'id' | 'folder' | 'role' | 'parent' | 'startedAt'>;

/**
 * The sessions of one project (`projectId`: 전체 = undefined, 미분류 = null, else the folder path) grouped by team.
 * A session with no parent in view heads a team; every other session joins the team of its topmost ancestor in view
 * (a reviewer spawned by an implementer still sits under the lead). Teams run oldest lead first; members follow the
 * configured role order, then any other role, oldest first. `pending` (미분류 picked before the project list arrived)
 * shows nothing yet.
 */
export function timelineTeams<S extends Row>(
  sessions: readonly S[],
  roles: readonly { id: string }[],
  projectId: Scope,
  known: ReadonlySet<string>,
  pending = false,
): Team<S>[] {
  if (pending) return [];
  const mine = inScope(sessions, projectId, known);
  const byId = new Map(mine.map(s => [s.id, s]));
  const rootOf = (s: S) => {
    const seen = new Set<string>();
    let cur = s;
    while (cur.parent && byId.has(cur.parent) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent)!;
    }
    return cur;
  };
  const teams = new Map<string, Team<S>>();
  for (const s of mine) {
    const root = rootOf(s);
    let team = teams.get(root.id);
    if (!team) teams.set(root.id, (team = { lead: root, members: [] }));
    if (root !== s) team.members.push(s);
  }
  const rank = (role: string) => {
    const i = roles.findIndex(r => r.id === role);
    return i < 0 ? roles.length : i;
  };
  const out = [...teams.values()].sort((a, b) => a.lead.startedAt - b.lead.startedAt);
  for (const t of out) t.members.sort((a, b) => rank(a.role) - rank(b.role) || a.startedAt - b.startedAt);
  return out;
}

/** States that open a team by default: someone on it is doing or holding up work right now. */
const BUSY: ReadonlySet<SessionState> = new Set(['working', 'waiting', 'stuck']);
export const teamBusy = (states: readonly SessionState[]) => states.some(s => BUSY.has(s));

export type Span = { state: string; from: number; to: number };
/** Which state wins when team members overlap on the folded lead row: work first, then what needs a person. */
const RANK = ['working', 'waiting', 'stuck', 'failed', 'resting', 'done'];
const weight = (st: string) => {
  const i = RANK.indexOf(st);
  return i < 0 ? RANK.length : i;
};

/**
 * One row of spans for a folded team: at every moment the strongest state any member was in (working over
 * waiting over stuck over failed over resting over done), neighbours of the same state joined. Failure ticks
 * are the union of the members' ticks, sorted and deduplicated.
 */
export function mergeSpans(rows: readonly { spans: readonly Span[]; fails: readonly number[] }[]): { spans: Span[]; fails: number[] } {
  const cuts = [...new Set(rows.flatMap(r => r.spans.flatMap(p => [p.from, p.to])))].sort((a, b) => a - b);
  const spans: Span[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    let best: string | null = null;
    for (const r of rows) {
      for (const p of r.spans) if (p.from <= from && p.to >= to && (best === null || weight(p.state) < weight(best))) best = p.state;
    }
    if (best === null) continue;
    const prev = spans[spans.length - 1];
    if (prev && prev.state === best && prev.to === from) prev.to = to;
    else spans.push({ state: best, from, to });
  }
  const fails = [...new Set(rows.flatMap(r => r.fails))].sort((a, b) => a - b);
  return { spans, fails };
}

/** Whole-pixel x of time `t` on a track `width` px wide that shows `[now - windowMs, now]` (#936: no subpixel blur). */
export const trackX = (t: number, now: number, windowMs: number, width: number) =>
  Math.round(Math.min(1, Math.max(0, (t - (now - windowMs)) / windowMs)) * width);

/** Minimum mark width in px, so short stretches of work read as ticks of one thickness. */
export const MIN_MARK = 2;

/** Whole-pixel left and width of a span; both ends snap separately so neighbours meet without gaps or overlap. */
export function spanBox(from: number, to: number, now: number, windowMs: number, width: number): { left: number; width: number } {
  const left = trackX(from, now, windowMs, width);
  const right = trackX(to, now, windowMs, width);
  const w = Math.max(MIN_MARK, right - left);
  return { left: Math.min(left, Math.max(0, width - w)), width: w };
}

/**
 * The time-axis labels: every `step` inside the window, at the same whole-pixel x the tracks use, minus the ones too
 * close to 지금 at the right end to fit beside it.
 */
export function axisTicks(now: number, windowMs: number, width: number, step = 30 * 60_000): { t: number; x: number }[] {
  const start = now - windowMs;
  const out: { t: number; x: number }[] = [];
  for (let t = Math.ceil(start / step) * step; t < now - step / 2; t += step) out.push({ t, x: trackX(t, now, windowMs, width) });
  return out;
}

/**
 * The interval picker (#936, #944): the bucket a bar is drawn at, how often the axis has a tick and how often a tick
 * gets a time label. The stretch shown is always the last 30 minutes (WINDOW_MS); the interval only changes the grain.
 */
export type IntervalId = '30s' | '1m' | '5m';
export type Interval = { id: IntervalId; label: string; bucketMs: number; labelMs: number; hint: string };
const MIN = 60_000;
/** The one stretch of time every interval shows (#944). */
export const WINDOW_MS = 30 * MIN;
const hint = (label: string) => `최근 30분 · ${label} 간격`;
export const INTERVALS: readonly Interval[] = [
  { id: '30s', label: '30초', bucketMs: MIN / 2, labelMs: 5 * MIN, hint: hint('30초') },
  { id: '1m', label: '1분', bucketMs: MIN, labelMs: 5 * MIN, hint: hint('1분') },
  { id: '5m', label: '5분', bucketMs: 5 * MIN, labelMs: 10 * MIN, hint: hint('5분') },
];
export const DEFAULT_INTERVAL: IntervalId = '5m';
export const intervalOf = (id: string | null | undefined): Interval =>
  INTERVALS.find(i => i.id === id) ?? INTERVALS.find(i => i.id === DEFAULT_INTERVAL)!;

export const INTERVAL_KEY = 'atelier.timeline.interval';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** The remembered interval; blocked or missing storage and unknown values fall back to the default. */
export function readInterval(store: Store | undefined): IntervalId {
  try {
    return intervalOf(store?.getItem(INTERVAL_KEY)).id;
  } catch {
    return DEFAULT_INTERVAL;
  }
}
/** Remembers the interval; a full or blocked storage just forgets it. */
export function writeInterval(store: Store | undefined, id: IntervalId) {
  try {
    store?.setItem(INTERVAL_KEY, id);
  } catch {
    /* not remembered */
  }
}

/** Whether the viewer folded the 타임라인 card down to its title row; blocked or missing storage reads as open. */
export const FOLDED_KEY = 'atelier.timeline.folded';
export function readFolded(store: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return store?.getItem(FOLDED_KEY) === '1';
  } catch {
    return false;
  }
}
/** Remembers the fold; a full or blocked storage just forgets it. */
export function writeFolded(store: Pick<Storage, 'setItem' | 'removeItem'> | undefined, folded: boolean) {
  try {
    if (folded) store?.setItem(FOLDED_KEY, '1');
    else store?.removeItem(FOLDED_KEY);
  } catch {
    /* not remembered */
  }
}

/**
 * Spans redrawn at `bucketMs`: the window is cut on the wall-clock grid of the bucket (first and last bucket clipped
 * to it), each bucket takes the strongest state that touches it (as in mergeSpans), and equal neighbours join. A
 * bucket nothing touches stays empty. Failure ticks keep their exact times.
 */
export function bucketSpans(row: { spans: readonly Span[]; fails: readonly number[] }, now: number, windowMs: number, bucketMs: number): { spans: Span[]; fails: number[] } {
  const start = now - windowMs;
  const spans: Span[] = [];
  for (let b = Math.floor(start / bucketMs) * bucketMs; b < now; b += bucketMs) {
    const from = Math.max(b, start);
    const to = Math.min(b + bucketMs, now);
    if (to <= from) continue;
    let best: string | null = null;
    for (const p of row.spans) if (p.from < to && p.to > from && (best === null || weight(p.state) < weight(best))) best = p.state;
    if (best === null) continue;
    const prev = spans[spans.length - 1];
    if (prev && prev.state === best && prev.to === from) prev.to = to;
    else spans.push({ state: best, from, to });
  }
  return { spans, fails: row.fails.filter(t => t >= start && t <= now) };
}

/** Axis tick x positions every `stepMs` on the wall-clock grid, inside the track and off its two ends. */
export function gridTicks(now: number, windowMs: number, width: number, stepMs: number): number[] {
  const start = now - windowMs;
  const out: number[] = [];
  for (let t = Math.ceil(start / stepMs) * stepMs; t < now; t += stepMs) {
    const x = trackX(t, now, windowMs, width);
    if (x > 0 && x < width) out.push(x);
  }
  return out;
}

/** How often the card polls /api/timeline and recounts 최근 업데이트 while the page is visible (#944). */
export const REFRESH_MS = 5_000;

/** 최근 업데이트 text for an update `ms` ago: 방금 under 5s, then whole seconds, then whole minutes. */
export function agoLabel(ms: number): string {
  const sec = Math.floor(Math.max(0, ms) / 1000);
  if (sec < 5) return '최근 업데이트 방금';
  if (sec < 60) return `최근 업데이트 ${sec}초 전`;
  return `최근 업데이트 ${Math.floor(sec / 60)}분 전`;
}
