// Workspace projects: top-level sub-folder names only (no files, hidden entries, symlinks or reserved names).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProjects, readProjectMeta, topFolderNames } from '../server/workspace/projects.js';
import * as workspace from '../server/workspace/index.js';

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'projects-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'beta'));
  await mkdir(join(dir, 'alpha'));
  await mkdir(join(dir, '.drawing'));
  await mkdir(join(dir, 'worktrees'));
  await writeFile(join(dir, 'loose.dpx.json'), '{}');
  await symlink(join(dir, 'alpha'), join(dir, 'link'));
  return dir;
}

test('topFolderNames: sorted folder names; files, hidden, symlinks and reserved names left out', async (t) => {
  const dir = await scratch(t);
  assert.deepEqual(await topFolderNames(dir), ['alpha', 'beta', 'worktrees']);
  assert.deepEqual(await topFolderNames(dir, ['worktrees']), ['alpha', 'beta']);
  assert.deepEqual(await topFolderNames(join(dir, 'nope')), []);
});

test('listProjects: meta name, icon and description; no documents', async (t) => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'beta', '.project.json'), JSON.stringify({ name: ' 베타 ', icon: '🧪', extra: 1 }));
  const { projects, loose } = await listProjects(dir, ['worktrees']);
  assert.deepEqual(loose, []);
  assert.deepEqual(projects.map((p) => [p.path, p.name, p.icon, p.count, p.docs.length]), [['alpha', 'alpha', null, 0, 0], ['beta', '베타', '🧪', 0, 0]]);
  assert.deepEqual(await readProjectMeta(join(dir, 'alpha')), {});
});

test('workspace module: topFolders() and project mode reserving worktrees', async (t) => {
  const dir = await scratch(t);
  const m = await workspace.setup({ workspaceDir: dir, projectMode: true, modules: {} });
  assert.deepEqual(await m.topFolders(), ['alpha', 'beta']);
  const plain = await workspace.setup({ workspaceDir: dir, projectMode: false, modules: {} });
  assert.deepEqual(await plain.topFolders(), ['alpha', 'beta', 'worktrees']);
});
