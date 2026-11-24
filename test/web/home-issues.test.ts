import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initials, issueOfBranch, issueRows, issueState, issuesBlankReason, ownerSessions, ISSUE_STATE, type ApiIssue } from '../../web/src/home/issueBoard.ts';
import type { Session } from '../../shared/dispatch/types.ts';

const s = (id: string, branch: string | null, status = 'running', extra: Record<string, unknown> = {}) =>
  ({ id, name: id, roleName: '구현', branch, status, updatedAt: 1, ...extra }) as unknown as Session;

const ISSUES: ApiIssue[] = [
  { number: 700, title: 'untouched', prs: [] },
  { number: 776, title: 'dashboard issues', prs: [{ number: 801, state: 'open', branch: 'dispatch/impl-1' }] },
  { number: 755, title: 'agents panel', prs: [] },
  { number: 748, title: 'role models', prs: [{ number: 790, state: 'merged', branch: 'feat/748-x' }] },
];

test('issueOfBranch reads feat/<n>-… and skips dispatch/ branches', () => {
  assert.equal(issueOfBranch('feat/776-dashboard-issues'), 776);
  assert.equal(issueOfBranch('fix/issue-12'), 12);
  assert.equal(issueOfBranch('dispatch/impl-1061'), null);
  assert.equal(issueOfBranch(null), null);
});

test('issueState: open PR, then a working session, else open; an open issue is never merged (#784)', () => {
  assert.equal(issueState([{ number: 1, state: 'merged' }, { number: 2, state: 'open' }], false), 'pr');
  assert.equal(issueState([{ number: 1, state: 'merged' }], true), 'progress');
  assert.equal(issueState([{ number: 1, state: 'merged' }], false), 'open');
  assert.equal(issueState([{ number: 1, state: 'closed' }], true), 'progress');
  assert.equal(issueState([], false), 'open');
  assert.equal(issueState([{ number: 1, state: 'merged' }], false, true), 'merged');
});

test('state chips read 열림 / 작업 중 / PR 리뷰 / 머지됨', () => {
  assert.deepEqual(Object.values(ISSUE_STATE).map((x) => x.label), ['열림', '작업 중', 'PR 리뷰', '머지됨']);
});

test('initials: first letters of two words, else the first two letters', () => {
  assert.equal(initials('Pia'), 'PI');
  assert.equal(initials('impl-1082'), 'I1');
  assert.equal(initials('Jae Kim'), 'JK');
  assert.equal(initials('구현자'), '구현');
  assert.equal(initials(''), '?');
});

test('issueRows matches sessions by issue, branch name and PR head branch; worked-on issues first', () => {
  const sessions = [
    s('a', 'dispatch/impl-1'), // head branch of PR #801 → 776
    s('b', 'feat/755-agents'), // branch name → 755
    s('c', 'dispatch/impl-2', 'running', { issue: 755 }), // server-set issue → 755
    s('d', 'feat/999-other'), // no listed issue
    s('e', 'feat/748-x', 'done'),
  ];
  const rows = issueRows(ISSUES, sessions);
  assert.deepEqual(rows.map((r) => [r.number, r.state]), [[755, 'progress'], [776, 'pr'], [748, 'open'], [700, 'open']]);
  assert.deepEqual(rows[1].sessions.map((x) => x.id), ['a']);
  assert.deepEqual(rows[0].sessions.map((x) => x.id).sort(), ['b', 'c']);
  assert.deepEqual(rows[0].branches.sort(), ['dispatch/impl-2', 'feat/755-agents']);
  assert.deepEqual(rows[2].branches, ['feat/748-x']);
  assert.deepEqual(ownerSessions(rows[2]), []); // its only session is done
  assert.deepEqual(ownerSessions(rows[0]).map((x) => x.id).sort(), ['b', 'c']);
});

test('issuesBlankReason says why in one sentence', () => {
  assert.match(issuesBlankReason('not-logged-in'), /로그인/);
  assert.match(issuesBlankReason('disabled'), /꺼져/);
  assert.match(issuesBlankReason('whatever'), /불러오지 못했어요/);
});
