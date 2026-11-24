// atelier-team team.sh presets and per-role models (#825). team.sh runs from a temp plugin tree with a fake
// start.sh against a stub HTTP server that records POST /api/sessions bodies; no real server or CLI runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { stubServer, pluginTree, runScript, MAX_CHILDREN } from './helpers/atelier-team.mjs';

async function runTeam(preset, env, { task = 'Issue #1', ...state } = {}) {
  const stub = await stubServer(state);
  const tree = pluginTree();
  try {
    const r = await runScript(join(tree.scripts, 'team.sh'), [tree.dir, preset, task], { DISPATCH_PORT: String(stub.port), ...env });
    return { ...r, posts: stub.posts, sessions: stub.sessions };
  } finally {
    stub.close();
    tree.cleanup();
  }
}

const roles = (posts) => posts.flatMap((p) => p.items.map((i) => i.role));

test('team.sh small preset: lead, then impl, review, a tester, the PR and merge roles as its children; role defaults pick the models', async () => {
  const r = await runTeam('small', { DISPATCH_TEAM_ROLE_MODELS: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(roles(r.posts), ['lead', 'impl', 'review', 'test', 'pr', 'merge']);
  assert.ok(r.posts.every((p) => p.items.every((i) => i.issue === 1)), 'every session records the issue from the task');
  assert.equal(r.posts[1].parent, 'id-1');
  assert.ok(r.posts.every((p) => p.items.every((i) => !('model' in i))), 'no model override without env');
  assert.ok(r.posts.every((p) => !('mode' in p)), 'no mode without DISPATCH_TEAM_MODE');
});

test('team.sh DISPATCH_TEAM_ROLE_MODELS sets only the named roles; DISPATCH_TEAM_MODEL still wins for all', async () => {
  const r = await runTeam('small', { DISPATCH_TEAM_ROLE_MODELS: '{"impl":"gemini-3.8-flash-high"}' });
  assert.equal(r.status, 0, r.stderr);
  const byRole = Object.fromEntries(r.posts.flatMap((p) => p.items).map((i) => [i.role, i.model]));
  assert.deepEqual(byRole, { lead: undefined, impl: 'gemini-3.8-flash-high', review: undefined, test: undefined, pr: undefined, merge: undefined });

  const all = await runTeam('small', { DISPATCH_TEAM_ROLE_MODELS: '{"impl":"gemini-3.8-flash-high"}', DISPATCH_TEAM_MODEL: 'claude-haiku-5-5' });
  assert.ok(all.posts.flatMap((p) => p.items).every((i) => i.model === 'claude-haiku-5-5'));
});

test('team.sh refuses DISPATCH_TEAM_ROLE_MODELS that is not JSON before creating any session', async () => {
  const r = await runTeam('small', { DISPATCH_TEAM_ROLE_MODELS: 'impl=gemini' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /DISPATCH_TEAM_ROLE_MODELS is not JSON/);
  assert.equal(r.posts.length, 0);
});

test('team.sh DISPATCH_TEAM_MODE sends that mode with every create call (#856); an unknown mode makes nothing', async () => {
  const r = await runTeam('small', { DISPATCH_TEAM_MODE: 'research' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.posts.map((p) => p.mode), ['research', 'research']);
  const bad = await runTeam('small', { DISPATCH_TEAM_MODE: 'search' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /DISPATCH_TEAM_MODE is one of/);
  assert.equal(bad.posts.length, 0);
});

test('every preset ends with the PR and merge roles and fits the default maxChildren (#1031)', async () => {
  for (const preset of ['small', 'risky', 'standard', 'ui', 'full']) {
    const r = await runTeam(preset, {});
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(roles(r.posts).slice(-2), ['pr', 'merge'], preset);
    const teammates = r.posts[1].items.reduce((a, i) => a + (i.n || 1), 0);
    assert.ok(teammates <= MAX_CHILDREN, `${preset}: ${teammates} teammates > ${MAX_CHILDREN}`);
    assert.equal(r.sessions.filter((s) => s.parent === 'id-1').length, teammates, `${preset}: every teammate was made`);
  }
});

test('team.sh run twice for one issue makes one lead; the second run prints that lead and creates nothing (#1031)', async () => {
  const stub = await stubServer();
  const tree = pluginTree();
  try {
    const env = { DISPATCH_PORT: String(stub.port) };
    const a = await runScript(join(tree.scripts, 'team.sh'), [tree.dir, 'small', 'Issue #1031: roles'], env);
    assert.equal(a.status, 0, a.stderr);
    const b = await runScript(join(tree.scripts, 'team.sh'), [tree.dir, 'small', 'Issue #1031 again'], env);
    assert.equal(b.status, 0, b.stderr);
    assert.equal(b.stdout.trim(), 'S1');
    assert.match(b.stderr, /Issue #1031 already has a live lead \(S1\); no new team started/);
    assert.equal(stub.posts.length, 2, 'only the first run posted');
    assert.equal(stub.sessions.filter((s) => s.role === 'lead').length, 1);
  } finally {
    stub.close();
    tree.cleanup();
  }
});

test('a live lead holds an issue through its session task line or an open board task; done, failed and other issues do not', async () => {
  const lead = (x) => ({ id: 'L', name: 'Leo', role: 'lead', canSpawn: true, status: 'running', issue: null, ...x });
  const held = [
    { sessions: [lead({ issue: 1031 })] },
    { sessions: [lead({ task: '#1031 역할 추가' })] },
    { sessions: [lead({ status: 'waiting' })], tasks: [{ lead: 'L', title: 'E716 #1031', stage: 'impl' }] },
  ];
  for (const state of held) {
    const r = await runTeam('small', {}, { task: 'Issue #1031', ...state });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'Leo', JSON.stringify(state));
    assert.equal(r.posts.length, 0);
  }
  const free = [
    { sessions: [lead({ issue: 1031, status: 'done' })] },
    { sessions: [lead({ issue: 1031, status: 'error' })] },
    { sessions: [lead({ issue: 10311 })] },
    { sessions: [lead({ status: 'idle' })], tasks: [{ lead: 'L', title: '#1031', stage: 'done' }] },
    { sessions: [lead({ issue: 1031, canSpawn: false, role: 'impl' })] },
  ];
  for (const state of free) {
    const r = await runTeam('small', {}, { task: 'Issue #1031', ...state });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.posts.length, 2, JSON.stringify(state));
  }
  const ignored = await runTeam('small', { DISPATCH_TEAM_IGNORE_LEAD: 'Leo' }, { task: 'Issue #1031', sessions: [lead({ task: 'next #1031' })] });
  assert.equal(ignored.posts.length, 2, 'the lead being replaced does not hold the issue');
});

test('a live merge role in the project is reused: the new team gets none and the lead is told its name', async () => {
  const r = await runTeam('small', {}, { sessions: [{ id: 'M', name: 'Max', role: 'merge', canSpawn: false, status: 'idle' }] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(roles(r.posts), ['lead', 'impl', 'review', 'test', 'pr']);
  assert.match(r.posts[0].commonPrompt, /The merge role of this project is Max/);
  const gone = await runTeam('small', {}, { sessions: [{ id: 'M', name: 'Max', role: 'merge', canSpawn: false, status: 'done' }] });
  assert.deepEqual(roles(gone.posts).slice(-1), ['merge']);
  // A child of the lead being replaced (DISPATCH_TEAM_IGNORE_LEAD) is about to be removed, so it is not reused.
  const relayed = await runTeam('small', { DISPATCH_TEAM_IGNORE_LEAD: 'L' }, { sessions: [
    { id: 'L', name: 'Leo', role: 'lead', canSpawn: true, status: 'idle', parent: null },
    { id: 'M', name: 'Max', role: 'merge', canSpawn: false, status: 'idle', parent: 'L' },
  ] });
  assert.equal(relayed.status, 0, relayed.stderr);
  assert.deepEqual(roles(relayed.posts).slice(-1), ['merge']);
  assert.doesNotMatch(relayed.posts[0].commonPrompt, /The merge role of this project is/);
});

test('team.sh refuses a preset bigger than the project\'s maxChildren before any session exists (#1034)', async () => {
  const r = await runTeam('full', {}, { settings: { team: { maxChildren: 5 } } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /8 teammates but maxChildren is 5/);
  assert.equal(r.posts.length, 0, 'no lead left holding the issue');
  const ok = await runTeam('risky', {}, { settings: { team: { maxChildren: 5 } } });
  assert.equal(ok.status, 0, ok.stderr);
});

test('team.sh removes its lead when the teammates are refused, so a rerun is not blocked by a lone lead (#1034)', async () => {
  const r = await runTeam('small', {}, { failTeam: 'Gemini 한도에 닿았어요' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Gemini 한도에 닿았어요/);
  assert.match(r.stderr, /its lead was removed/);
  assert.equal(r.posts.length, 2);
  assert.deepEqual(r.sessions, [], 'the lead made first is gone');
});
