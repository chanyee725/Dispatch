// Headless check of the 작업 보드 (E19b, #372): tasks posted to a scratch workspace show in stage columns with owner,
// ETA and time in the stage; a stage change and a new task arrive live without reloading.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH of fake agent CLIs; it refuses to go on unless its log names its port and workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeCliBin } from '../fixtures/fake-cli/index.mjs';
import { which } from '../../server/dispatch/cli.js';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const SHOTS = process.env.DRAW_SHOTS;
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

test('작업 보드 shows tasks by stage and follows live changes', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-board-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-board-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);

  const fake = fakeCliBin({ scenario: [{ type: 'system', subtype: 'init', session_id: 'fake-board' }, { type: 'result', subtype: 'success' }] });
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', ...fake.env, PATH, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  let page;
  let step = 'server start';
  const at = (s) => { step = s; };
  t.after(async () => {
    await browser?.close();
    server.kill();
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  try {
    for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
    const call = async (m, u, b) => {
      const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
      const body = await res.json();
      assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
      return body;
    };

    at('seed tasks');
    await call('POST', '/api/tasks', { title: '로그인 화면 만들기', stage: 'impl', owner: 'Ivy', eta_minutes: 30 });
    await call('POST', '/api/tasks', { title: '결제 검토', stage: 'review', owner: 'Rae' });
    await call('POST', '/api/tasks', { title: '배포 막힘', stage: 'blocked', note: '키가 없어요' });

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
    const errors = [];
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    await page.goto(`${BASE}/dispatch`);

    at('open the board');
    await page.getByRole('button', { name: /작업 보드/ }).click();
    const board = page.locator('[data-board]');
    await board.waitFor();
    const card = (title) => board.locator(`[data-task="${title}"]`);
    await board.locator('[data-stage="impl"]').locator(`[data-task="로그인 화면 만들기"]`).waitFor();
    await board.locator('[data-stage="review"]').locator(`[data-task="결제 검토"]`).waitFor();
    await board.locator('[data-stage="blocked"]').locator(`[data-task="배포 막힘"]`).waitFor();
    // All seven stage columns are there, empty ones included.
    assert.equal(await board.locator('[data-stage]').count(), 7);

    at('owner, eta and time in stage');
    const impl = card('로그인 화면 만들기');
    await impl.getByText('Ivy', { exact: true }).waitFor();
    assert.match(await impl.locator('[data-eta]').innerText(), /^(약 \d+분 남음\(예상\)|\d+분 남음|곧 끝나요)$/);
    assert.match(await impl.locator('[data-in-stage]').innerText(), /^구현 (방금|.+째)$/);
    assert.ok(await impl.locator('[data-bar]').count() >= 1, 'a stage-time bar');
    await card('배포 막힘').getByText('맡은 사람 없음').waitFor();
    await card('결제 검토').getByText('Rae', { exact: true }).waitFor();
    // The sheet slides in; shoot (and check the width) once it has stopped.
    await page.waitForFunction(() => document.querySelector('[data-slot=sheet-content]').getAnimations().length === 0);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e19b-board.png') });
    // #811 dropped activity toasts (and MODAL_SELECTOR); the open sheet is still a modal dialog.
    assert.equal(await page.locator('[data-slot=sheet-content]').getAttribute('role'), 'dialog', 'the open sheet is a dialog');

    at('blocked reason and capped done column');
    await card('배포 막힘').locator('[data-blocked-reason]').filter({ hasText: '키가 없어요' }).waitFor();
    for (let i = 0; i < 12; i++) await call('POST', '/api/tasks', { title: `끝난 일 ${i}`, stage: 'done' });
    const done = board.locator('[data-stage="done"]');
    await done.getByRole('button', { name: '2개 더 보기' }).waitFor();
    assert.equal(await done.locator('[data-task]').count(), 10);
    const toggle = done.getByRole('button', { name: '2개 더 보기' });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await done.locator('[data-task]').count(), 12);
    // #411: the same button stays mounted, keeps focus and flips to 접기.
    const fold = done.getByRole('button', { name: '접기' });
    assert.equal(await fold.getAttribute('aria-expanded'), 'true');
    assert.ok(await fold.evaluate((el) => el === document.activeElement), 'focus stays on the toggle');
    await fold.click();
    assert.equal(await done.locator('[data-task]').count(), 10);
    await done.getByRole('button', { name: '2개 더 보기' }).click();
    assert.equal(await done.locator('[data-task]').count(), 12);

    at('live stage change');
    const { id } = (await call('GET', '/api/tasks')).tasks.find((x) => x.title === '로그인 화면 만들기');
    await call('POST', '/api/tasks', { id, stage: 'test' });
    await board.locator('[data-stage="test"]').locator('[data-task="로그인 화면 만들기"]').waitFor();
    assert.equal(await board.locator('[data-stage="impl"] [data-task]').count(), 0);
    const spans = await card('로그인 화면 만들기').locator('[data-bar]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bar')));
    assert.deepEqual(spans, ['plan', 'impl', 'test']);

    at('live new task');
    await call('POST', '/api/tasks', { title: '문서 정리', stage: 'plan' });
    await board.locator('[data-stage="plan"]').locator('[data-task="문서 정리"]').waitFor();

    at('narrow screen scrolls the board');
    await page.setViewportSize({ width: 600, height: 800 });
    assert.ok(await board.evaluate((e) => e.scrollWidth > e.clientWidth), 'columns scroll sideways instead of squeezing');

    at('close with Esc');
    await page.keyboard.press('Escape');
    await board.waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-slot=sheet-content]').count(), 0, 'no sheet once it is closed');
    assert.deepEqual(errors, []);
  } catch (e) {
    const shot = join(tmpdir(), `dispatch-board-fail-${Date.now()}.png`);
    await page?.screenshot({ path: shot, fullPage: true }).catch(() => {});
    throw new Error(`[step: ${step}] ${e.message}\nscreenshot: ${shot}\nserver log tail:\n${log.slice(-1500)}`, { cause: e });
  }
});
