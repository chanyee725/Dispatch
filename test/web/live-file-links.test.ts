// File links in the agent live panel (#905): documents open in the editor, code files in 작업 보기, outside paths never link.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { LiveFile } from '../../shared/dispatch/live.ts';
import { actionFileLink, fileLink, linkablePath } from '../../web/src/live/workView.ts';

const f = (path: string, more: Partial<LiveFile> = {}): LiveFile => ({ path, edited: false, at: 1, doc: false, ...more });

test('a workspace document links to the editor, a code file to 작업 보기', () => {
  assert.deepEqual(fileLink(f('plans/p.dpx.json', { doc: true })), { kind: 'doc', path: 'plans/p.dpx.json' });
  assert.deepEqual(fileLink(f('web/src/a.ts')), { kind: 'code', path: 'web/src/a.ts' });
  assert.deepEqual(fileLink(f('README.md', { edited: true })), { kind: 'code', path: 'README.md' });
});

test('paths outside the workspace and the session folder never link', () => {
  assert.equal(fileLink(f('hosts', { outside: true })), null);
  for (const p of ['/etc/hosts', '~/.ssh/config', '../other/a.ts', 'a/../../b.ts', 'a//b', './a.ts', 'C:/x.ts', 'a\\b.ts', 'a\nb', '']) {
    assert.equal(linkablePath(p), false, p);
    assert.equal(fileLink(f(p)), null, p);
  }
  // A doc flag on something that is not a document is not trusted.
  assert.equal(fileLink(f('notes.md', { doc: true })), null);
});

test('a tool call links only when its target is a touched file and the call is a read, edit or search', () => {
  const files = [f('src/a.ts'), f('hosts', { outside: true }), f('p.dpx.json', { doc: true })];
  assert.deepEqual(actionFileLink({ kind: 'read', target: 'src/a.ts' }, files), { kind: 'code', path: 'src/a.ts' });
  assert.deepEqual(actionFileLink({ kind: 'edit', target: 'p.dpx.json' }, files), { kind: 'doc', path: 'p.dpx.json' });
  assert.equal(actionFileLink({ kind: 'read', target: 'hosts' }, files), null);
  assert.equal(actionFileLink({ kind: 'command', target: 'src/a.ts' }, files), null);
  assert.equal(actionFileLink({ kind: 'test', target: 'npm test' }, files), null);
  assert.equal(actionFileLink({ kind: 'read', target: 'cat src/a.ts' }, files), null);
  assert.equal(actionFileLink({ kind: 'search', target: 'useAgent' }, files), null);
});
