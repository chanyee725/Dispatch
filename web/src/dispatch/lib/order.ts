// Board order for 세션: the session that needs a person most comes first. Pure.
import type { Session, SessionState } from '../../../../shared/dispatch/types.ts';

/** 실패 > 사람 기다림 > 멈춤 > 작업 중 > 쉼 > 완료. */
export const URGENCY: Record<SessionState, number> = { failed: 0, waiting: 1, stuck: 2, working: 3, resting: 4, done: 5 };

type Sortable = Pick<Session, 'id' | 'startedAt' | 'stateSince' | 'stuck'>;

/** When the session entered its current state; a stuck flag counts from when the session went quiet. */
export function stateStart(s: Sortable, state: SessionState): number {
  if (state === 'stuck' && s.stuck?.sinceMs != null) return s.stuck.sinceMs;
  return s.stateSince ?? s.startedAt;
}

/** Sessions by urgency; inside one state the longest-standing first, then start time and id. Returns a new array. */
export function byUrgency<T extends Sortable>(sessions: T[], stateOf: (s: T) => SessionState): T[] {
  const key = new Map(sessions.map(s => { const st = stateOf(s); return [s, { rank: URGENCY[st] ?? 4, since: stateStart(s, st) }]; }));
  return [...sessions].sort((a, b) => {
    const x = key.get(a)!, y = key.get(b)!;
    return x.rank - y.rank || x.since - y.since || a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
