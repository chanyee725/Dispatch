// The Dispatch module inside Drawing (E11): routes adapter, one SSE stream, write header, isolation.
// Runs against a scratch git repo with one commit in a temp dir; no agent CLI is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.js';
import * as workspace from '../../server/workspace/index.js';
import * as dispatch from '../../server/dispatch/index.js';

function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'drawing-e11-'));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(root, 'workspace');
  mkdirSync(ws);
  return { root, ws };
}

function fakeDeps(dir) {
  const calls = { providerStatus: 0, codexModels: 0, login: 0, claudeAccount: 0 };
  return {
    calls,
    deps: {
      limitsFile: join(dir, 'limits.json'),
      providerStatus: async () => {
        calls.providerStatus++;
        const p = { installed: true, connected: true, busy: false, url: null, error: null };
        return { claude: { ...p }, openai: { ...p }, gemini: { ...p } };
      },
      codexModels: async () => { calls.codexModels++; return []; },
      claudeAccount: async () => { calls.claudeAccount++; return 'fake@example.invalid'; },
      login: () => { calls.login++; },
      logout: async () => {},
      cancelLogin: () => {},
    },
  };
}

async function start(ws, deps) {
  const moduleList = [
    { name: 'workspace', setup: workspace.setup },
    { name: 'dispatch', setup: (ctx) => dispatch.setup(ctx, deps) },
  ];
  const pub = mkdtempSync(join(tmpdir(), 'drawing-e11-pub-'));
  writeFileSync(join(pub, 'index.html'), '<!doctype html>');
  const app = await createApp({ workspaceDir: ws }, { publicDir: pub, moduleList });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const stop = async () => { await app.close(); rmSync(pub, { recursive: true, force: true }); };
  return { app, base, stop };
}

const W = { 'content-type': 'application/json', 'x-drawing': '1' };

/** Reads SSE events from /api/events until `until(events)` is true. */
async function sse(base, until, timeout = 5000) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const events = [];
  let buf = '';
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const done = (async () => {
    try {
      while (!until(events)) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(chunk)?.[1];
          const data = /^data: (.*)$/m.exec(chunk)?.[1];
          if (ev) events.push({ event: ev, data: JSON.parse(data) });
        }
      }
    } catch { /* aborted */ }
    clearTimeout(timer);
    ctrl.abort();
    return events;
  })();
  return { done };
}

test('dispatch module: state, one SSE stream with a first snapshot, task events, no CLI started', async () => {
  const { root, ws } = scratchRepo();
  const { calls, deps } = fakeDeps(root);
  const { app, base, stop } = await start(ws, deps);
  try {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.project.branch, 'develop');
    assert.equal(state.providers.claude.connected, false);
    assert.equal(state.providers.claude.installed, null, 'not checked before the user connects a provider');
    assert.ok(state.models.some((m) => m.id === 'claude-fable-5-2'));

    // Hub gets the real port through the getter.
    assert.equal(app.ctx.modules.dispatch.hub.port, app.server.address().port);

    const stream = await sse(base, (evs) => evs.some((e) => e.event === 'tasks'));
    await new Promise((r) => setTimeout(r, 100));
    const created = await fetch(`${base}/api/tasks`, { method: 'POST', headers: W, body: JSON.stringify({ title: 'first step' }) });
    assert.equal(created.status, 200);
    const events = await stream.done;
    assert.equal(events[0].event, 'snapshot', 'the snapshot comes first');
    assert.equal(events[0].data.project.branch, 'develop');
    assert.ok(events.find((e) => e.event === 'tasks').data.some((t) => t.title === 'first step'));

    // Drawing's own routes still answer next to Dispatch's.
    assert.equal((await fetch(`${base}/api/workspace/projects`)).status, 200);
    assert.equal(calls.providerStatus, 0, 'no provider status check before connect');
    assert.equal(calls.codexModels, 0);
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatch writes need x-drawing: 1 or x-dispatch: 1', async () => {
  const { root, ws } = scratchRepo();
  const { deps } = fakeDeps(root);
  const { base, stop } = await start(ws, deps);
  try {
    const body = JSON.stringify({ title: 't' });
    const json = { 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/api/tasks`, { method: 'POST', headers: json, body })).status, 403);
    assert.equal((await fetch(`${base}/api/tasks`, { method: 'POST', headers: { ...json, 'x-drawing': '1' }, body })).status, 200);
    assert.equal((await fetch(`${base}/api/tasks`, { method: 'POST', headers: { ...json, 'x-dispatch': '1' }, body })).status, 200);
    assert.equal((await fetch(`${base}/api/tasks`, { method: 'POST', headers: { ...json, 'x-drawing': '0' }, body })).status, 403);
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit task handoff authorizes and validates the whole move before changing the card or teammates', async () => {
  const { root, ws } = scratchRepo();
  const { deps } = fakeDeps(root);
  const { app, base, stop } = await start(ws, deps);
  try {
    const { hub, store } = app.ctx.modules.dispatch;
    const add = (id, parent = null, folder = 'alpha') => (store.data.sessions[id] = {
      id, name: id, parent, folder, status: 'running', canSpawn: !parent, startedAt: Date.now(),
    });
    const old = add('old');
    const next = add('next');
    const a = add('a', old.id);
    const b = add('b', old.id);
    const rest = add('rest', old.id);
    const outsider = add('outsider', next.id);
    add('elsewhere', null, 'beta');
    const other = add('other');
    const otherChild = add('other-child', other.id);
    add('ended').status = 'done';
    const card = await hub.setTask(old.id, { title: 'handoff', stage: 'impl', eta_minutes: 5, commit: 'abc1234' });
    await hub.setTask(old.id, { id: card.id, stage: 'review', owner: a.name, note: 'checks passed' });
    const untouched = await hub.setTask(old.id, { title: 'unrelated' });
    const before = structuredClone(card);
    const body = { fromLead: old.id, toLead: next.id, sessionIds: [a.id, b.id] };
    const post = (path, payload, headers = W) => fetch(base + path, {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    const route = '/api/tasks/' + card.id + '/handoff';
    const events = [];
    for (const kind of ['session', 'tasks']) {
      hub.on(kind, () => events.push([card.lead, a.parent, b.parent]));
    }

    assert.equal((await post(route, body, { 'content-type': 'application/json' })).status, 403);
    assert.equal((await post('/api/tasks/missing/handoff', body)).status, 404);
    assert.equal((await post(route, { ...body, fromLead: 'stale' })).status, 409);
    assert.equal((await post(route, { ...body, toLead: outsider.id })).status, 400);
    assert.equal((await post(route, { ...body, toLead: 'ended' })).status, 400);
    assert.equal((await post(route, { ...body, toLead: 'elsewhere' })).status, 409);
    assert.equal((await post(route, { ...body, sessionIds: [a.id, 'missing'] })).status, 404);
    assert.equal((await post(route, { ...body, sessionIds: [a.id, otherChild.id] })).status, 409);
    assert.equal((await post(route, { ...body, sessionIds: [a.id, a.id] })).status, 400);
    store.data.settings.team = { ...store.data.settings.team, maxChildren: 2 };
    assert.equal((await post(route, body)).status, 400);
    assert.deepEqual(card, before);
    assert.deepEqual([a.parent, b.parent], [old.id, old.id]);
    assert.deepEqual(events, []);

    // Delegated callers can still update by ID when they omit the lead.
    const delegated = await post('/api/tasks', { id: card.id, note: 'verified' });
    assert.equal(delegated.status, 200);
    assert.equal((await delegated.json()).lead, old.id);
    const previous = structuredClone(card);
    events.length = 0;
    store.data.settings.team.maxChildren = 3;
    const moved = await post(route, body, { 'content-type': 'application/json', 'x-dispatch': '1' });
    assert.equal(moved.status, 200);
    assert.deepEqual(await moved.json(), { ...previous, lead: next.id });
    assert.deepEqual([rest.parent, untouched.lead], [old.id, old.id]);
    assert.ok(events.length);
    assert.ok(events.every(e => e.every(id => id === next.id)), 'every event sees the complete handoff');
    assert.equal((await post(route, body)).status, 409);
    await store.flush();
    const saved = JSON.parse(readFileSync(join(root, '.dispatch/state.json'), 'utf8'));
    assert.equal(saved.tasks[card.id].lead, next.id);
    assert.deepEqual(saved.tasks[card.id].stages, previous.stages);
    assert.deepEqual([saved.sessions[a.id].parent, saved.sessions[b.id].parent], [next.id, next.id]);

    await hub.remove(old.id);
    const retained = await post('/api/tasks/' + untouched.id + '/handoff', { fromLead: old.id, toLead: next.id });
    assert.equal(retained.status, 200);
    assert.equal((await retained.json()).id, untouched.id);
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a previous lead cannot roll back a handed-off card using its ID', async () => {
  const { root, ws } = scratchRepo();
  const { deps } = fakeDeps(root);
  const { app, base, stop } = await start(ws, deps);
  try {
    const { hub, store } = app.ctx.modules.dispatch;
    for (const id of ['old', 'next']) {
      store.data.sessions[id] = { id, folder: 'alpha', canSpawn: true, status: 'running' };
    }
    const card = await hub.setTask('old', { title: 'latest candidate', commit: 'bbbbbbb', stage: 'merge' });
    hub.handoffTask(card.id, { fromLead: 'old', toLead: 'next' });
    const before = structuredClone(card);
    const events = [];
    hub.on('tasks', () => events.push('tasks'));
    const body = JSON.stringify({ id: card.id, lead: 'old', commit: 'aaaaaaa', stage: 'review' });
    assert.equal((await fetch(base + '/api/tasks', { method: 'POST', headers: W, body })).status, 409);
    assert.deepEqual(card, before);
    assert.deepEqual(events, []);

    const racing = await hub.setTask('old', { title: 'another candidate', commit: 'bbbbbbb', stage: 'merge' });
    const initial = structuredClone(racing);
    const closing = assert.rejects(
      hub.setTask('old', { id: racing.id, title: 'changed title', commit: 'aaaaaaa', stage: 'done' }),
      { status: 409 },
    );
    hub.handoffTask(racing.id, { fromLead: 'old', toLead: 'next' });
    await closing;
    assert.deepEqual(racing, { ...initial, lead: 'next' });
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('an orphaned card without saved project evidence cannot be handed off', async () => {
  const { root, ws } = scratchRepo();
  const { deps } = fakeDeps(root);
  const { app, base, stop } = await start(ws, deps);
  try {
    const { hub, store } = app.ctx.modules.dispatch;
    store.data.sessions.next = { id: 'next', folder: 'beta', canSpawn: true, status: 'running' };
    const card = await hub.setTask('missing', { title: 'unknown project', stage: 'review' });
    const before = structuredClone(card);
    const body = JSON.stringify({ fromLead: 'missing', toLead: 'next' });
    const res = await fetch(base + '/api/tasks/' + card.id + '/handoff', { method: 'POST', headers: W, body });
    assert.equal(res.status, 409);
    assert.deepEqual(card, before);
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('removed routes: no cross-project probing', async () => {
  const { root, ws } = scratchRepo();
  const { deps } = fakeDeps(root);
  const { base, stop } = await start(ws, deps);
  try {
    const { projects } = await (await fetch(`${base}/api/projects`)).json();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].current, true);
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failing dispatch call answers { error } and leaves drawing routes working', async () => {
  const { root, ws } = scratchRepo();
  const { deps } = fakeDeps(root);
  const { app, base, stop } = await start(ws, deps);
  try {
    const miss = await fetch(`${base}/api/sessions/nope/diff`);
    assert.equal(miss.status, 404);
    assert.equal((await miss.json()).error, '세션이 없어요');
    assert.equal((await fetch(`${base}/api/sessions/nope/live`)).status, 404);
    const empty = await fetch(`${base}/api/sessions/nope/message`, { method: 'POST', headers: W, body: JSON.stringify({ text: ' ' }) });
    assert.equal(empty.status, 400);
    // A message to a session that is gone is a 404, so the chat dock can tell it from a passing failure (#937).
    assert.equal((await fetch(`${base}/api/sessions/nope/message`, { method: 'POST', headers: W, body: JSON.stringify({ text: 'hi' }) })).status, 404);
    const bad = await fetch(`${base}/api/tasks`, { method: 'POST', headers: W, body: '{' });
    assert.equal(bad.status, 400);
    // A Hub method that throws something unexpected is still a JSON error, not a dead server.
    app.ctx.modules.dispatch.hub.timeline = () => { throw new Error('boom'); };
    assert.equal((await fetch(`${base}/api/timeline`)).status, 400);

    assert.equal((await fetch(`${base}/api/workspace/projects`)).status, 200);
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('connecting a provider checks the CLI only then; it stays off until the user connects', async () => {
  const { root, ws } = scratchRepo();
  const { calls, deps } = fakeDeps(root);
  const { base, stop } = await start(ws, deps);
  try {
    const res = await (await fetch(`${base}/api/providers/claude/login`, { method: 'POST', headers: W, body: '{}' })).json();
    assert.deepEqual(res, { ok: true, connected: true });
    assert.ok(calls.providerStatus >= 1);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.providers.claude.connected, true);
    assert.equal(state.providers.openai.connected, false, 'logged in on the machine is not connected here');
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('state goes to <project>/.dispatch/state.json only: nothing in the workspace, no transcripts', async () => {
  const { root, ws } = scratchRepo();
  const { deps } = fakeDeps(root);
  const { base, stop } = await start(ws, deps);
  assert.equal((await fetch(`${base}/api/settings`, { method: 'POST', headers: W, body: JSON.stringify({ team: { maxChildren: 3 } }) })).status, 200);
  await stop();
  try {
    assert.deepEqual(readdirSync(join(root, '.dispatch')).sort(), ['state.json']);
    assert.equal(existsSync(join(ws, '.dispatch')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('outside a git project the dispatch module is off and drawing still works', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e11-nogit-'));
  const { deps } = fakeDeps(dir);
  const { app, base, stop } = await start(dir, deps);
  try {
    assert.equal(app.ctx.modules.dispatch.hub, undefined);
    assert.equal((await (await fetch(`${base}/api/dispatch`)).json()).reason, 'not-git');
    assert.equal((await fetch(`${base}/api/state`)).status, 404);
    assert.equal((await fetch(`${base}/api/workspace/projects`)).status, 200);
    assert.equal(existsSync(join(dir, '.dispatch')), false);
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the only path both modules answer is none: Dispatch paths do not shadow drawing paths', async () => {
  const { root, ws } = scratchRepo();
  const { deps } = fakeDeps(root);
  const { app, stop } = await start(ws, deps);
  try {
    const drawing = app.ctx.modules.workspace.routes;
    const disp = app.ctx.modules.dispatch.routes;
    for (const d of drawing) {
      for (const x of disp) {
        const hit = x.method === d.method && (x.path instanceof RegExp ? x.path.test(d.path) : x.path === d.path);
        assert.equal(hit, false, `${d.method} ${d.path}`);
      }
    }
    assert.ok(!disp.some((x) => x.path instanceof RegExp && x.path.test('/api/events')), '/api/events is the shared stream');
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('pr-tracking route: default on, toggles and persists, header and body checks, broken settings 409', async () => {
  const { root, ws } = scratchRepo();
  const { deps } = fakeDeps(root);
  const { base, stop } = await start(ws, deps);
  try {
    const url = `${base}/api/workspace/pr-tracking`;
    assert.deepEqual(await (await fetch(url)).json(), { on: true });
    const off = await fetch(url, { method: 'POST', headers: W, body: JSON.stringify({ on: false }) });
    assert.equal(off.status, 200);
    assert.deepEqual(await off.json(), { on: false });
    assert.deepEqual(await (await fetch(url)).json(), { on: false });
    assert.equal((await fetch(url, { method: 'POST', headers: W, body: JSON.stringify({ on: true }) })).status, 200);
    assert.deepEqual(await (await fetch(url)).json(), { on: true });
    const noHeader = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: false }) });
    assert.equal(noHeader.status, 403);
    assert.deepEqual(await (await fetch(url)).json(), { on: true });
    for (const bad of [{}, { on: 'no' }, { on: 1 }, null]) {
      assert.equal((await fetch(url, { method: 'POST', headers: W, body: JSON.stringify(bad) })).status, 400);
    }
    writeFileSync(join(ws, '.drawing', 'settings.json'), '{ not json');
    const broken = await fetch(url, { method: 'POST', headers: W, body: JSON.stringify({ on: false }) });
    assert.equal(broken.status, 409);
    assert.match((await broken.json()).error, /읽을 수 없어요/);
    assert.equal(readFileSync(join(ws, '.drawing', 'settings.json'), 'utf8'), '{ not json'); // 409 leaves it alone
    const brokenGet = await fetch(url);
    assert.equal(brokenGet.status, 409);
    assert.match((await brokenGet.json()).error, /읽을 수 없어요/);
    // the plugin header x-dispatch: 1 is accepted too
    writeFileSync(join(ws, '.drawing', 'settings.json'), '{}');
    const viaPlugin = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dispatch': '1' }, body: JSON.stringify({ on: false }) });
    assert.equal(viaPlugin.status, 200);
    // parallel toggles never collide on a temp file and leave no temp files behind
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => fetch(url, { method: 'POST', headers: W, body: JSON.stringify({ on: i % 2 === 0 }) })));
    assert.deepEqual(rs.map((r) => r.status), Array(8).fill(200));
    assert.deepEqual(readdirSync(join(ws, '.drawing')).filter((f) => f.endsWith('.tmp')), []);
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('account email: asked only after the CLI was found logged in, never in /api/state or the state file (#1023)', async () => {
  const { root, ws } = scratchRepo();
  const { calls, deps } = fakeDeps(root);
  const { base, stop } = await start(ws, deps);
  try {
    const before = await (await fetch(`${base}/api/providers/accounts`)).json();
    assert.deepEqual(before, { accounts: { claude: null, openai: null, gemini: null } });
    assert.equal(calls.claudeAccount, 0, 'no CLI before the user connects a provider');
    await fetch(`${base}/api/providers/claude/login`, { method: 'POST', headers: W, body: '{}' });
    const res = await fetch(`${base}/api/providers/accounts`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { accounts: { claude: 'fake@example.invalid', openai: null, gemini: null } });
    const state = await (await fetch(`${base}/api/state`)).text();
    assert.ok(!state.includes('fake@example.invalid'));
    // grep exits 1 when nothing on disk under the project holds the address.
    const found = spawnSync('grep', ['-rl', 'fake@example.invalid', root], { encoding: 'utf8' });
    assert.equal(found.status, 1, found.stdout);
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});
