// #747: account labels per provider connection (user defaults) and the per-issue session ledger. Runs against a
// scratch git repo in a temp dir and a temp HOME-less defaults file with the fake CLIs only; no real CLI starts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.js';
import * as workspace from '../../server/workspace/index.js';
import * as dispatch from '../../server/dispatch/index.js';
import * as userDefaults from '../../server/user-defaults.js';
import { issueAccounts, issueOfBranch, Ledger } from '../../server/dispatch/ledger.js';
import { accountLabelOf, accountsSummary, checkAccountLabel, cleanAccountLabels } from '../../shared/dispatch/accounts.ts';
import { fakeCliBin, fakeSpawner, until } from '../fixtures/fake-cli/index.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('checkAccountLabel: trims, caps at 40, refuses emails, ids and keys', () => {
  assert.deepEqual(checkAccountLabel('  Claude ·  Max '), { ok: true, value: 'Claude · Max' });
  assert.deepEqual(checkAccountLabel('Codex · 팀 계정'), { ok: true, value: 'Codex · 팀 계정' });
  assert.deepEqual(checkAccountLabel(''), { ok: true, value: null });
  assert.deepEqual(checkAccountLabel(null), { ok: true, value: null });
  for (const bad of ['a@b.co', 'me@work', 'x'.repeat(41), 'acct 12345678', '3f2a9c1e8b7d6a5f4e3d', '123e4567-e89b-12d3-a456-426614174000', 'sk-abcdef123456', 'a\u0007b', 42, '０１２３４５６７８９', '010-1234-5678', '1234 5678 9012', 'me﹫corp', 'me＠corp', '12.34.56', 'Codex · ０１０-１２３４']) {
    assert.equal(checkAccountLabel(bad).ok, false, String(bad));
  }
  assert.equal(checkAccountLabel('가'.repeat(40)).ok, true);
  for (const ok of ['Claude · Max', 'Codex · 팀 계정 2', 'Gemini · 2026']) assert.equal(checkAccountLabel(ok).ok, true, ok);
  assert.deepEqual(cleanAccountLabels({ claude: 'Max', openai: 'x@y.z', gemini: 3, other: 'A' }), { claude: 'Max' });
  assert.equal(accountLabelOf({ claude: 'Claude · Max' }, 'claude'), 'Claude · Max');
  assert.equal(accountLabelOf({}, 'openai'), 'Codex');
  assert.equal(accountLabelOf(undefined, 'gemini'), 'Gemini');
});

test('accountsSummary: one line, leads first, same role+model+account grouped', () => {
  const line = accountsSummary([
    { role: 'impl', provider: 'openai', modelLabel: 'GPT-5', accountLabel: 'Codex · 팀 계정' },
    { role: 'lead', provider: 'claude', modelLabel: 'Sonnet 5.5', accountLabel: 'Claude · Max' },
    { role: 'impl', provider: 'openai', modelLabel: 'GPT-5', accountLabel: 'Codex · 팀 계정' },
    { role: 'review', provider: 'gemini', modelLabel: 'Gemini 3.8 Flash (High)', accountLabel: null },
  ]);
  assert.equal(line, 'roles: lead Claude Sonnet 5.5 (Claude · Max), impl ×2 Codex GPT-5 (Codex · 팀 계정), review Gemini 3.8 Flash (High) (Gemini)');
  assert.equal(accountsSummary([]), 'roles: -');
});

test('issueOfBranch: feat/747-x and fix/747 name 747; dispatch/ and plain branches name none', () => {
  assert.equal(issueOfBranch('feat/747-accounts-backend'), 747);
  assert.equal(issueOfBranch('fix/747'), 747);
  assert.equal(issueOfBranch('dispatch/impl-1003'), null);
  assert.equal(issueOfBranch('develop'), null);
  assert.equal(issueOfBranch(null), null);
});

test('issueOfBranch: only <type>/<n>-…; dates, versions and bare numbers name none (#756)', () => {
  assert.equal(issueOfBranch('fix/issue-12-x'), 12);
  assert.equal(issueOfBranch('chore/gh-9'), 9);
  assert.equal(issueOfBranch('Docs/31-readme'), 31);
  assert.equal(issueOfBranch('release/2026-11-19'), null);
  assert.equal(issueOfBranch('feat/2026-11-19-cleanup'), null);
  assert.equal(issueOfBranch('backup/12-x'), null);
  assert.equal(issueOfBranch('feat/v2-ui'), null);
  assert.equal(issueOfBranch('feat/x/747-y'), null);
  assert.equal(issueOfBranch('747-x'), null);
  assert.equal(issueOfBranch('feat/747x'), null);
  assert.equal(issueOfBranch('feat/0-x'), null);
});

test('Ledger: snapshot label kept, issues from item and branch, leads included, PR looked up per branch', async () => {
  const store = { data: {} };
  const l = new Ledger(store);
  l.sync({ id: 'L', role: 'lead', provider: 'claude', model: 'claude-sonnet-5-5', modelLabel: 'Sonnet 5.5', accountLabel: 'Claude · Max', startedAt: 1, status: 'idle', branch: 'dispatch/lead-1', usage: { input: 10, output: 5 }, cost: 0.5 });
  l.sync({ id: 'I', parent: 'L', role: 'impl', provider: 'openai', model: 'gpt-5', modelLabel: 'GPT-5', effort: 'low', accountLabel: 'Codex · 팀', startedAt: 2, status: 'running', branch: 'dispatch/impl-2', issue: 747, usage: { input: 1 } });
  l.sync({ id: 'X', role: 'impl', provider: 'claude', model: 'claude-opus-5-5', startedAt: 3, status: 'idle', branch: 'dispatch/impl-3' });
  // A later rename of the label does not rewrite the snapshot; a branch noted after a turn adds its issue.
  l.sync({ id: 'I', parent: 'L', role: 'impl', provider: 'openai', model: 'gpt-5', accountLabel: 'renamed', startedAt: 2, status: 'done', updatedAt: 9, usage: { input: 3, output: 4 }, cost: null });
  assert.equal(l.noteBranch('I', 'feat/747-accounts'), true);
  assert.equal(l.noteBranch('X', 'fix/800-other'), true);
  const asked = [];
  const r = await issueAccounts(l, 747, { prOf: async (b) => (asked.push(b), { ok: true, pr: { number: 901, state: 'open' } }) });
  assert.deepEqual(asked, ['feat/747-accounts']);
  assert.deepEqual(r.sessions.map((s) => [s.sid, s.role, s.accountLabel, s.pr]), [['L', 'lead', 'Claude · Max', null], ['I', 'impl', 'Codex · 팀', 901]]);
  const impl = r.sessions[1];
  assert.equal(impl.endedAt, 9);
  assert.equal(impl.effort, 'low');
  assert.deepEqual(impl.tokens, { input: 3, output: 4, cacheRead: 0, cacheWrite: 0 });
  assert.equal(r.summary, 'roles: lead Claude Sonnet 5.5 (Claude · Max), impl Codex GPT-5 (Codex · 팀)');
  assert.deepEqual(Object.keys(impl).sort(), ['accountLabel', 'branch', 'cost', 'effort', 'endedAt', 'model', 'modelLabel', 'pr', 'provider', 'role', 'shared', 'sid', 'startedAt', 'tokens'].sort());
  assert.deepEqual(r.prs, [901]);
  // The lead is in only for its teammate: its whole-session numbers are marked shared (#756).
  assert.deepEqual(r.sessions.map((s) => s.shared), [true, false]);
  // With the cached PR list (#756): a PR whose head is the session's branch counts even when only its body names the
  // issue (Refs #747); pr-status is not asked.
  const viaList = await issueAccounts(l, 747, {
    prsOf: async (n) => (assert.equal(n, 747), { ok: true, prs: [{ number: 960, branch: 'feat/747-accounts' }, { number: 950, branch: 'dispatch/lead-1' }] }),
    prOf: async () => assert.fail('prOf asked although the list answered'),
  });
  assert.deepEqual(viaList.sessions.map((s) => s.pr), [950, 960]);
  assert.deepEqual(viaList.prs, [960, 950]);
  // The list unavailable (PR tracking off, gh missing): pr-status per branch again.
  const fallback = await issueAccounts(l, 747, { prsOf: async () => ({ ok: false, reason: 'disabled' }), prOf: async () => ({ ok: true, pr: { number: 7 } }) });
  assert.deepEqual(fallback.sessions.map((s) => s.pr), [null, 7]);
  // A session that worked on two issues is shared under both.
  l.noteBranch('X', 'feat/747-also');
  assert.deepEqual((await issueAccounts(l, 800)).sessions.map((s) => [s.sid, s.shared]), [['X', true]]);
  // Unknown issue: empty. Ledger keeps no free text: an email-shaped label never lands.
  assert.deepEqual((await issueAccounts(l, 1)).sessions, []);
  l.sync({ id: 'E', role: 'impl', accountLabel: 'x@y.z', startedAt: 4, status: 'idle' });
  assert.equal(store.data.ledger.E.accountLabel, null);
  l.trim(2);
  assert.deepEqual(Object.keys(store.data.ledger).sort(), ['E', 'X']);
});

const posted = [];

async function start() {
  const root = mkdtempSync(join(tmpdir(), 'drawing-747-'));
  dirs.push(root);
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(root, 'ws');
  mkdirSync(ws);
  const defaultsPath = join(root, 'home', '.atelier', 'drawing.json');
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const p = { installed: true, connected: true, busy: false, url: null, error: null };
  const deps = {
    limitsFile: join(root, 'limits.json'),
    providerStatus: async () => ({ claude: { ...p }, openai: { ...p, connected: false }, gemini: { ...p, connected: false } }),
    codexModels: async () => [], login: () => {}, logout: async () => {}, cancelLogin: () => {},
    spawnCli: fakeSpawner(bin),
    postAccounts: async (x) => (posted.push(x), { ok: true, pr: x.pr, comment: posted.length > 1 ? 'updated' : 'created' }),
    prStatus: async (b) => (b === 'feat/747-x' ? { ok: true, pr: { number: 12, state: 'open', ci: 'none' } } : { ok: false, reason: 'none' }),
  };
  const moduleList = [
    { name: 'userDefaults', setup: (ctx) => userDefaults.setup(ctx, { file: defaultsPath }) },
    { name: 'workspace', setup: workspace.setup },
    { name: 'dispatch', setup: (ctx) => dispatch.setup(ctx, deps) },
  ];
  const pub = mkdtempSync(join(tmpdir(), 'drawing-747-pub-'));
  dirs.push(pub);
  writeFileSync(join(pub, 'index.html'), '<!doctype html>');
  const app = await createApp({ workspaceDir: ws }, { publicDir: pub, moduleList });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const W = { 'content-type': 'application/json', 'x-drawing': '1' };
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: method === 'GET' ? {} : W, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await call('POST', '/api/providers/claude/login')).body.connected, true);
  return { call, d: app.ctx.modules.dispatch, root, git, defaultsPath, stop: () => app.close() };
}

test('API: accountLabels in /api/user-defaults; a session snapshots its label; GET /api/issues/:n/accounts', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d } = t;
    let r = await call('POST', '/api/user-defaults', { accountLabels: { claude: ' Claude · Max ', openai: 'Codex · 팀 계정' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.values.accountLabels, { claude: 'Claude · Max', openai: 'Codex · 팀 계정' });
    // Partial patch: null clears one label, others stay.
    r = await call('POST', '/api/user-defaults', { accountLabels: { openai: null } });
    assert.deepEqual(r.body.values.accountLabels, { claude: 'Claude · Max' });
    for (const bad of [{ claude: 'me@corp.example' }, { claude: 'x'.repeat(41) }, { codex: 'A' }, 'Max']) {
      r = await call('POST', '/api/user-defaults', { accountLabels: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.deepEqual(JSON.parse(readFileSync(t.defaultsPath, 'utf8')).accountLabels, { claude: 'Claude · Max' });
    assert.deepEqual((await call('GET', '/api/user-defaults')).body.values.accountLabels, { claude: 'Claude · Max' });

    const lead = (await call('POST', '/api/sessions', { worktree: false, items: [{ role: 'lead', task: 'x' }] })).body.sessions[0];
    assert.equal(lead.accountLabel, 'Claude · Max');
    await until(() => ['idle', 'done'].includes(d.hub.get(lead.id).status), 10_000);
    const kid = (await call('POST', '/api/sessions', { worktree: false, parent: lead.id, items: [{ role: 'impl', task: 'y', issue: 747, model: 'claude-haiku-5-5' }] })).body.sessions[0];
    assert.equal(kid.issue, 747);
    await until(() => ['idle', 'done'].includes(d.hub.get(kid.id).status), 10_000);
    // The label changes later: the sessions keep the label they started with.
    await call('POST', '/api/user-defaults', { accountLabels: { claude: 'Claude · Team' } });
    // The implementer's folder moves to a branch naming the issue; the ledger notes it after the next turn.
    t.git('checkout', '-q', '-b', 'feat/747-x');
    d.hub.touch(d.hub.get(kid.id), { status: 'running' });
    d.hub.touch(d.hub.get(kid.id), { status: 'idle' });
    await until(() => d.ledger.entries[kid.id].branch === 'feat/747-x', 5_000);
    r = await call('GET', '/api/issues/747/accounts');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.issue, 747);
    assert.deepEqual(r.body.sessions.map((s) => [s.role, s.accountLabel]), [['lead', 'Claude · Max'], ['impl', 'Claude · Max']]);
    assert.equal(r.body.sessions[1].pr, 12);
    assert.equal(r.body.summary, 'roles: lead Claude Sonnet 5.5 (Claude · Max), impl Claude Haiku 5.5 (Claude · Max)');
    assert.equal((await call('GET', '/api/issues/747/accounts?pr=0')).body.sessions[1].pr, null);
    // POST …/comment posts the summary line on the issue's PR (#756): found PR first, an explicit pr wins.
    r = await call('POST', '/api/issues/747/accounts/comment', {});
    assert.deepEqual(r.body, { ok: true, pr: 12, comment: 'created', summary: r.body.summary });
    assert.deepEqual(posted.at(-1), { pr: 12, issue: 747, summary: r.body.summary });
    r = await call('POST', '/api/issues/747/accounts/comment', { pr: 30 });
    assert.equal(r.body.comment, 'updated');
    assert.equal(posted.at(-1).pr, 30);
    assert.equal((await call('POST', '/api/issues/747/accounts/comment', { pr: 'x' })).status, 400);
    assert.deepEqual((await call('POST', '/api/issues/1/accounts/comment', {})).body, { ok: false, reason: 'no-sessions', summary: 'roles: -' });
    assert.equal(posted.length, 2);
    // Removal keeps the record, with an end time.
    assert.equal((await call('POST', `/api/sessions/${kid.id}/remove`)).status, 200);
    r = await call('GET', '/api/issues/747/accounts?pr=0');
    assert.equal(r.body.sessions.length, 2);
    assert.ok(r.body.sessions[1].endedAt > 0);
    // On disk: metadata only.
    await d.store.flush();
    const disk = readFileSync(join(d.root, '.atelier', 'state.json'), 'utf8');
    const ledger = JSON.parse(disk).ledger;
    assert.deepEqual(ledger[kid.id].issues, [747]);
    assert.doesNotMatch(JSON.stringify(ledger), /@|"task"|"last"|"prompt"/);
  } finally { await t.stop(); }
});
