// What a session works on, as one short line for its card (#912): `fix · #886 질문이 안 보이는 사람 기다림`.
// Built from metadata only, never from the transcript. Sources, first that answers wins:
//   1. the session's issue (its `issue`, else the number its branch names) with the issue title from GET /api/issues;
//   2. an open task on the board (set_task) owned by this session;
//   3. the branch name (`fix/886-hidden-question` -> `fix`, `#886 hidden question`); Dispatch's own `dispatch/…`
//      worktree branches say nothing;
//   4. the short summary a lead left on the session (`task`, POST /api/sessions/:id/task, at most 80 characters);
//   5. the issue number alone, when its title is not known (issue feed off or loading);
//   6. its lead's newest open board task (the session itself when it leads). Last because it is the team's work, not
//      this session's: ahead of 4 and 5 it would put one title on every teammate and hide what a lead wrote.
// The type (fix, feat, chore, docs, review) comes from the branch prefix, else from the reviewer role.
// Pure functions only, so tests run without a browser.
import { issueOfBranch } from '../../../shared/dispatch/issue-branch.ts';
import type { Session } from '../../../shared/dispatch/types.ts';
import type { BoardTask } from '../dispatch/types.ts';

export type TaskSummary = {
  /** Short type prefix (fix, feat, chore, docs, review); null when nothing says. */
  kind: string | null;
  text: string;
  /** Which source answered, for tests and data attributes. */
  from: 'issue' | 'board' | 'branch' | 'task';
};

/** The session fields the summary reads (a Session from /api/state carries them all). */
export type SummarySession = Pick<Session, 'id' | 'name' | 'role' | 'branch' | 'parent'> & { issue?: number | null; task?: string | null };

const KIND = /^(feat|fix|chore|docs|refactor|test|perf|hotfix|review)\//i;
const OPEN_STAGES = new Set(['plan', 'impl', 'review', 'test', 'merge']);
/** At most this many characters of text; the card truncates further with CSS. */
export const SUMMARY_MAX = 80;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX);

/** The type prefix: the branch's conventional type, else `review` for a reviewer. */
export function summaryKind(s: Pick<SummarySession, 'branch' | 'role'>): string | null {
  const m = s.branch?.match(KIND);
  if (m) return m[1].toLowerCase();
  return s.role === 'review' ? 'review' : null;
}

/** `fix/886-hidden-question` -> `#886 hidden question`; null for a branch that names no work (`dispatch/impl-3`, `develop`). */
export function branchText(branch: string | null | undefined): string | null {
  if (!branch || !KIND.test(branch)) return null;
  const rest = branch.replace(KIND, '');
  const n = issueOfBranch(branch);
  const words = (n ? rest.replace(/^(?:issue-|gh-)?\d+-?/i, '') : rest).replace(/[-_/]+/g, ' ').trim();
  const text = [n ? `#${n}` : '', words].filter(Boolean).join(' ');
  return text ? clean(text) : null;
}

const openTasks = (tasks: readonly BoardTask[]) => tasks.filter((t) => OPEN_STAGES.has(t.stage) && t.title.trim());
const newest = (list: BoardTask[]) => list.reduce<BoardTask | null>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), null);

/** The newest open board task the session owns (by id or name). */
export function boardTaskOf(s: SummarySession, tasks: readonly BoardTask[]): BoardTask | null {
  return newest(openTasks(tasks).filter((t) => t.owner != null && (t.owner === s.id || t.owner === s.name)));
}

/** The newest open board task of the session's lead (the session itself when it leads). */
export function leadTaskOf(s: SummarySession, tasks: readonly BoardTask[]): BoardTask | null {
  const lead = s.role === 'lead' ? s.id : s.parent;
  return lead ? newest(openTasks(tasks).filter((t) => t.lead === lead)) : null;
}

/**
 * The one-line summary of what the session works on, or null when no source says anything.
 * `issueTitle` looks up an issue's title (the dashboard's issue feed); it may know none.
 */
export function taskSummary(
  s: SummarySession,
  issueTitle: (n: number) => string | null | undefined,
  tasks: readonly BoardTask[],
): TaskSummary | null {
  const kind = summaryKind(s);
  const n = s.issue ?? issueOfBranch(s.branch);
  const title = n ? issueTitle(n)?.trim() : null;
  if (n && title) return { kind, text: clean(`#${n} ${title}`), from: 'issue' };
  const t = boardTaskOf(s, tasks);
  if (t) return { kind, text: clean(t.title), from: 'board' };
  const b = branchText(s.branch);
  if (b) return { kind, text: b, from: 'branch' };
  const own = s.task ? clean(s.task) : '';
  if (own) return { kind, text: own, from: 'task' };
  if (n) return { kind, text: `#${n}`, from: 'issue' };
  const lt = leadTaskOf(s, tasks);
  return lt ? { kind, text: clean(lt.title), from: 'board' } : null;
}

/** The prefix the card shows: the branch type as is (`fix`), a reviewer's in Korean (`리뷰`, #1025). */
export const kindLabel = (kind: string) => (kind === 'review' ? '리뷰' : kind);

/** The summary as one string (`fix · #886 …`), for a title attribute or an accessible name. */
export const summaryLine = (x: TaskSummary) => (x.kind ? `${kindLabel(x.kind)} · ${x.text}` : x.text);

/** An issue-title lookup over the issue feed's answer (or nothing while it loads or fails). */
export function issueTitles(issues: readonly { number: number; title: string }[] | null | undefined): (n: number) => string | null {
  const m = new Map((issues ?? []).map((i) => [i.number, i.title]));
  return (n) => m.get(n) ?? null;
}
