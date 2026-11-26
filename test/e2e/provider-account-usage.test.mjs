import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { which } from '../../server/dispatch/cli.js';
import { fakeCliBin, until } from '../fixtures/fake-cli/index.mjs';

const enabled = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;

test('account usage shows verified windows, missing data, stale values and keyboard retry', {
  skip: !enabled && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run',
  timeout: 60_000,
}, async t => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-account-usage-'));
  const repo = join(dir, 'repo');
  const home = join(dir, 'home');
  mkdirSync(repo);
  const now = Date.now();
  const limitsDir = join(home, '.dispatch');
  mkdirSync(limitsDir, { recursive: true });
  writeFileSync(join(limitsDir, 'limits.json'), JSON.stringify({
    claude: { five: 0.65, fiveReset: null, updatedAt: now - 86_400_000 },
  }));
  const resetOnlyGate = join(dir, 'reset-only');
  const freshUsageGate = join(dir, 'fresh-usage');
  const fiveReset = Math.floor(now / 1000) + 3600;
  const fake = fakeCliBin({ scenarios: {
    claude: [
      { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { seven_day: { utilization: 0.3 } } } },
      { $waitFor: resetOnlyGate },
      { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { resetsAt: fiveReset } } } },
      { $waitFor: freshUsageGate },
      { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.2 } } } },
      { type: 'result', subtype: 'success' },
    ],
    codex: [{ rateLimits: { primary: {
      usedPercent: 37, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600,
    } } }],
    agy: [{ status: 'SUCCESS', command: { name: 'usage', data: { groups: [{
      name: 'Gemini Models', buckets: [{ window: 'weekly', remaining_fraction: 0.75,
        reset_time: new Date(Date.now() + 3600_000).toISOString() }],
    }] } } }],
  } });
  let server;
  let exited;
  let browser;
  t.after(async () => {
    await browser?.close();
    server?.kill();
    await exited;
    fake.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
  git('init', '-qb', 'develop');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'scratch commit', '--allow-empty');
  server = spawn(process.execPath, ['server/index.js', repo], {
    env: { ...fake.env, HOME: home, PATH: `${fake.dir}:${dirname(which('git'))}`,
      DISPATCH_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', NODE_TEST_CONTEXT: 'child' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  exited = once(server, 'exit');
  let ready = false;
  server.stdout.on('data', data => { ready ||= data.toString().includes(`workspace ${repo}`); });
  await until(() => ready, 10_000);

  const call = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, {
      method, headers: { 'x-drawing': '1', 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    assert.ok(response.ok, `${method} ${path} returned ${response.status}`);
    return response.json();
  };
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  const panel = id => page.locator(`[data-account-usage="${id}"]`);
  const codex = panel('openai');
  const gemini = panel('gemini');
  const claude = panel('claude');
  await page.goto(`${base}/#board=usage`);
  await codex.getByText('연결 안 됨', { exact: true }).waitFor();
  await codex.getByText('연결하면 사용량이 보여요.').waitFor();

  for (const id of ['claude', 'openai', 'gemini']) {
    assert.equal((await call(`/api/providers/${id}/login`, 'POST')).connected, true);
  }
  const stale = claude.getByRole('status').getByText(/144\d분 전 숫자예요/);
  await stale.waitFor();
  await call('/api/sessions', 'POST', { items: [{ role: 'impl', prompt: 'Report usage.' }], worktree: false });
  await claude.getByRole('progressbar', { name: 'Claude 주간 30%' }).waitFor();
  await claude.getByRole('progressbar', { name: 'Claude 5시간 65%' }).waitFor();
  await stale.waitFor({ timeout: 5_000 });
  writeFileSync(resetOnlyGate, '');
  const resetTime = new Date(fiveReset * 1000).toISOString();
  await claude.locator(`[data-limit="5시간"] time[datetime="${resetTime}"]`).waitFor({ timeout: 5_000 });
  await claude.getByRole('progressbar', { name: 'Claude 5시간 65%' }).waitFor();
  await stale.waitFor({ timeout: 5_000 });

  writeFileSync(freshUsageGate, '');
  await claude.getByRole('progressbar', { name: 'Claude 5시간 20%' }).waitFor({ timeout: 5_000 });
  assert.equal(await claude.getByRole('status').getByText(/분 전 숫자예요/).count(), 0);
  await codex.getByText('연결됨', { exact: true }).waitFor();
  await codex.getByRole('progressbar', { name: 'OpenAI Codex 5시간 37%' }).waitFor();
  await codex.getByText('일부 기간만 알려줘요.').waitFor();
  await codex.getByText('주간 · 정보 없음').waitFor();
  assert.equal(await codex.getByRole('progressbar').count(), 1);
  assert.ok(await codex.locator('time[datetime]').isVisible());
  await gemini.getByText('연결됨', { exact: true }).waitFor();
  await gemini.getByRole('progressbar', { name: 'Gemini 주간 25%' }).waitFor();
  if (process.env.DRAW_ACCOUNT_USAGE_SHOT) await page.screenshot({ path: process.env.DRAW_ACCOUNT_USAGE_SHOT });

  // Replace only the account responses to exercise the states the fake CLI cannot change mid-run.
  const expired = { connection: 'connected', status: 'partial', updatedAt: now - 120_000,
    windows: [{ label: '5시간', used: 0.37, reset: now - 60_000 }, { label: '주간', used: 0.45, reset: null }] };
  const noUsage = { connection: 'unverified', status: 'unavailable', windows: [] };
  const claudeUsage = { connection: 'connected', status: 'partial', updatedAt: now - 60_000,
    windows: [{ label: '5시간', used: 0.65, reset: null }] };
  await page.route('**/api/usage/limits/claude', route => route.fulfill({ json: claudeUsage }));
  let geminiState = noUsage;
  let codexState = expired;
  await page.route('**/api/usage/limits/openai', route => codexState
    ? route.fulfill({ json: codexState }) : route.fulfill({ status: 503, json: { error: 'fixture detail' } }));
  await page.route('**/api/usage/limits/gemini', route => route.fulfill({ json: geminiState }));
  await page.reload();
  await claude.getByRole('progressbar', { name: 'Claude 5시간 65%' }).waitFor();
  assert.equal(await claude.getByRole('status').getByText(/분 전 숫자예요/).count(), 0);
  await codex.getByRole('status').getByText(/분 전 숫자예요/).waitFor();
  await codex.getByText('초기화 시각을 몰라요.').waitFor();
  await codex.getByRole('progressbar', { name: 'OpenAI Codex 5시간 37%' }).waitFor();
  await gemini.getByText('이 모델은 사용량을 알려주지 않아요.').waitFor();
  assert.equal(await gemini.getByRole('progressbar').count(), 0);

  geminiState = { ...noUsage, reached: true, reset: now + 3600_000 };
  codexState = null;
  await page.reload();
  await gemini.getByText(/한도에 닿았어요.*사용률은 알려주지 않아요/).waitFor();
  await codex.getByRole('status').getByText('사용량을 불러오지 못했어요.').waitFor();
  await codex.getByText('연결됨', { exact: true }).waitFor();
  assert.equal(await codex.getByText('fixture detail').count(), 0);
  assert.equal(await codex.getByRole('progressbar').count(), 0);
  await page.emulateMedia({ forcedColors: 'active' });
  const retry = codex.getByRole('button', { name: '다시 불러오기' });
  await retry.focus();
  codexState = expired;
  await retry.press('Enter');
  await codex.getByRole('progressbar', { name: 'OpenAI Codex 5시간 37%' }).waitFor();
  assert.equal(await retry.evaluate(el => el === document.activeElement), true);
  assert.deepEqual(errors, []);
});
