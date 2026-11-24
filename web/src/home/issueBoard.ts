// GitHub issues as the unit of work on the project dashboard (#776). The server lists open issues with the PRs on
// them (GET /api/issues, read-only through gh); this module joins them with the project's sessions and gives each
// issue one state: 열림 → 작업 중 (a session works on it) → PR 리뷰 (an open PR). An open issue is never shown as 머지됨,
// even when an earlier PR on it was merged (#784): 머지됨 is only for a closed issue, which the list hides. Branches and
// PRs are a detail of an issue. Pure functions only, so tests run without a browser.
import { isOpen } from '../dispatch/lib/format.ts';
import type { Session } from '../../../shared/dispatch/types.ts';
import { issueOfBranch } from '../../../shared/dispatch/issue-branch.ts';

export type IssuePr = { number: number; state: 'open' | 'closed' | 'merged'; url?: string; branch?: string };
export type ApiIssue = { number: number; title: string; url?: string; prs: IssuePr[] };
export type IssuesAnswer = { ok: true; issues: ApiIssue[] } | { ok: false; reason: string };

export type IssueState = 'open' | 'progress' | 'pr' | 'merged';
export const ISSUE_STATE: Record<IssueState, { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' | 'merged' | 'impl' | 'review' }> = {
  open: { label: '열림', tone: 'idle' },
  progress: { label: '작업 중', tone: 'impl' },
  pr: { label: 'PR 리뷰', tone: 'review' },
  merged: { label: '머지됨', tone: 'merged' },
};

export type IssueRow = ApiIssue & {
  state: IssueState;
  /** Sessions on the issue, open ones first. */
  sessions: Session[];
  /** Branches of its sessions and PRs, without repeats. */
  branches: string[];
};

/** The issue a branch works on: only `<type>/<n>-…` (`feat/747-x`, `fix/issue-12`); see shared/dispatch/issue-branch.ts. */
export { issueOfBranch };

/**
 * The state of one issue from its PRs and whether a session is open on it. A merged PR makes it 머지됨 only when the
 * issue itself is closed; an open issue with an old merged PR stays 열림 or 작업 중 (#784).
 */
export function issueState(prs: readonly IssuePr[], working: boolean, closed = false): IssueState {
  if (closed && prs.some((p) => p.state === 'merged')) return 'merged';
  if (prs.some((p) => p.state === 'open')) return 'pr';
  return working ? 'progress' : 'open';
}

// 작업 중 first (a session on it, then an open PR waiting for review), then untouched issues.
const ORDER: Record<IssueState, number> = { progress: 0, pr: 1, open: 2, merged: 3 };

/**
 * Joins the server's issues with the project's sessions. A session belongs to an issue when the server set its
 * `issue`, its branch names the issue, or its branch is the head branch of one of the issue's PRs. Rows with work on
 * them come first (작업 중, PR 리뷰, then 열림), newest number first inside each.
 */
export function issueRows(issues: readonly ApiIssue[], sessions: readonly Session[]): IssueRow[] {
  const rows = issues.map((i) => {
    const prBranches = new Set(i.prs.flatMap((p) => (p.branch ? [p.branch] : [])));
    const mine = sessions
      .filter((s) => s.issue === i.number || issueOfBranch(s.branch) === i.number || (!!s.branch && prBranches.has(s.branch)))
      .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const branches = [...new Set([...mine.flatMap((s) => (s.branch ? [s.branch] : [])), ...prBranches])];
    return { ...i, sessions: mine, branches, state: issueState(i.prs, mine.some(isOpen)) };
  });
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.number - a.number);
}

/** The sessions open on an issue now (its owners), for the row's initials. */
export const ownerSessions = (row: IssueRow): Session[] => row.sessions.filter(isOpen);

/** One or two letters for a session's badge: the first letter of each of the first two words, else its first two. */
export function initials(name: string | null | undefined): string {
  const words = String(name ?? '').trim().split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '?';
  const pick = words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...words[0]].slice(0, 2).join('');
  return pick.toUpperCase();
}

/** Why the list is empty or missing, in one sentence. */
export function issuesBlankReason(reason: string): string {
  if (reason === 'gh-missing') return 'gh를 찾지 못해서 이슈를 볼 수 없어요.';
  if (reason === 'not-logged-in') return 'gh에 로그인하면 이슈가 여기에 보여요.';
  if (reason === 'disabled') return 'PR·CI 추적이 꺼져 있어요. 세션 보드 위쪽 스위치로 켤 수 있어요.';
  if (reason === 'timeout') return 'GitHub가 늦게 답해서 이슈를 못 가져왔어요. 잠시 뒤 다시 시도해요.';
  return '이슈를 불러오지 못했어요.';
}
