// Pure parts of starting an issue from the chat dock (#954): whether an issue row already has a team, which leads
// can take an issue, the work message a lead gets, and the body that creates a new lead for it. Pressing 시작하기 under
// the helper's proposal is the user's approval, so the lead skips the plan document and creates its teammates at once
// (lane normal, the issue number on each). Metadata only: the issue number and title, model ids; no body text.
import { isOpen } from '../dispatch/lib/format.ts';
import type { Session } from '../../../shared/dispatch/types.ts';

export const DEFAULT_IMPL_MODEL = 'claude-opus-5-5';
export const DEFAULT_REVIEW_MODEL = 'claude-sonnet-5-5';
/** Leads run on Sonnet (the team's rule); the lead does not implement. */
export const LEAD_MODEL = 'claude-sonnet-5-5';
export const LEAD_PERM = 'auto';
/** The lead select's value for "make a new lead". */
export const NEW_LEAD = '';

export type TeamPick = { impl: string; review: string };
export type IssueRef = { number: number; title: string };

/** A team has the issue: an open session on it or an open PR (the 진행 중인 이슈 card's rule, activeIssues). */
export function hasTeam(row: { sessions: readonly Session[]; prs: readonly { state: string }[] }): boolean {
  return row.sessions.some(isOpen) || row.prs.some((p) => p.state === 'open');
}

/** Leads that are still alive (not done or failed), newest first. */
export function liveLeads(sessions: readonly Session[]): Session[] {
  return sessions.filter((s) => s.role === 'lead' && isOpen(s)).sort((a, b) => b.startedAt - a.startedAt);
}

/** An issue title for a prompt: one line, at most 200 characters. */
const oneLine = (t: string) => t.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

/** The work message for a lead: take issue #n with a small team, no plan, teammates at once. */
export function issueTask(issue: IssueRef, team: TeamPick): string {
  const n = issue.number;
  const title = oneLine(issue.title);
  return [
    `Issue #${n}${title ? `: ${title}` : ''}`,
    `The user pressed 시작하기 for this issue on the dashboard; that is the approval. Read it with \`gh issue view ${n}\`.`,
    `Issue flow, no plan: do not call write_plan. Create the team at once with create_sessions(lane: "normal") and issue: ${n} on every teammate:`,
    `- impl, model ${team.impl}: the implementer (done-when from the issue body, small commits, PR against develop with Closes #${n}).`,
    `- review, model ${team.review}: a fresh reviewer for that PR after its last commit.`,
    'Merge after the reviewer\'s OK, then report the branch, the PR number and the check output.',
  ].join('\n');
}

/** Told to a new lead before the task: it makes its own teammates (unlike team.sh, which makes them for it). */
export const NEW_LEAD_NOTE =
  'You are the 관리자 (lead) of this issue. Create your teammates yourself with create_sessions as the task says. ' +
  'Each teammate\'s finished turn reaches you automatically as a "[name 보고 · branch]" message, so end your turn when you are waiting for a report instead of sleeping or polling.';

/** POST /api/sessions body for a new lead on the issue; `rules` is the atelier-team rules file team.sh uses too. */
export function newLeadBody(issue: IssueRef, team: TeamPick, rules: string, folder?: string | null) {
  return {
    commonPrompt: `${rules.trim()}\n\n${NEW_LEAD_NOTE}\n\nTask from the user:\n${issueTask(issue, team)}`,
    worktree: true,
    lane: 'normal',
    ...(folder ? { folder } : {}),
    items: [{ role: 'lead', model: LEAD_MODEL, perm: LEAD_PERM, n: 1, issue: issue.number }],
  };
}
