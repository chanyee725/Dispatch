import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBody, disconnected, fitPerm, initialRows, notices, permsFor, providerGroups, rowFor, summary, total } from '../../web/src/dispatch/lib/create.ts';

const roles = [
  { id: 'lead', name: '관리자', model: 'claude-sonnet-5-5', perm: 'auto', prompt: 'lead' },
  { id: 'impl', name: '구현자', model: 'claude-opus-5-5', perm: 'acceptEdits', prompt: 'impl' },
  { id: 'review', name: '리뷰어', model: 'claude-sonnet-5-5', perm: 'plan', prompt: 'review' },
  { id: 'test', name: '테스터', model: 'claude-sonnet-5-5', perm: 'auto', prompt: 'test' },
];
const m = (id: string, provider: string, label = id) => ({ id, provider, label, efforts: [], defaultEffort: null, contextWindow: 1 });
const models = [m('gpt-5', 'openai', 'GPT-5'), m('claude-opus-5-5', 'claude', 'Opus 5.5'), m('claude-sonnet-5-5', 'claude', 'Sonnet 5.5'), m('gemini-3', 'gemini')];
const prov = (connected: boolean) => ({ connected }) as never;
const PERMS = ['manual', 'acceptEdits', 'auto', 'plan'];
const noLimits = { five: null, seven: null, fiveReset: null, sevenReset: null, updatedAt: null };

test('initial rows are lead, impl and review with each role default model', () => {
  const rows = initialRows(roles);
  assert.deepEqual(rows.map(r => [r.role, r.model, r.perm, r.effort, r.n]), [
    ['lead', 'claude-sonnet-5-5', 'auto', 'default', 1],
    ['impl', 'claude-opus-5-5', 'acceptEdits', 'default', 1],
    ['review', 'claude-sonnet-5-5', 'plan', 'default', 1],
  ]);
  assert.equal(new Set(rows.map(r => r.key)).size, 3);
});

test('modes per provider follow the server: Codex plan/auto, Gemini acceptEdits/auto/plan, Claude all', () => {
  assert.deepEqual(permsFor('claude', PERMS), PERMS);
  assert.deepEqual(permsFor('openai', PERMS), ['auto', 'plan']);
  assert.deepEqual(permsFor('gemini', PERMS), ['acceptEdits', 'auto', 'plan']);
  assert.equal(fitPerm('manual', 'openai', PERMS), 'auto');
  assert.equal(fitPerm('plan', 'openai', PERMS), 'plan');
  assert.equal(fitPerm('manual', 'gemini', PERMS), 'acceptEdits');
  assert.equal(fitPerm('manual', 'claude', PERMS), 'manual');
});

test('provider groups: Claude first, only providers with models', () => {
  assert.deepEqual(providerGroups(models), ['claude', 'openai', 'gemini']);
  assert.deepEqual(providerGroups([m('x', 'claude')]), ['claude']);
});

test('disconnected and notices', () => {
  const rows = [{ ...rowFor(roles[0]), model: 'gpt-5' }];
  const providers = { claude: prov(true), openai: prov(false) };
  assert.equal(disconnected(rows, models, providers), true);
  assert.equal(disconnected(initialRows(roles), models, providers), false);
  const n = notices(rows, { models, providers, limits: noLimits, worktree: true });
  assert.equal(n.length, 1);
  assert.match(n[0], /연결/);
  const hot = { ...noLimits, five: 0.9, fiveReset: Date.now() + 3_600_000 };
  assert.equal(notices(rows, { models, providers: { openai: prov(true) }, limits: hot, worktree: true }).length, 0, 'Claude limits do not warn for Codex rows');
  assert.match(notices(initialRows(roles), { models, providers, limits: hot, worktree: false }).join('\n'), /Claude 5시간 한도를 90%[\s\S]*worktree/);
});

test('summary, total and the POST body', () => {
  const rows = initialRows(roles);
  rows[1].n = 2;
  rows[1].effort = 'high';
  assert.equal(total(rows), 4);
  assert.equal(summary(rows, models), 'Sonnet 5.5 2개, Opus 5.5 2개');
  const body = createBody(rows, '  hi  ', true, '/ws/a');
  assert.equal(body.commonPrompt, 'hi');
  assert.equal(body.folder, '/ws/a');
  assert.deepEqual(body.items[1], { role: 'impl', model: 'claude-opus-5-5', effort: 'high', perm: 'acceptEdits', prompt: 'impl', n: 2 });
  assert.equal(body.items[0].effort, null);
  assert.equal('folder' in createBody(rows, 'x', false, null), false);
  assert.equal('folder' in createBody(rows, 'x', false, undefined), false);
});
