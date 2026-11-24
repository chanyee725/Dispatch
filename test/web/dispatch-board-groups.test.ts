import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardGroups } from '../../web/src/dispatch/lib/boardGroups.ts';
import { stateOf } from '../../web/src/dispatch/lib/format.ts';

const s = (id: string, folder: string | null, status: string, updatedAt: number, more: Record<string, unknown> = {}) =>
  ({ id, folder, cwd: `/repo/${folder ?? 'x'}`, status, startedAt: 1, updatedAt, stateSince: 1, stuck: null, cost: 1, ...more }) as never;

const opts = { known: new Set(['a', 'b']), names: new Map([['a', 'Alpha'], ['b', 'Beta']]), stateOf };

test('groups: attention first, then latest activity, 미분류 last; done sessions fold', () => {
  const g = boardGroups([s('1', 'a', 'running', 50), s('2', 'b', 'running', 10), s('3', 'b', 'waiting', 5), s('4', null, 'running', 99), s('5', 'a', 'done', 60)], opts);
  assert.deepEqual(g.map((x) => x.label), ['Beta', 'Alpha', '미분류']);
  assert.deepEqual(g[0].live.map((x: { id: string }) => x.id), ['3', '2']);
  assert.equal(g[0].attention, 1);
  assert.deepEqual(g[1].live.map((x: { id: string }) => x.id), ['1']);
  assert.deepEqual(g[1].done.map((x: { id: string }) => x.id), ['5']);
  assert.equal(g[1].cost, 2);
});

test('groups: an unknown folder counts as 미분류; no 미분류 group without such sessions', () => {
  assert.deepEqual(boardGroups([s('1', 'gone', 'running', 1)], opts).map((x) => x.key), [null]);
  assert.deepEqual(boardGroups([s('1', 'a', 'running', 1)], opts).map((x) => x.key), ['a']);
  assert.deepEqual(boardGroups([], opts), []);
});

test('groups: without the project list, sessions group by working folder name', () => {
  const g = boardGroups([s('1', 'a', 'running', 1), s('2', null, 'running', 2)], { ...opts, known: new Set(), byCwd: true });
  assert.deepEqual(g.map((x) => x.label).sort(), ['a', 'x']);
});
