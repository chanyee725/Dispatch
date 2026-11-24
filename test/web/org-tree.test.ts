// 조직도 tab tree (#943) and the 역할 프롬프트 fallback after a server restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { orgSize, orgTree, type OrgNode } from '../../web/src/live/orgTree.ts';
import { PROMPT_CLEARED, shownPrompt } from '../../web/src/dispatch/lib/rolePrompt.ts';

const s = (id: string, n: number, parent: string | null = null, canSpawn = false) => ({ id, n, parent, canSpawn });
const shape = (t: OrgNode | null): unknown => t && [t.s.id + (t.current ? '*' : ''), ...t.children.map(shape)];

const team = [
  s('main', 1, null, true),
  s('lead', 2, 'main', true),
  s('rev', 5, 'lead'),
  s('impl', 3, 'lead'),
  s('impl2', 4, 'lead'),
  s('other', 6, null, true),
  s('o1', 7, 'other'),
];

test('a lead shows its own lead above, then itself with its teammates in creation order', () => {
  assert.deepEqual(shape(orgTree(team, 'lead')), ['main', ['lead*', ['impl'], ['impl2'], ['rev']]]);
});

test('a top lead shows itself over its teammates; a sub-lead under it keeps its own team', () => {
  assert.deepEqual(shape(orgTree(team, 'main')), ['main*', ['lead', ['impl'], ['impl2'], ['rev']]]);
  assert.deepEqual(shape(orgTree(team, 'other')), ['other*', ['o1']]);
});

test('a teammate shows its lead above itself and its siblings', () => {
  const t = orgTree(team, 'impl2');
  assert.deepEqual(shape(t), ['lead', ['impl'], ['impl2*'], ['rev']]);
  assert.equal(orgSize(t), 4);
});

test('a lone session or a parent that is gone gives a tree of one; an unknown id gives null', () => {
  assert.deepEqual(shape(orgTree([s('solo', 1)], 'solo')), ['solo*']);
  assert.deepEqual(shape(orgTree([s('kid', 2, 'removed')], 'kid')), ['kid*']);
  assert.equal(orgTree(team, 'nope'), null);
  assert.equal(orgSize(null), 0);
});

test('a parent cycle shows each session once instead of recursing forever', () => {
  const loop = [s('a', 1, 'b', true), s('b', 2, 'a', true), s('c', 3, 'a')];
  assert.deepEqual(shape(orgTree(loop, 'a')), ['b', ['a*', ['c']]]);
  assert.deepEqual(shape(orgTree(loop, 'b')), ['a', ['b*'], ['c']]);
  assert.deepEqual(shape(orgTree([s('self', 1, 'self', true)], 'self')), ['self*']);
});

test('the role prompt falls back to the role default when the session prompt was cleared by a restart', () => {
  const roles = [{ id: 'lead', prompt: '너는 관리자다.' }];
  assert.deepEqual(shownPrompt({ prompt: '할 일', role: 'lead' }, roles), { text: '할 일', fallback: false });
  assert.deepEqual(shownPrompt({ prompt: '', role: 'lead' }, roles), { text: '너는 관리자다.', fallback: true });
  assert.deepEqual(shownPrompt({ role: 'custom' }, roles), { text: '', fallback: true });
  assert.match(PROMPT_CLEARED, /서버 재시작/);
});
