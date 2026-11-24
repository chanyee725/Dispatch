import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRANCH_STATE, LEGEND_STATES, branchState, branchSummary, prOffText, shownRows, treeEntries, treeSummary, type BranchRow, type BranchTree, type PrPhase } from '../../web/src/dispatch/lib/liveBranches.ts';
import { boardHash, parseBoardHash } from '../../web/src/projectNav.ts';

const row = (branch: string, o: Partial<BranchRow> = {}): BranchRow => ({
  branch, sessions: [], issue: null, ahead: 1, behind: 0, lastAt: 0, subject: 's', dirty: null, merged: false, pr: null, ...o,
});
const ses = (id: string, open: boolean, folder: string | null = 'p') => ({ id, name: id, role: 'impl', roleName: '구현자', color: null, folder, open });

test('live work first, merged last, then newest commit; scope filter keeps rows with a matching session', () => {
  const rows = [
    row('merged', { merged: true, lastAt: 9, sessions: [ses('a', true)] }),
    row('idle', { lastAt: 8, sessions: [ses('b', false)] }),
    row('old', { lastAt: 1, sessions: [ses('c', true)] }),
    row('new', { lastAt: 5, sessions: [ses('d', true, 'q')] }),
  ];
  assert.deepEqual(shownRows(rows).map((r) => r.branch), ['new', 'old', 'idle', 'merged']);
  assert.deepEqual(shownRows(rows, (s) => s.folder === 'p').map((r) => r.branch), ['old', 'idle', 'merged']);
});

test('PR-off reasons read as a short line; the 브랜치 tab round-trips through the address', () => {
  assert.equal(prOffText('on'), null);
  assert.match(prOffText('disabled')!, /PR 추적이 꺼져/);
  assert.deepEqual(parseBoardHash('#board=branches'), { kind: 'board', tab: 'branches' });
  assert.equal(boardHash({ tab: 'branches', folder: 'a b' }), '#board=branches&folder=a%20b');
});

test('treeEntries keeps the base and shown branches, drops hidden commits and dangling parents, marks tips (#877)', () => {
  const tree: BranchTree = {
    base: 'develop',
    commits: [
      { hash: 'x1', parents: ['m'], branch: 'feat/x', at: 4, subject: 'x one' },
      { hash: 'b1', parents: ['m'], branch: 'feat/b', at: 3, subject: 'b one' },
      { hash: 'm', parents: ['i', 'a1'], branch: 'develop', at: 2, subject: 'merge' },
      { hash: 'a1', parents: ['i'], branch: 'develop', at: 1, subject: 'a one' },
      { hash: 'i', parents: ['gone'], branch: 'develop', at: 0, subject: 'init' },
    ],
    tips: [{ branch: 'develop', hash: 'm' }, { branch: 'feat/b', hash: 'b1' }, { branch: 'feat/x', hash: 'x1' }],
  };
  const rows = [row('feat/b', { issue: 7 })];
  const e = treeEntries(tree, rows);
  assert.deepEqual(e.map((x) => x.hash), ['b1', 'm', 'a1', 'i']);
  assert.deepEqual(e[0].tips, ['feat/b']);
  assert.equal(e[0].row?.issue, 7);
  assert.deepEqual(e[1].tips, ['develop']);
  assert.equal(e[1].row, null);
  assert.deepEqual(e[3].parents, []);
  assert.equal(e[0].message, 'b one');
  assert.equal(treeSummary(e, 'develop'), 'develop 기준, 세션 브랜치 1개, 커밋 4개');
});

test('branchState maps PR phases to the legend states; branchSummary counts open PRs and the newest commit (#889)', () => {
  const pr = (phase: PrPhase) => ({ number: 1, phase });
  assert.equal(branchState(row('a')), 'working');
  assert.equal(branchState(row('a', { pr: pr('draft') })), 'working');
  assert.equal(branchState(row('a', { pr: pr('review') })), 'review');
  assert.equal(branchState(row('a', { pr: pr('mergeable') })), 'passed');
  assert.equal(branchState(row('a', { pr: pr('conflict') })), 'conflict');
  assert.equal(branchState(row('a', { pr: pr('closed') })), 'closed');
  assert.equal(branchState(row('a', { merged: true })), 'merged');
  assert.equal(branchState(row('a', { pr: pr('merged') })), 'merged');
  assert.deepEqual(LEGEND_STATES.map((s) => BRANCH_STATE[s]), ['작업 중', 'PR 리뷰', '체크 통과', '머지됨']);
  const rows = [
    row('a', { pr: pr('review'), lastAt: 5 }),
    row('b', { pr: pr('mergeable'), lastAt: null }),
    row('c', { pr: pr('merged'), merged: true, lastAt: 9 }),
    row('d', { pr: pr('closed'), lastAt: 2 }),
    row('e', { lastAt: 1 }),
  ];
  assert.deepEqual(branchSummary(rows), { branches: 5, openPrs: 2, lastAt: 9 });
  assert.deepEqual(branchSummary([]), { branches: 0, openPrs: 0, lastAt: null });
});
