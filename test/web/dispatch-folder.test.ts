import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inScope, projectOf, sessionsOf } from '../../web/src/dispatch/lib/folder.ts';

const s = (id: string, folder: string | null | undefined, status = 'running') => ({ id, folder, status }) as never;
const known = new Set(['a', 'b c']);

test('scoping: unknown or missing folders count as 미분류', () => {
  const all = [s('1', 'a'), s('2', 'b c'), s('3', null), s('4', undefined), s('5', 'gone')];
  assert.equal(projectOf(all[4], known), null);
  assert.deepEqual(inScope(all, undefined, known).length, 5);
  assert.deepEqual(inScope(all, 'a', known).map((x: { id: string }) => x.id), ['1']);
  assert.deepEqual(inScope(all, null, known).map((x: { id: string }) => x.id), ['3', '4', '5']);
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
