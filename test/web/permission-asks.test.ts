// #836: open permission prompts of sessions as rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askDetail, permissionAsks, shortDetail, withSession } from '../../web/src/activity/permissionAsks.ts';
import type { Session } from '../../shared/dispatch/types.ts';

test('permission prompts become rows (oldest first, with what runs) ', () => {
  const s = (id: string, name: string, since: number, pending: Partial<Session['pending'][number]>[]) =>
    ({ id, name, stateSince: since, updatedAt: since, pending }) as unknown as Session;
  const asks = permissionAsks([
    s('s2', '구현자', 20, [{ requestId: 'r2', tool: 'Bash', input: { command: 'rm -rf build', description: '빌드 지우기' }, description: '' }]),
    s('s1', '리뷰어', 10, [{ requestId: 'r1', tool: '' }, { tool: 'Edit' }]),
    s('s3', '테스터', 5, []),
  ]);
  assert.deepEqual(asks, [
    { sessionId: 's1', session: '리뷰어', requestId: 'r1', tool: '도구', since: 10, detail: null, description: null },
    { sessionId: 's2', session: '구현자', requestId: 'r2', tool: 'Bash', since: 20, detail: 'rm -rf build', description: null },
  ]);
});

test('a permission row shows the command to run, short on one line and whole on request', () => {
  assert.equal(askDetail({ command: '  git push origin feat/x ', description: '푸시' }), 'git push origin feat/x');
  assert.equal(askDetail({ file_path: 'web/src/a.ts' }), 'web/src/a.ts');
  assert.equal(askDetail({ file_path: 'a.ts', old_string: 'x', new_string: 'y' }), JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'y' }, null, 2));
  assert.equal(askDetail({}), null);
  assert.equal(askDetail(undefined), null);
  const long = `echo ${'a'.repeat(300)}\nnext`;
  const short = shortDetail(long);
  assert.equal(short.length, 120);
  assert.ok(short.endsWith('…') && !short.includes('\n'));
  assert.equal(shortDetail('ls -la'), 'ls -la');
  const [ask] = permissionAsks([{ id: 's', name: '구현자', stateSince: 1, pending: [{ requestId: 'r', tool: 'Bash', input: { command: long }, description: '긴 명령', suggestions: [] }] } as unknown as Session]);
  assert.equal(ask.detail, long.trim());
  assert.equal(ask.description, '긴 명령');
});

test('a session event replaces only that session\'s prompts; a removed session drops them', () => {
  const sess = (id: string, since: number, ids: string[]) =>
    ({ id, name: id, stateSince: since, pending: ids.map((r) => ({ requestId: r, tool: 'Bash', input: { command: r }, description: '', suggestions: [] })) }) as unknown as Session;
  const start = permissionAsks([sess('a', 1, ['a1']), sess('b', 2, ['b1'])]);
  // The same pending again: the same array, no re-render.
  assert.equal(withSession(start, sess('a', 1, ['a1'])), start);
  const more = withSession(start, sess('b', 2, ['b1', 'b2']));
  assert.deepEqual(more.map((x) => x.requestId), ['a1', 'b1', 'b2']);
  const answered = withSession(more, sess('a', 1, []));
  assert.deepEqual(answered.map((x) => x.requestId), ['b1', 'b2']);
  assert.deepEqual(withSession(answered, { id: 'b' }, true), []);
});
