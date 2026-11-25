import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inScope, projectOf, sessionsOf, tasksInScope } from '../../web/src/dispatch/lib/folder.ts';

const s = (id: string, folder: string | null | undefined, status = 'running') => ({ id, folder, status }) as never;
const known = new Set(['a', 'b c']);

test('scoping: unknown or missing folders count as 미분류', () => {
  const all = [s('1', 'a'), s('2', 'b c'), s('3', null), s('4', undefined), s('5', 'gone')];
  assert.equal(projectOf(all[4], known), null);
  assert.deepEqual(inScope(all, undefined, known).length, 5);
  assert.deepEqual(inScope(all, 'a', known).map((x: { id: string }) => x.id), ['1']);
  assert.deepEqual(inScope(all, null, known).map((x: { id: string }) => x.id), ['3', '4', '5']);
});

test('project board keeps active and recent done cards when their lead is removed', () => {
  const lead = s('removed', 'a');
  const sessions = [s('peer', 'a'), s('other', 'b c')];
  const active = { lead: 'removed', folder: 'a', stage: 'impl' };
  const done = { lead: 'removed', folder: 'a', stage: 'done' };
  const peer = { lead: 'peer' }; // Legacy card can still follow its lead.
  const other = { lead: 'other', folder: 'b c' };
  const unknown = { lead: 'missing' };
  const unfiled = { lead: 'removed-unfiled', folder: null };
  const unassigned = { lead: null };
  const tasks = [active, done, peer, other, unknown, unfiled, unassigned];
  const forProject = (all: typeof sessions, scope?: string | null) => tasksInScope(tasks, all, scope, known);
  assert.deepEqual(forProject([lead, ...sessions], 'a'), [active, done, peer]);
  assert.deepEqual(forProject(sessions, 'a'), [active, done, peer]);
  assert.deepEqual(forProject(sessions, 'b c'), [other]);
  assert.deepEqual(forProject(sessions, null), [unfiled]);
  assert.deepEqual(forProject(sessions), tasks);
});

test('project home lists open sessions first', () => {
  const list = sessionsOf([{ ...s('1', 'a', 'done'), startedAt: 9 }, { ...s('2', 'a'), startedAt: 1 }, { ...s('3', 'b c'), startedAt: 5 }] as never, 'a');
  assert.deepEqual(list.map((x) => x.id), ['2', '1']);
  // '' = the whole project's dashboard (#778): every session, open first.
  assert.deepEqual(sessionsOf([{ ...s('1', 'a', 'done'), startedAt: 9 }, { ...s('2', null), startedAt: 1 }, { ...s('3', 'b c'), startedAt: 5 }] as never, '').map((x) => x.id), ['3', '2', '1']);
});

test('knownFolders keeps a picked project known until the project list has arrived', async () => {
  const { knownFolders } = await import('../../web/src/dispatch/lib/folder.ts');
  assert.deepEqual([...knownFolders([], '/w/alpha', false)], ['/w/alpha']);
  assert.deepEqual([...knownFolders([], '/w/alpha', true)], []);
  assert.deepEqual([...knownFolders(['/w/b'], null, false)], ['/w/b']);
  assert.deepEqual([...knownFolders(['/w/b'], undefined, false)], ['/w/b']);
});

test('scopePending holds 미분류 until the project list has arrived (#761)', async () => {
  const { scopePending } = await import('../../web/src/dispatch/lib/folder.ts');
  assert.equal(scopePending(null, 'loading'), true);
  assert.equal(scopePending(null, 'ready'), false);
  assert.equal(scopePending(null, 'failed'), false);
  assert.equal(scopePending(undefined, 'loading'), false);
  assert.equal(scopePending('/w/alpha', 'loading'), false);
});
