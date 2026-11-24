// Headless check of the PR/CI tracking item in the session board's ⋯ menu (#402, E509; a menu checkbox since #731):
// it flips and persists, and a broken
// <workspace>/.drawing/settings.json (server 409) shows the real cause instead of "이 서버에선 바꿀 수 없어요".
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// Scratch git repo + scratch HOME; PATH holds the fake CLIs from test/fixtures/fake-cli/, so no real claude, codex or agy can start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeCliBin } from '../fixtures/fake-cli/index.mjs';
import { which } from '../../server/dispatch/cli.js';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

test('project screen: PR/CI switch flips, persists, names a broken settings file once, keeps focus, says when a retry still fails and recovers', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-prtoggle-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-prtoggle-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const settingsFile = join(ws, '.drawing', 'settings.json');
  const fake = fakeCliBin();
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { PATH, HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', FAKE_CLI_LOG: fake.env.FAKE_CLI_LOG, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  t.after(async () => {
    await browser?.close();
    // Wait for the server to exit so it cannot write into the scratch repo while it is being removed (ENOTEMPTY).
    const exited = server.exitCode !== null ? Promise.resolve() : new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  // #731: the switch became a checkbox item in the board's ⋯ menu; the menu stays open while it flips.
  const sw = page.getByRole('menuitemcheckbox', { name: 'PR·CI 추적', exact: true });
  // The cause and notices go to the board's status line (sr-only) and the item's title.
  const line = page.locator('[data-session-board] span.sr-only[role="status"]');
  const open = async () => {
    await page.goto(`${BASE}/dispatch`);
    const more = page.getByRole('button', { name: '더 보기' });
    await page.waitForFunction(() => !document.querySelector('button[aria-label="더 보기"]')?.disabled, null, { timeout: 10_000 });
    await more.click();
    await sw.waitFor({ timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('[role="menuitemcheckbox"]')?.getAttribute('aria-disabled') !== 'true');
  };
  const checked = (on) => page.getByRole('menuitemcheckbox', { name: 'PR·CI 추적', exact: true, checked: on }).waitFor();
  const BROKEN = '설정 파일을 읽을 수 없어요. 파일을 확인해 주세요.';
  const STILL = '아직 읽을 수 없어요.';

  // 0. The sidebar has 테마 and the 설정 row (E509c, limits only); the old dialog with the PR toggle is gone.
  await page.goto(BASE);
  await page.getByRole('radiogroup', { name: '테마' }).waitFor();
  await page.getByRole('button', { name: '설정', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);

  // 1. Healthy: on by default, flips off, persists in settings.json, and flips back on.
  await open();
  assert.equal(await sw.getAttribute('aria-checked'), 'true');
  await sw.click();
  await checked(false);
  assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).prStatus, false);
  await sw.click();
  await checked(true);
  assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).prStatus, true, 'default on is kept');

  // 2. The file breaks while the page is open: the 409 shows the cause once (status line and the item's title); the
  // item stays enabled with keyboard focus on it; a retry that still fails says so; after fixing the file it recovers in place.
  writeFileSync(settingsFile, '{ not json');
  await sw.focus();
  await page.keyboard.press('Space');
  await page.getByText(BROKEN).waitFor({ state: 'attached' });
  assert.equal(await page.getByText(BROKEN).count(), 1, 'the 409 cause shows once');
  assert.equal(await page.getByText('이 서버에선 바꿀 수 없어요').count(), 0);
  assert.match((await sw.getAttribute('title')) ?? '', /설정 파일을 읽을 수 없어요/);
  assert.notEqual(await sw.getAttribute('aria-disabled'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitemcheckbox', 'focus stays on the item');
  assert.equal(await page.getByText(STILL).count(), 0, 'the first 409 shows no retry notice');
  await page.keyboard.press('Space');
  await line.filter({ hasText: STILL }).waitFor({ state: 'attached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitemcheckbox');
  writeFileSync(settingsFile, JSON.stringify({ prStatus: true }));
  await page.keyboard.press('Space');
  await page.getByText(BROKEN).waitFor({ state: 'detached' });
  assert.doesNotMatch((await sw.getAttribute('title')) ?? '', /설정 파일을 읽을 수 없어요/);
  assert.equal(await line.evaluate((el) => el.textContent === '' && getComputedStyle(el).display !== 'none'), true, 'the live region stays rendered while empty');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitemcheckbox');

  // 3. Opened with the file already broken (GET 409): same cause shown once and linked; the switch stays usable.
  writeFileSync(settingsFile, '{ not json');
  await open();
  await page.getByText(BROKEN).waitFor({ state: 'attached' });
  assert.equal(await page.getByText(BROKEN).count(), 1);
  assert.equal(await page.getByText('이 서버에선 바꿀 수 없어요').count(), 0);
  assert.match((await sw.getAttribute('title')) ?? '', /설정 파일을 읽을 수 없어요/);
  assert.notEqual(await sw.getAttribute('aria-disabled'), 'true');

  // 4. Two toggles 120ms apart (#419): the first POST answers late ({on:false}), the second at once ({on:true}).
  // The late response must not overwrite the newer switch state.
  writeFileSync(settingsFile, JSON.stringify({ prStatus: true }));
  await open();
  assert.equal(await sw.getAttribute('aria-checked'), 'true');
  let posts = 0;
  const bodies = [];
  let firstAnswered;
  const firstDone = new Promise((r) => (firstAnswered = r));
  await page.route('**/api/workspace/pr-tracking', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const n = ++posts;
    bodies.push(route.request().postDataJSON());
    const json = (on) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ on }) });
    if (n === 1) {
      await new Promise((r) => setTimeout(r, 500));
      await json(false);
      return firstAnswered();
    }
    return json(true);
  });
  const until = async (cond) => {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25));
    assert.ok(cond(), 'timed out');
  };
  await sw.evaluate((el) => el.click());
  await until(() => posts === 1);
  await sw.evaluate((el) => el.click());
  await until(() => posts === 2);
  await firstDone;
  await page.waitForTimeout(200);
  assert.equal(posts, 2);
  assert.deepEqual(bodies, [{ on: false }, { on: false }]);
  assert.equal(await sw.getAttribute('aria-checked'), 'true', 'the late first response does not overwrite the newer switch state');
  await page.unroute('**/api/workspace/pr-tracking');

  assert.deepEqual(errors, []);
});
