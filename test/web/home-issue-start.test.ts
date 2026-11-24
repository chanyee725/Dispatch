import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_IMPL_MODEL, DEFAULT_REVIEW_MODEL, LEAD_MODEL, issueTask, liveLeads, newLeadBody } from '../../web/src/home/issueStart.ts';
import type { Session } from '../../shared/dispatch/types.ts';

const sess = (id: string, role: string, status: string, startedAt: number) => ({ id, name: id, role, status, startedAt }) as unknown as Session;
const team = { impl: DEFAULT_IMPL_MODEL, review: DEFAULT_REVIEW_MODEL };

test('default models: Opus implements, Sonnet reviews and leads', () => {
  assert.equal(DEFAULT_IMPL_MODEL, 'claude-opus-5-5');
  assert.equal(DEFAULT_REVIEW_MODEL, 'claude-sonnet-5-5');
  assert.equal(LEAD_MODEL, 'claude-sonnet-5-5');
});

test('liveLeads keeps open leads only, newest first', () => {
  const list = [sess('a', 'lead', 'idle', 1), sess('b', 'impl', 'running', 5), sess('c', 'lead', 'done', 9), sess('d', 'lead', 'running', 3), sess('e', 'lead', 'error', 4)];
  assert.deepEqual(liveLeads(list).map((s) => s.id), ['d', 'a']);
});

test('issueTask: no plan, create_sessions with lane normal and the issue, chosen models', () => {
  const t = issueTask({ number: 954, title: 'Start\npanel' }, { impl: 'm-impl', review: 'm-review' });
  assert.match(t, /^Issue #954: Start panel\n/);
  assert.match(t, /do not call write_plan/);
  assert.match(t, /create_sessions\(lane: "normal"\)/);
  assert.match(t, /issue: 954/);
  assert.match(t, /impl, model m-impl/);
  assert.match(t, /review, model m-review/);
  assert.match(t, /Closes #954/);
});

test('issueTask cuts a long title and drops control characters', () => {
  const t = issueTask({ number: 1, title: `a\u0007${'x'.repeat(400)}` }, team);
  const first = t.split('\n')[0];
  assert.ok(!first.includes('\u0007'));
  assert.ok(first.length <= 'Issue #1: '.length + 200);
});

test('newLeadBody: one lead with the rules first, the task last, lane normal and the folder', () => {
  const b = newLeadBody({ number: 7, title: 'T' }, team, '  Team rules:\n- x  ', '/p');
  assert.equal(b.lane, 'normal');
  assert.equal(b.worktree, true);
  assert.equal(b.folder, '/p');
  assert.deepEqual(b.items, [{ role: 'lead', model: LEAD_MODEL, perm: 'auto', n: 1, issue: 7 }]);
  assert.ok(b.commonPrompt.startsWith('Team rules:\n- x\n\n'));
  assert.ok(b.commonPrompt.endsWith(`Task from the user:\n${issueTask({ number: 7, title: 'T' }, team)}`));
  assert.equal('folder' in newLeadBody({ number: 7, title: 'T' }, team, 'r', null), false);
});
