// 세션 보드 groups (#731, docs/design/session-board-in-shell.md §2): sessions per project, groups that need a person
// first, then by latest activity, 미분류 last (left out when empty). Pure: node --test loads it directly.
import type { Session, SessionState } from '../../../../shared/dispatch/types.ts';
import { projectOf } from './folder.ts';
import { byUrgency } from './order.ts';

type Grouped = Pick<Session, 'id' | 'folder' | 'cwd' | 'status' | 'state' | 'startedAt' | 'updatedAt' | 'stateSince' | 'stuck' | 'cost'>;

export type BoardGroup<T> = {
  /** Project folder path; null = 미분류; `cwd:<name>` when grouped by working folder (project list failed). */
  key: string | null;
  label: string;
  /** Open (not done) sessions, most urgent first. */
  live: T[];
  /** Finished sessions, newest first; shown folded. */
  done: T[];
  /** Sessions waiting on a person, stuck or failed. */
  attention: number;
  cost: number | null;
  last: number;
};

const NEEDS: ReadonlySet<SessionState> = new Set(['waiting', 'stuck', 'failed']);
const baseName = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

/**
 * Groups for the board. `known`: project folders; `names`: their labels. `byCwd`: the project list could not be
 * read, so sessions group by their working folder's name instead of all landing in 미분류.
 */
export function boardGroups<T extends Grouped>(
  sessions: readonly T[],
  opts: { known: ReadonlySet<string>; names: ReadonlyMap<string, string>; stateOf: (s: T) => SessionState; byCwd?: boolean },
): BoardGroup<T>[] {
  const map = new Map<string | null, T[]>();
  for (const s of sessions) {
    const key = opts.byCwd ? `cwd:${baseName(s.cwd ?? '')}` : projectOf(s, opts.known);
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  const groups: BoardGroup<T>[] = [...map].map(([key, list]) => {
    const live = byUrgency(list.filter((s) => opts.stateOf(s) !== 'done'), opts.stateOf);
    const done = list.filter((s) => opts.stateOf(s) === 'done').sort((a, b) => b.updatedAt - a.updatedAt);
    const label = key === null ? '미분류' : key.startsWith('cwd:') && opts.byCwd ? key.slice(4) : (opts.names.get(key) ?? key);
    return {
      key,
      label,
      live,
      done,
      attention: list.filter((s) => NEEDS.has(opts.stateOf(s))).length,
      cost: list.some((s) => s.cost != null) ? list.reduce((a, s) => a + (s.cost ?? 0), 0) : null,
      last: Math.max(0, ...list.map((s) => s.updatedAt ?? s.startedAt)),
    };
  });
  return groups.sort(
    (a, b) => Number(a.key === null) - Number(b.key === null) || Number(b.attention > 0) - Number(a.attention > 0) || b.last - a.last || a.label.localeCompare(b.label),
  );
}
