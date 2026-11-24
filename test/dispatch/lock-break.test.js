// The .break mutex that guards replacing a stale lock (#199, from the #161 review). Three or more
// servers starting on a dead .break used to let two of them into the critical section: a waiter
// that judged the dead holder, then resumed after someone else had cleared it and taken the break,
// moved or removed the live holder's .break. These tests drive that interleaving in one process with
// owner names instead of pids, so the order is fixed. They pin the new design (a holder is cleared by
// its own file name, a late release or clear touches nothing); against #161's move-aside logic ported
// to this API the first one does not fail, so they do not prove the old race by themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, symlinkSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireBreak, claimLock, clearDeadBreak } from '../../server/lock.js';

const fsp = createRequire(import.meta.url)('node:fs/promises');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDead = async (name) => name.startsWith('dead-');

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-199-'));
  return { dir, brk: join(dir, 'x.lock.break') };
}

test('acquireBreak: a waiter that judged a dead holder and resumes late cannot let a second holder in', async () => {
  const { dir, brk } = scratch();
  try {
    await acquireBreak(brk, { owner: 'dead-D', isDead }); // D takes the break and dies holding it
    let judged;
    const judgedP = new Promise((r) => { judged = r; });
    let resume;
    const gate = new Promise((r) => { resume = r; });
    // A reads the break, judges D dead, and stalls before it acts on that judgement.
    const a = acquireBreak(brk, {
      owner: 'live-A',
      isDead: async (name) => {
        if (name === 'dead-D') { judged(); await gate; }
        return isDead(name);
      },
    });
    let aIn = false;
    a.then(() => { aIn = true; });
    await judgedP;
    // B clears D and takes the break while A is stalled.
    const releaseB = await acquireBreak(brk, { owner: 'live-B', isDead });
    assert.deepEqual(readdirSync(brk), ['live-B']);
    // A resumes with its stale judgement; C arrives too. Neither may get in while B holds.
    resume();
    let cIn = false;
    const c = acquireBreak(brk, { owner: 'live-C', isDead });
    c.then(() => { cIn = true; });
    await sleep(200);
    assert.equal(aIn, false, 'A stays out while B holds');
    assert.equal(cIn, false, 'C stays out while B holds');
    assert.deepEqual(readdirSync(brk), ['live-B'], "B's break is untouched");
    // B lets go: A and C get in one at a time.
    await releaseB();
    const [first, release1] = await Promise.race([a.then((r) => ['A', r]), c.then((r) => ['C', r])]);
    await sleep(100);
    assert.equal(aIn && cIn, false, 'only one of A and C holds');
    assert.deepEqual(readdirSync(brk), [`live-${first}`]);
    await release1();
    const release2 = await (first === 'A' ? c : a);
    await release2();
    assert.deepEqual(readdirSync(dir), [], 'no break, staging or aside files left behind');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireBreak: several waiters on one dead holder enter one at a time', async () => {
  const { dir, brk } = scratch();
  try {
    await acquireBreak(brk, { owner: 'dead-D', isDead });
    let inside = 0;
    let most = 0;
    await Promise.all(Array.from({ length: 6 }, async (_, i) => {
      const release = await acquireBreak(brk, { owner: `live-${i}`, isDead });
      inside++;
      most = Math.max(most, inside);
      await sleep(5);
      inside--;
      await release();
    }));
    assert.equal(most, 1);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireBreak: a release never removes a break someone else holds', async () => {
  const { dir, brk } = scratch();
  try {
    const releaseA = await acquireBreak(brk, { owner: 'live-A', isDead });
    // A was wrongly judged gone and its break was replaced by B's; A's late release must not touch B's.
    rmSync(brk, { recursive: true });
    const releaseB = await acquireBreak(brk, { owner: 'live-B', isDead });
    await releaseA();
    assert.deepEqual(readdirSync(brk), ['live-B']);
    await releaseB();
    assert.equal(existsSync(brk), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireBreak: an old-style .break file is cleared when its pid is dead and waited on when it is live', async () => {
  const { dir, brk } = scratch();
  try {
    writeFileSync(brk, JSON.stringify({ pid: 2 ** 22 + 54321 }));
    const release = await acquireBreak(brk, { owner: 'live-A', isDead });
    assert.deepEqual(readdirSync(brk), ['live-A']);
    await release();
    writeFileSync(brk, JSON.stringify({ pid: process.pid }));
    await assert.rejects(acquireBreak(brk, { owner: 'live-B', isDead, tries: 5 }), { name: 'LockBreakTimeoutError' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireBreak: a .break symlink to another folder is removed itself and its target is left alone', async () => {
  const { dir, brk } = scratch();
  try {
    const other = join(dir, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'dead-keep'), 'x');
    writeFileSync(join(other, 'precious.txt'), 'x');
    symlinkSync(other, brk);
    const release = await acquireBreak(brk, { owner: 'live-A', isDead });
    assert.deepEqual(readdirSync(other).sort(), ['dead-keep', 'precious.txt'], 'target folder untouched');
    assert.equal(lstatSync(brk).isSymbolicLink(), false, 'the link itself is gone');
    await release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireBreak: with the default check, only <pid>-<uuid> names count as owners', async () => {
  const { dir, brk } = scratch();
  try {
    mkdirSync(brk);
    writeFileSync(join(brk, 'precious.txt'), 'x'); // not an owner name: never judged dead or removed
    await assert.rejects(acquireBreak(brk, { owner: 'live-A', tries: 5 }), { name: 'LockBreakTimeoutError' });
    assert.deepEqual(readdirSync(brk), ['precious.txt']);
    rmSync(join(brk, 'precious.txt'));
    writeFileSync(join(brk, `${2 ** 22 + 54321}-00000000-0000-4000-8000-000000000000`), '');
    const release = await acquireBreak(brk, { owner: `${process.pid}-live` });
    await release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireBreak: an old-style file replaced by a folder mid-clear does not throw', async () => {
  const { dir, brk } = scratch();
  try {
    writeFileSync(brk, JSON.stringify({ pid: 2 ** 22 + 54321 }));
    // Simulate the race: a folder appears where the dead old file was, right as rm runs.
    const release = await acquireBreak(brk, { owner: 'live-A', isDead });
    await release();
    mkdirSync(brk);
    const release2 = await acquireBreak(brk, { owner: 'live-B', isDead });
    await release2();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireBreak: a staging folder left by a dead process is swept, one from a live process stays', async () => {
  const { dir, brk } = scratch();
  try {
    const deadStage = `${brk}.2147483646-00000000-0000-0000-0000-000000000000.tmp`;
    const liveStage = `${brk}.${process.pid}-11111111-1111-1111-1111-111111111111.tmp`;
    for (const s of [deadStage, liveStage]) mkdirSync(s);
    const release = await acquireBreak(brk);
    await release();
    assert.equal(existsSync(deadStage), false);
    assert.equal(existsSync(liveStage), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #205: clearDeadBreak on its own. A live holder's .break is never moved or removed; only dead
// owner names are unlinked, and the folder goes only once it is empty.
test('clearDeadBreak: a live holder is left in place and nothing is cleared', async () => {
  const { dir, brk } = scratch();
  try {
    mkdirSync(brk);
    writeFileSync(join(brk, 'live-A'), '');
    assert.equal(await clearDeadBreak(brk, isDead), false);
    assert.deepEqual(readdirSync(brk), ['live-A']);
    assert.deepEqual(readdirSync(dir), ['x.lock.break'], 'nothing moved aside');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearDeadBreak: a dead holder is unlinked and the emptied folder removed', async () => {
  const { dir, brk } = scratch();
  try {
    mkdirSync(brk);
    writeFileSync(join(brk, 'dead-D'), '');
    assert.equal(await clearDeadBreak(brk, isDead), true);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearDeadBreak: a live holder next to a dead name keeps the folder and its own file', async () => {
  const { dir, brk } = scratch();
  try {
    mkdirSync(brk);
    writeFileSync(join(brk, 'dead-D'), '');
    writeFileSync(join(brk, 'live-B'), '');
    assert.equal(await clearDeadBreak(brk, isDead), true);
    assert.deepEqual(readdirSync(brk), ['live-B']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearDeadBreak: a dead name already cleared by someone else, then taken by a live holder, is a no-op', async () => {
  const { dir, brk } = scratch();
  try {
    mkdirSync(brk);
    writeFileSync(join(brk, 'dead-D'), '');
    // Between the readdir and the unlink, another waiter clears D and B takes the break.
    const swap = async (name) => {
      rmSync(brk, { recursive: true });
      mkdirSync(brk);
      writeFileSync(join(brk, 'live-B'), '');
      return isDead(name);
    };
    assert.equal(await clearDeadBreak(brk, swap), false);
    assert.deepEqual(readdirSync(brk), ['live-B'], "B's break is untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clearDeadBreak: a missing or empty .break counts as cleared', async () => {
  const { dir, brk } = scratch();
  try {
    assert.equal(await clearDeadBreak(brk, isDead), true);
    mkdirSync(brk);
    assert.equal(await clearDeadBreak(brk, isDead), true);
    assert.equal(existsSync(brk), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireBreak: held() turns false once our break was cleared and taken by someone else', async () => {
  const { dir, brk } = scratch();
  try {
    const releaseA = await acquireBreak(brk, { owner: 'dead-A', isDead });
    assert.equal(await releaseA.held(), true);
    const releaseB = await acquireBreak(brk, { owner: 'live-B', isDead }); // judges A dead, clears it
    assert.equal(await releaseA.held(), false, 'A must not act as the holder any more');
    assert.equal(await releaseB.held(), true);
    await releaseA();
    assert.deepEqual(readdirSync(brk), ['live-B']);
    await releaseB();
    assert.equal(await releaseB.held(), false);
    assert.equal(existsSync(brk), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #343: the held() check in removeIfUnchanged, driven through claimLock. Right after our rename into
// `.break`, another server judges us dead, clears our owner file and takes the break (B) while the
// stale lock is still in place. We must not delete it under B; claimLock retries and gets in only
// after B lets go. Before #340 the stale lock was removed while B held the break.
test('claimLock: a stale lock is left alone while our .break entry is gone, and claimLock retries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-343-'));
  const file = join(dir, 'x.lock');
  const brk = `${file}.break`;
  const stale = JSON.stringify({ pid: 2 ** 22 + 54321, port: null });
  writeFileSync(file, stale);
  const other = `${process.pid}-00000000-0000-4000-8000-000000000343`; // a live owner name, never judged dead
  const realRename = fsp.rename;
  let entries = 0;
  let staleWhileBHeld = null;
  let bLeft;
  fsp.rename = async (from, to) => {
    await realRename(from, to);
    if (to !== brk || entries++ > 0) return;
    // We just took the break. B clears our owner file and takes it over.
    for (const name of readdirSync(brk)) rmSync(join(brk, name));
    writeFileSync(join(brk, other), '');
    bLeft = sleep(50).then(() => {
      staleWhileBHeld = existsSync(file) && readFileSync(file, 'utf8') === stale;
      rmSync(brk, { recursive: true, force: true });
    });
  };
  syncBuiltinESMExports();
  try {
    const res = await claimLock(file, { isLive: async () => false });
    await bLeft;
    assert.equal(staleWhileBHeld, true, 'the stale lock stays while B holds the break');
    assert.ok(entries >= 2, 'claimLock retried and took the break again');
    assert.equal(res.ok, true);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, process.pid);
    await res.lock.release();
  } finally {
    fsp.rename = realRename;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});
