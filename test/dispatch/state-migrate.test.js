// Issue #782, renamed for Dispatch 1.0: the app's older <project>/.atelier is copied to
// <project>/.dispatch once, never over existing files, never while a session is saved or another
// server holds the folder, and .atelier itself is never changed. A standalone Dispatch's .dispatch
// (worktrees in wt/) is used as it is. Scratch git repos in temp dirs; no agent CLI is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimState, copyUserStateSync } from '../../server/dispatch/state-migrate.js';

function scratchRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dispatch-782-')));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  return { root, git };
}

/** The Atelier days' .atelier: state.json, a server log and port, saved chat, one worktree under worktrees/. */
function atelierState(root, git, state = { seq: 3, sessions: {}, ledger: { a: 1 } }) {
  const old = join(root, '.atelier');
  mkdirSync(join(old, 'chat'), { recursive: true });
  writeFileSync(join(old, 'state.json'), JSON.stringify(state));
  writeFileSync(join(old, 'server.log'), 'log\n');
  writeFileSync(join(old, 'server.port'), '4330\n');
  writeFileSync(join(old, 'chat', '2026-11-01-a.json'), '{"m":1}');
  git('worktree', 'add', '-q', join(old, 'worktrees', 'impl-1'), '-b', 'dispatch/impl-1');
  writeFileSync(join(old, 'worktrees', 'impl-1', 'work.txt'), 'kept\n');
  return old;
}

/** Every path under dir with its file contents, to prove a folder was not changed. */
function snapshot(dir) {
  const out = {};
  const walk = (d, rel) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n), r = rel ? `${rel}/${n}` : n;
      if (n === '.git') { out[r] = 'git'; continue; }
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p, r); else out[r] = readFileSync(p, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

const tree = (dir) => readdirSync(dir).sort();

test('claimState: .atelier is copied to .dispatch once, .atelier stays exactly as it was', async () => {
  const { root, git } = scratchRepo();
  try {
    const old = atelierState(root, git);
    const before = snapshot(old);
    const c = await claimState(root);
    assert.equal(c.ok, true);
    assert.equal(c.copied, true);
    assert.equal(c.layout.dir, join(root, '.dispatch'));
    assert.equal(c.layout.worktrees, join(root, '.dispatch', 'worktrees'));
    assert.deepEqual(tree(join(root, '.dispatch')), ['chat', 'drawing.lock', 'state.json']);
    assert.equal(JSON.parse(readFileSync(join(root, '.dispatch', 'state.json'), 'utf8')).seq, 3);
    assert.equal(readFileSync(join(root, '.dispatch', 'chat', '2026-11-01-a.json'), 'utf8'), '{"m":1}');
    await c.lock.release();
    assert.deepEqual(snapshot(old), before, '.atelier untouched');
    assert.match(git('worktree', 'list', '--porcelain'), /\.atelier\/worktrees\/impl-1\n/, 'git still knows the old worktree');
    // Second start: .dispatch has state now, nothing is copied again.
    writeFileSync(join(old, 'state.json'), JSON.stringify({ seq: 99, sessions: {} }));
    const again = await claimState(root);
    assert.equal(again.ok, true);
    assert.equal(again.copied, undefined);
    assert.equal(JSON.parse(readFileSync(join(root, '.dispatch', 'state.json'), 'utf8')).seq, 3);
    await again.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimState: a saved session keeps .atelier in use, nothing is copied, the copy happens once it is gone', async () => {
  const { root, git } = scratchRepo();
  try {
    const old = atelierState(root, git, { seq: 1, sessions: { s1: { id: 's1', cwd: 'x' } } });
    const before = tree(old);
    const c = await claimState(root);
    assert.equal(c.ok, true);
    assert.equal(c.kept, 'sessions');
    assert.equal(c.layout.dir, old);
    assert.equal(c.layout.worktrees, join(old, 'worktrees'));
    assert.deepEqual(tree(old), [...before, 'drawing.lock'].sort());
    assert.deepEqual(existsSync(join(root, '.dispatch')) ? tree(join(root, '.dispatch')) : [], [], 'nothing left in .dispatch');
    await c.lock.release();
    writeFileSync(join(old, 'state.json'), JSON.stringify({ seq: 1, sessions: {} }));
    const later = await claimState(root);
    assert.equal(later.copied, true);
    await later.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimState: never overwrites a name .dispatch already has (the workspace folder start.sh makes)', async () => {
  const { root, git } = scratchRepo();
  try {
    atelierState(root, git);
    mkdirSync(join(root, '.dispatch', 'chat'), { recursive: true });
    writeFileSync(join(root, '.dispatch', 'chat', 'new.json'), 'new');
    const c = await claimState(root);
    assert.equal(c.copied, true);
    assert.deepEqual(tree(join(root, '.dispatch', 'chat')), ['new.json']);
    assert.ok(existsSync(join(root, '.dispatch', 'state.json')));
    await c.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimState: a broken .atelier/state.json is not copied and .atelier stays in use', async () => {
  const { root, git } = scratchRepo();
  try {
    const old = atelierState(root, git);
    writeFileSync(join(old, 'state.json'), '{not json');
    const c = await claimState(root);
    assert.equal(c.kept, 'unreadable');
    assert.equal(c.layout.dir, old);
    assert.equal(existsSync(join(root, '.dispatch', 'state.json')), false);
    await c.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimState: an Atelier server holding .atelier/drawing.lock refuses, nothing copied', async () => {
  const { root, git } = scratchRepo();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    const old = atelierState(root, git);
    writeFileSync(join(old, 'drawing.lock'), JSON.stringify({ pid: child.pid, port: null }));
    const before = snapshot(old);
    const c = await claimState(root);
    assert.equal(c.ok, false);
    assert.equal(c.reason, 'other-drawing');
    assert.deepEqual(snapshot(old), before);
    assert.equal(existsSync(join(root, '.dispatch')), false);
  } finally {
    child.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimState: a standalone Dispatch .dispatch with wt/ is used as it is, .atelier next to it is ignored', async () => {
  const { root, git } = scratchRepo();
  try {
    atelierState(root, git);
    const d = join(root, '.dispatch');
    mkdirSync(d);
    writeFileSync(join(d, 'state.json'), JSON.stringify({ seq: 7, sessions: { a: { id: 'a' } } }));
    git('worktree', 'add', '-q', join(d, 'wt', 'lead-1'), '-b', 'dispatch/lead-1');
    const c = await claimState(root);
    assert.equal(c.ok, true);
    assert.equal(c.copied, undefined);
    assert.equal(c.layout.dir, d);
    assert.equal(c.layout.worktrees, join(d, 'wt'));
    assert.equal(JSON.parse(readFileSync(join(d, 'state.json'), 'utf8')).seq, 7);
    await c.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimState: a symlinked .atelier is never followed', async () => {
  const { root } = scratchRepo();
  const outside = mkdtempSync(join(tmpdir(), 'dispatch-782-out-'));
  try {
    writeFileSync(join(outside, 'state.json'), '{}');
    symlinkSync(outside, join(root, '.atelier'));
    const c = await claimState(root);
    assert.equal(c.ok, true);
    assert.equal(c.layout.dir, join(root, '.dispatch'));
    assert.deepEqual(tree(join(root, '.dispatch')), ['drawing.lock']);
    assert.deepEqual(tree(outside), ['state.json']);
    await c.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('claimState: a project with no .atelier never gets one', async () => {
  const { root } = scratchRepo();
  try {
    const c = await claimState(root);
    assert.equal(c.ok, true);
    assert.equal(existsSync(join(root, '.atelier')), false);
    assert.deepEqual(tree(join(root, '.dispatch')), ['drawing.lock']);
    await c.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ~/.atelier → ~/.dispatch: HOME is a temp folder passed in env, never the real one.
function scratchHome() {
  const home = mkdtempSync(join(tmpdir(), 'dispatch-782-home-'));
  mkdirSync(join(home, '.atelier'));
  writeFileSync(join(home, '.atelier', 'drawing.json'), '{"theme":"dark"}\n', { mode: 0o600 });
  writeFileSync(join(home, '.atelier', 'limits.json'), '{"claude":{}}\n');
  writeFileSync(join(home, '.atelier', 'other.txt'), 'not ours\n');
  return home;
}

test('copyUserStateSync: copies the known files once, leaves ~/.atelier alone, never brings a deleted file back', () => {
  const home = scratchHome();
  try {
    const env = { HOME: home };
    assert.equal(copyUserStateSync(env), 'copied');
    assert.equal(readFileSync(join(home, '.dispatch', 'drawing.json'), 'utf8'), '{"theme":"dark"}\n');
    assert.equal(lstatSync(join(home, '.dispatch', 'drawing.json')).mode & 0o777, 0o600);
    assert.deepEqual(tree(join(home, '.dispatch')), ['.copied-from-atelier', 'drawing.json', 'limits.json']);
    assert.deepEqual(tree(join(home, '.atelier')), ['drawing.json', 'limits.json', 'other.txt']);
    rmSync(join(home, '.dispatch', 'drawing.json'));
    assert.equal(copyUserStateSync(env), 'done');
    assert.equal(existsSync(join(home, '.dispatch', 'drawing.json')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('copyUserStateSync: a file already in ~/.dispatch is never overwritten; a symlink is never copied', () => {
  const home = scratchHome();
  try {
    mkdirSync(join(home, '.dispatch', 'servers'), { recursive: true });
    writeFileSync(join(home, '.dispatch', 'drawing.json'), '{"theme":"light"}\n');
    writeFileSync(join(home, '.dispatch', 'servers', '4000.json'), '{"port":4000}');
    rmSync(join(home, '.atelier', 'limits.json'));
    symlinkSync('/etc/hostname', join(home, '.atelier', 'limits.json'));
    assert.equal(copyUserStateSync({ HOME: home }), 'done');
    assert.equal(readFileSync(join(home, '.dispatch', 'drawing.json'), 'utf8'), '{"theme":"light"}\n');
    assert.equal(existsSync(join(home, '.dispatch', 'limits.json')), false);
    assert.equal(readFileSync(join(home, '.dispatch', 'servers', '4000.json'), 'utf8'), '{"port":4000}', 'the standalone registry is left alone');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('copyUserStateSync: nothing to copy makes no ~/.dispatch; DRAWING_USER_DEFAULTS=off does nothing', () => {
  const home = mkdtempSync(join(tmpdir(), 'dispatch-782-home-'));
  try {
    assert.equal(copyUserStateSync({ HOME: home }), 'nothing');
    assert.equal(existsSync(join(home, '.dispatch')), false);
    mkdirSync(join(home, '.atelier'));
    writeFileSync(join(home, '.atelier', 'drawing.json'), '{}');
    assert.equal(copyUserStateSync({ HOME: home, DRAWING_USER_DEFAULTS: 'off' }), 'off');
    assert.equal(existsSync(join(home, '.dispatch')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
