// Project (workspace top folder) scoping of the 세션 board. Pure: node --test loads it directly.
// The scope lives in the URL hash next to the view: `#timeline&folder=docs`; `folder=` with no value is 미분류,
// no folder part is 전체. A session's `folder` that is no longer a project (renamed, moved, deleted) counts as 미분류.
import { isOpen } from './format.ts';
import type { Session } from '../../../../shared/dispatch/types.ts';

/** 전체 = undefined, 미분류 = null, a project = its folder path. */
export type Scope = string | null | undefined;

export const UNFILED = '미분류';

/** The project a session counts for: its folder when that is a known project, else null (미분류). */
export const projectOf = (s: Pick<Session, 'folder'>, known: ReadonlySet<string>): string | null =>
  s.folder != null && known.has(s.folder) ? s.folder : null;

/** Sessions in a scope; 전체 keeps everything. */
export function inScope<T extends Pick<Session, 'folder'>>(sessions: readonly T[], scope: Scope, known: ReadonlySet<string>): T[] {
  return scope === undefined ? [...sessions] : sessions.filter(s => projectOf(s, known) === scope);
}

/** A project home's sessions: those whose folder is the project's path ('' = every session of this server, #778),
 *  open ones first, then newest. */
export const sessionsOf = <T extends Pick<Session, 'folder' | 'status' | 'startedAt'>>(sessions: readonly T[], folder: string): T[] =>
  sessions.filter(s => folder === '' || s.folder === folder).sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || (b.startedAt ?? 0) - (a.startedAt ?? 0));

/** Folders the scope may be filed under: the project paths, plus a picked project itself until the list has arrived (a
 *  `#folder=` link must not show an empty board, or count everything as 미분류, before the first answer). */
/** 미분류 can't be told apart from a project until the project list has arrived: everything would count as 미분류 for a
 *  moment (#761). Screens show no sessions while this is true; a failed list falls back to grouping by folder. */
export const scopePending = (scope: Scope, listState: 'loading' | 'ready' | 'failed'): boolean => scope === null && listState === 'loading';

export const knownFolders = (paths: readonly string[], scope: Scope, ready: boolean): Set<string> => {
  const k = new Set(paths);
  if (!ready && typeof scope === 'string') k.add(scope);
  return k;
};
