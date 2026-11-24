// Headless check of the 설정 modal (E509c): the sidebar 설정 row opens a modal for the usage-limit and session-length guards:
// open, change a value (saved to the server), reset to default, Esc closes, focus returns, 390px (#552: Esc closes
// only the modal, not the sidebar drawer; Fable keeps following the weekly value unless the user sets it).
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no
// real claude can start. It refuses to go on unless the server log names its port and workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

test('설정 modal: open, change, reset, focus return, Fable follows weekly, 390px Esc', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-limits-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-limits-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const fake = fakeCliBin();
  const port = await freePort();
  // Fakes first; git's own folder after them (fakes win any name clash).
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
    server.kill();
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
  const state = async () => (await (await fetch(`${BASE}/api/state`)).json()).settings;
  // #676: the Claude guard group shows only once Claude is connected here (the fake CLI says it is logged in).
  const login = await fetch(`${BASE}/api/providers/claude/login`, { method: 'POST', headers: { 'x-drawing': '1' } });
  assert.equal((await login.json()).connected, true, 'the fake Claude connects');

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(BASE);
  const entry = page.getByRole('button', { name: '설정', exact: true });
  await entry.waitFor();
  const dialog = page.getByRole('dialog', { name: '설정' });
  const five = dialog.getByRole('spinbutton', { name: /^5시간 한도/ });
  const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);

  // 1. Open: focus moves into the modal, defaults shown, saved values loaded.
  await entry.click();
  await dialog.waitFor();
  // The modal opens on 일반; 사용 한도 holds the guard form (#624).
  await dialog.getByRole('navigation', { name: '설정 항목' }).getByRole('button', { name: '사용 한도' }).click();
  await five.waitFor();
  assert.equal(await five.inputValue(), '90');
  assert.match(await dialog.innerText(), /기본값 90/);
  assert.equal(await dialog.getByRole('spinbutton', { name: /^Fable 주간 한도/ }).inputValue(), '85');
  assert.equal(await dialog.getByRole('spinbutton', { name: /^토큰 한도/ }).inputValue(), '15');
  assert.equal(await dialog.getByRole('spinbutton', { name: /^컨텍스트 한도/ }).inputValue(), '70');
  assert.equal(await dialog.evaluate((d) => d.contains(document.activeElement)), true, 'focus is inside the modal');

  // 2. Change two values and save: the server has them, the guard stays on.
  await five.fill('80');
  await dialog.getByRole('spinbutton', { name: /^토큰 한도/ }).fill('20');
  await dialog.getByRole('button', { name: '저장' }).click();
  await dialog.getByText('저장했어요.').waitFor();
  let s = await state();
  assert.equal(s.guard.five, 0.8);
  assert.equal(s.guard.enabled, true);
  assert.equal(s.team.handoffMTokens, 20);
  assert.equal(s.guard.fable, undefined, 'untouched Fable is not pinned');

  // 2b. 주간 한도 changes while Fable follows: the Fable field mirrors it and nothing pins Fable. Typing Fable pins it.
  const seven = dialog.getByRole('spinbutton', { name: /^주간 한도/ });
  const fable = dialog.getByRole('spinbutton', { name: /^Fable 주간 한도/ });
  await seven.fill('70');
  assert.equal(await fable.inputValue(), '70');
  await dialog.getByRole('button', { name: '저장' }).click();
  await dialog.getByText('저장했어요.').waitFor();
  s = await state();
  assert.deepEqual([s.guard.seven, s.guard.fable], [0.7, undefined]);
  await fable.fill('60');
  await dialog.getByRole('button', { name: '저장' }).click();
  await dialog.getByText('저장했어요.').waitFor();
  s = await state();
  assert.deepEqual([s.guard.seven, s.guard.fable], [0.7, 0.6]);
  // 2c. Clearing the Fable field means "follow weekly" again: no range error, fable: null is sent (#563).
  await fable.fill('');
  assert.match(await dialog.innerText(), /주간 한도를 따라요/);
  await dialog.getByRole('button', { name: '저장' }).click();
  await dialog.getByText('저장했어요.').waitFor();
  s = await state();
  assert.deepEqual([s.guard.seven, s.guard.fable], [0.7, undefined]);
  assert.equal(await fable.inputValue(), '70', 'the field shows the weekly value again');

  // 3. An out-of-range value is not sent (the browser blocks the submit), then 기본값으로 on one field.
  await five.fill('0');
  await dialog.getByRole('button', { name: '저장' }).click();
  assert.equal((await state()).guard.five, 0.8);
  await dialog.getByRole('button', { name: '5시간 한도 기본값으로' }).click();
  assert.equal(await five.inputValue(), '90');
  assert.equal(await dialog.getByRole('spinbutton', { name: /^토큰 한도/ }).inputValue(), '20', 'other values stay');

  // 4. 모두 기본값으로 clears the old 저장했어요. and, with 저장, puts every default back; Fable follows weekly again.
  await dialog.getByRole('button', { name: '모두 기본값으로' }).click();
  assert.equal(await dialog.getByText('저장했어요.').count(), 0);
  assert.match(await dialog.innerText(), /주간 한도를 따라요/);
  await dialog.getByRole('button', { name: '저장' }).click();
  await dialog.getByText('저장했어요.').waitFor();
  s = await state();
  assert.deepEqual([s.guard.five, s.guard.seven, s.guard.fable, s.team.handoffMTokens, s.team.ctxHandoff], [0.9, 0.85, undefined, 15, 70]);

  // 5. Esc closes and focus returns to the 설정 row.
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await entry.evaluate((el) => el === document.activeElement), true, 'focus returns to 설정');

  // 6. Narrow width: the sidebar is a drawer; the modal fits, and one Esc closes only the modal (the drawer stays
  // open and focus goes back to 설정). A second Esc closes the drawer. (The 테마 menu is covered by model-row.)
  await page.setViewportSize({ width: 390, height: 780 });
  await page.reload();
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  const drawer = page.locator('[data-slot="sheet-content"]');
  await drawer.waitFor();
  await entry.click();
  await dialog.waitFor();
  await five.waitFor(); // it reopens on the remembered section, 사용 한도
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `fits 390px: ${JSON.stringify(box)}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'limits-modal-390.png') });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  // Focus goes back to 설정 one frame after close; by then a drawer that wrongly took the Esc would be closing too.
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'settings-trigger');
  assert.equal(await drawer.isVisible(), true, 'the drawer stays open after one Esc');
  assert.equal(await entry.evaluate((el) => el === document.activeElement), true, 'focus returns to 설정 in the drawer');
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
});
