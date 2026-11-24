// Issue #782: an older version's <project>/.dispatch moves to <project>/.atelier once, never over
// existing files, never while a session is saved or another server holds the folder. Scratch git
// repos in temp dirs; no agent CLI is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimState, copyUserStateSync } from '../../server/dispatch/state-migrate.js';

function scratchRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atelier-782-')));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  return { root, git };
}

/** An older version's .dispatch: state.json, a server log, one worktree under wt/. */
function legacyState(root, git, state = { seq: 3, sessions: {}, ledger: { a: 1 } }) {
  const old = join(root, '.dispatch');
  mkdirSync(old);
  writeFileSync(join(old, 'state.json'), JSON.stringify(state));
  writeFileSync(join(old, 'server.log'), 'log\n');
  git('worktree', 'add', '-q', join(old, 'wt', 'impl-1'), '-b', 'dispatch/impl-1');
  writeFileSync(join(old, 'wt', 'impl-1', 'work.txt'), 'kept\n');
  return old;
}

const tree = (dir) => readdirSync(dir).sort();

test('claimState: .dispatch moves to .atelier once, wt/ becomes worktrees/ and git still knows the worktree', async () => {
  const { root, git } = scratchRepo();
  try {
    legacyState(root, git);
    const c = await claimState(root);
    assert.equal(c.ok, true);
    assert.equal(c.moved, true);
    assert.equal(c.layout.dir, join(root, '.atelier'));
    assert.equal(existsSync(join(root, '.dispatch')), false, 'no .dispatch left');
    assert.deepEqual(tree(join(root, '.atelier')), ['drawing.lock', 'server.log', 'state.json', 'worktrees']);
    assert.equal(JSON.parse(readFileSync(join(root, '.atelier', 'state.json'), 'utf8')).seq, 3);
    const wt = join(root, '.atelier', 'worktrees', 'impl-1');
    assert.equal(readFileSync(join(wt, 'work.txt'), 'utf8'), 'kept\n');
    assert.match(git('worktree', 'list', '--porcelain'), new RegExp(`worktree ${wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
    assert.equal(execFileSync('git', ['-C', wt, 'branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dispatch/impl-1');
    assert.match(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8'), /^\/\.atelier\/worktrees\/$/m);
    await c.lock.release();
    // Second start: nothing to move, nothing named .dispatch is made.
    const again = await claimState(root);
    assert.equal(again.ok, true);
    assert.equal(again.moved, undefined);
    assert.equal(existsSync(join(root, '.dispatch')), false);
    await again.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimState: a saved session keeps .dispatch in use, nothing is moved, the move happens once it is gone', async () => {
  const { root, git } = scratchRepo();
  try {
    const old = legacyState(root, git, { seq: 1, sessions: { s1: { id: 's1', cwd: 'x' } } });
    const before = tree(old);
    const c = await claimState(root);
    assert.equal(c.ok, true);
    assert.equal(c.kept, 'sessions');
    assert.equal(c.layout.dir, old);
    assert.equal(c.layout.worktrees, join(old, 'wt'));
    assert.deepEqual(tree(old), [...before, 'drawing.lock'].sort());
    assert.equal(existsSync(join(root, '.atelier')), false, 'no empty .atelier left behind');
    await c.lock.release();
    writeFileSync(join(old, 'state.json'), JSON.stringify({ seq: 1, sessions: {} }));
    const later = await claimState(root);
    assert.equal(later.moved, true);
    await later.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimState: never overwrites — a name already in .atelier stops the whole move', async () => {
  const { root, git } = scratchRepo();
  try {
    const old = legacyState(root, git);
    mkdirSync(join(root, '.atelier'));
    writeFileSync(join(root, '.atelier', 'server.log'), 'new\n');
    writeFileSync(join(root, '.atelier', 'doc.dpx.json'), '{}');
    const c = await claimState(root);
    assert.equal(c.kept, 'conflict');
    assert.equal(c.layout.dir, old);
    assert.equal(readFileSync(join(root, '.atelier', 'server.log'), 'utf8'), 'new\n');
    assert.equal(readFileSync(join(old, 'server.log'), 'utf8'), 'log\n');
    assert.deepEqual(tree(join(root, '.atelier')), ['doc.dpx.json', 'server.log'], 'only the lock came and went');
    assert.ok(existsSync(join(old, 'wt', 'impl-1', 'work.txt')));
    await c.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimState: a broken state.json is not moved', async () => {
  const { root, git } = scratchRepo();
  try {
    const old = legacyState(root, git);
    writeFileSync(join(old, 'state.json'), '{not json');
    const c = await claimState(root);
    assert.equal(c.kept, 'unreadable');
    assert.ok(existsSync(join(old, 'state.json')));
    await c.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimState: another live server holding .dispatch/drawing.lock refuses, nothing moved or made', async () => {
  const { root, git } = scratchRepo();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    const old = legacyState(root, git);
    writeFileSync(join(old, 'drawing.lock'), JSON.stringify({ pid: child.pid, port: null }));
    const before = tree(old);
    const c = await claimState(root);
    assert.equal(c.ok, false);
    assert.equal(c.reason, 'other-drawing');
    assert.deepEqual(tree(old), before);
    assert.equal(existsSync(join(root, '.atelier')), false);
  } finally {
    child.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimState: a symlinked .dispatch is never followed or moved', async () => {
  const { root } = scratchRepo();
  const outside = mkdtempSync(join(tmpdir(), 'atelier-782-out-'));
  try {
    writeFileSync(join(outside, 'state.json'), '{}');
    symlinkSync(outside, join(root, '.dispatch'));
    const c = await claimState(root);
    assert.equal(c.ok, true);
    assert.equal(c.layout.dir, join(root, '.atelier'));
    assert.ok(lstatSync(join(root, '.dispatch')).isSymbolicLink());
    assert.deepEqual(tree(outside), ['state.json']);
    await c.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('claimState: a project with no .dispatch never gets one', async () => {
  const { root } = scratchRepo();
  try {
    const c = await claimState(root);
    assert.equal(c.ok, true);
    assert.equal(existsSync(join(root, '.dispatch')), false);
    assert.deepEqual(tree(join(root, '.atelier')), ['drawing.lock']);
    await c.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ~/.dispatch → ~/.atelier: HOME is a temp folder passed in env, never the real one.
function scratchHome() {
  const home = mkdtempSync(join(tmpdir(), 'atelier-782-home-'));
  mkdirSync(join(home, '.dispatch'));
  writeFileSync(join(home, '.dispatch', 'drawing.json'), '{"theme":"dark"}\n', { mode: 0o600 });
  writeFileSync(join(home, '.dispatch', 'limits.json'), '{"claude":{}}\n');
  writeFileSync(join(home, '.dispatch', 'other.txt'), 'not ours\n');
  return home;
}

test('copyUserStateSync: copies the known files once, leaves ~/.dispatch alone, never brings a deleted file back', () => {
  const home = scratchHome();
  try {
    const env = { HOME: home };
    assert.equal(copyUserStateSync(env), 'copied');
    assert.equal(readFileSync(join(home, '.atelier', 'drawing.json'), 'utf8'), '{"theme":"dark"}\n');
    assert.equal(lstatSync(join(home, '.atelier', 'drawing.json')).mode & 0o777, 0o600);
    assert.deepEqual(tree(join(home, '.atelier')), ['.copied-from-dispatch', 'drawing.json', 'limits.json']);
    assert.deepEqual(tree(join(home, '.dispatch')), ['drawing.json', 'limits.json', 'other.txt']);
    rmSync(join(home, '.atelier', 'drawing.json'));
    assert.equal(copyUserStateSync(env), 'done');
    assert.equal(existsSync(join(home, '.atelier', 'drawing.json')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('copyUserStateSync: a file already in ~/.atelier is never overwritten; a symlink is never copied', () => {
  const home = scratchHome();
  try {
    mkdirSync(join(home, '.atelier'));
    writeFileSync(join(home, '.atelier', 'drawing.json'), '{"theme":"light"}\n');
    rmSync(join(home, '.dispatch', 'limits.json'));
    symlinkSync('/etc/hostname', join(home, '.dispatch', 'limits.json'));
    assert.equal(copyUserStateSync({ HOME: home }), 'done');
    assert.equal(readFileSync(join(home, '.atelier', 'drawing.json'), 'utf8'), '{"theme":"light"}\n');
    assert.equal(existsSync(join(home, '.atelier', 'limits.json')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('copyUserStateSync: nothing to copy makes no ~/.atelier; DRAWING_USER_DEFAULTS=off does nothing', () => {
  const home = mkdtempSync(join(tmpdir(), 'atelier-782-home-'));
  try {
    assert.equal(copyUserStateSync({ HOME: home }), 'nothing');
    assert.equal(existsSync(join(home, '.atelier')), false);
    mkdirSync(join(home, '.dispatch'));
    writeFileSync(join(home, '.dispatch', 'drawing.json'), '{}');
    assert.equal(copyUserStateSync({ HOME: home, DRAWING_USER_DEFAULTS: 'off' }), 'off');
    assert.equal(existsSync(join(home, '.atelier')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
