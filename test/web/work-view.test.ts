// 작업 보기 helpers (E673, #905): document vs code mode and the changed-file list from the session diff.
import test from 'node:test';
import assert from 'node:assert/strict';
import { changedFiles, isDocPath, workMode } from '../../web/src/live/workView.ts';
import { parsePatch } from '../../web/src/dispatch/lib/patch.ts';

const patch = [
  'diff --git a/web/a.ts b/web/a.ts',
  'index 1..2 100644',
  '--- a/web/a.ts',
  '+++ b/web/a.ts',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '-old',
  '+new',
  '+more',
  'diff --git a/server/b.js b/server/b.js',
  '--- a/server/b.js',
  '+++ b/server/b.js',
  '@@ -4 +4 @@ fn',
  '-x',
  '+y',
].join('\n');

test('a held document is the work until a code file is edited after it', () => {
  assert.equal(isDocPath('p/plan.dpx.json'), true);
  assert.equal(isDocPath('web/a.ts'), false);
  assert.equal(workMode(null, null, []), 'code');
  assert.equal(workMode('web/a.ts', 5, []), 'code');
  assert.equal(workMode('p/plan.dpx.json', 100, []), 'doc');
  const code = (at: number) => ({ path: 'web/a.ts', edited: true, at, doc: false });
  assert.equal(workMode('p/plan.dpx.json', 100, [code(50)]), 'doc', 'older code edit');
  assert.equal(workMode('p/plan.dpx.json', 100, [code(150)]), 'code', 'newer code edit');
  assert.equal(workMode('p/plan.dpx.json', 100, [{ ...code(150), edited: false }]), 'doc', 'a read is not work');
});

test('changed files come newest edit first, with +/- counts and untracked files', () => {
  const live = [
    { path: 'server/b.js', edited: true, at: 300, doc: false },
    { path: 'web/a.ts', edited: false, at: 400, doc: false },
  ];
  const list = changedFiles({ patch, untracked: ['notes/new.md'] }, live);
  assert.deepEqual(list.map((f) => [f.path, f.add, f.del, f.untracked, f.at]), [
    ['server/b.js', 1, 1, false, 300],
    ['web/a.ts', 2, 1, false, null],
    ['notes/new.md', 0, 0, true, null],
  ]);
  assert.equal(list[0]!.parts[0]!.lines.filter((l) => l.kind === 'add').length, 1);
});

test('the same file in several commits is listed once; live paths match by suffix', () => {
  const twice = `commit abc one\n${patch}\ncommit def two\n${patch.split('\n').slice(0, 9).join('\n')}`;
  assert.equal(parsePatch(twice).length, 3);
  const list = changedFiles({ patch: twice, untracked: [] }, [{ path: 'repo/web/a.ts', edited: true, at: 9, doc: false }]);
  assert.deepEqual(list.map((f) => [f.path, f.add, f.del, f.parts.length]), [
    ['web/a.ts', 4, 2, 2],
    ['server/b.js', 1, 1, 1],
  ]);
});

test('no changes, no files', () => {
  assert.deepEqual(changedFiles({ patch: '', untracked: [] }, []), []);
});
