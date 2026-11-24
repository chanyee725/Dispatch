// Headless check of the sidebar model row and the 설정 modal's 모델 연결 section it opens (E525, #570, #624) and the 테마 switch:
// connect (CLI login with a sign-in link), cancel, connect again, state after reload (connected and mid-login), disconnect
// (the CLI stays logged in, so 연결 connects at once), 390px drawer; also that no settings command or "," shortcut is left.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no
// real claude, codex or agy can start. It refuses to go on unless the server log names its port and workspace.
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

test('model row and 설정 > 모델 연결: connect, cancel, reload, disconnect with the fake CLI login; theme switch; 390px', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-modelrow-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-modelrow-home-'));
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
  // The fake claude starts logged out; its login prints a sign-in URL and finishes after FAKE_CLI_LOGIN_MS.
  const auth = join(home, 'fake-claude-auth');
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { PATH, HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', FAKE_CLI_LOG: fake.env.FAKE_CLI_LOG, FAKE_CLI_AUTH: auth, FAKE_CLI_LOGIN_MS: '2500', NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
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
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
  const status = await (await fetch(`${BASE}/api/dispatch`)).json();
  assert.equal(status.enabled, true, `Dispatch should be on in the scratch repo: ${JSON.stringify(status)}`);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  const posts = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/providers/') && posts.push(new URL(r.url()).pathname));
  await page.goto(BASE);
  const themes = page.getByRole('radiogroup', { name: '테마' });
  await themes.waitFor();
  // The Claude row; Codex and Gemini have their own (#587).
  const row = page.locator('[data-testid="model-row"][data-provider="claude"]');
  // The row opens the 설정 modal at 모델 연결 (#624); Claude's entry there carries its state, one action and a note.
  const dialog = page.getByTestId('settings-dialog');
  const entry = dialog.locator('[data-testid="settings-provider"][data-provider="claude"]');
  const state = entry;
  const action = entry.getByTestId('settings-provider-action');
  const note = entry.getByRole('status');
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName);
  const rowKey = () => row.getAttribute('data-state-key');
  const until = async (fn, what, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(50)) if (await fn()) return;
    assert.fail(`timed out: ${what}`);
  };
  const shot = (name) => SHOTS && page.screenshot({ path: join(SHOTS, name) });
  // One row per provider id: Claude, OpenAI Codex, Gemini (#587).
  await row.first().waitFor();
  assert.deepEqual(await page.getByTestId('model-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-provider'))), ['claude', 'openai', 'gemini']);
  // Each row shows its provider's own mark (react-icons, #621): decorative inline SVG in its brand colour for the
  // current theme (#670), beside the status dot; the accessible name stays the provider name and its state.
  const marks = await page.getByTestId('model-row').evaluateAll((els) => els.map((e) => {
    const svg = e.querySelector('svg[data-provider-icon]');
    if (!svg) return null;
    const probe = document.createElement('i');
    probe.style.color = svg.style.getPropertyValue(`--brand-${document.documentElement.dataset.theme}`);
    document.body.append(probe);
    const brand = getComputedStyle(probe).color === getComputedStyle(svg).color;
    probe.remove();
    return [svg.getAttribute('data-provider-icon'), svg.closest('[aria-hidden="true"]') !== null, brand, !!e.querySelector('[data-testid="model-row-dot"]')];
  }));
  assert.deepEqual(marks, [['claude', true, true, true], ['openai', true, true, true], ['gemini', true, true, true]]);
  assert.match(await row.getAttribute('aria-label'), /^Claude /);

  // 1. 테마 switch (E527, from Dispatch): three icon radios, 시스템 first and checked; a click applies at once, survives a
  // reload, and arrows/Home/End move the choice with focus. 모니터링 is no longer offered (#702): html.monitor never
  // appears, and a stored 'monitor' choice falls back to 시스템.
  const radio = (name) => themes.getByRole('radio', { name, exact: true });
  const html = () => page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.classList.contains('monitor')]);
  const checked = () => themes.getByRole('radio', { checked: true }).getAttribute('aria-label');
  assert.deepEqual(await themes.getByRole('radio').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['시스템', '라이트', '다크']);
  assert.equal(await checked(), '시스템');
  await radio('다크').click();
  assert.deepEqual(await html(), ['dark', false]);
  await shot('theme-dark.png');
  await page.reload();
  await themes.waitFor();
  assert.equal(await checked(), '다크', 'persists after reload');
  assert.deepEqual(await html(), ['dark', false]);
  await radio('다크').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await checked(), '시스템', 'arrows wrap');
  assert.equal(await radio('시스템').evaluate((el) => el === document.activeElement), true, 'focus follows the choice');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual([await checked(), await html()], ['라이트', ['light', false]]);
  await page.keyboard.press('End');
  assert.equal(await checked(), '다크');
  await page.keyboard.press('Home');
  assert.equal(await checked(), '시스템');
  assert.equal(await page.evaluate(() => localStorage.getItem('drawing.theme')), null, '시스템 stores nothing');
  assert.deepEqual(await themes.getByRole('radio').evaluateAll((els) => els.map((e) => e.tabIndex)), [0, -1, -1], 'one tab stop');
  // A 'monitor' choice stored before #702 reads as 시스템, with no html.monitor.
  await page.evaluate(() => localStorage.setItem('drawing.theme', 'monitor'));
  await page.reload();
  await themes.waitFor();
  assert.equal(await checked(), '시스템', 'stored monitor falls back to 시스템');
  assert.equal((await html())[1], false, 'no html.monitor');
  // #612: one theme store. 다크 picked in the sidebar stays through prefers-color-scheme flips, here and on the
  // Dispatch screen (its own useTheme() caller).
  await radio('다크').click();
  const kept = async (p) => {
    for (const scheme of ['dark', 'light']) {
      await p.emulateMedia({ colorScheme: scheme });
      assert.deepEqual(await p.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.classList.contains('monitor'), localStorage.getItem('drawing.theme')]), ['dark', false, 'dark'], `kept after ${scheme}`);
    }
  };
  await kept(page);
  await page.goto(`${BASE}/dispatch`);
  await page.waitForLoadState('networkidle');
  await kept(page);
  await page.goto(BASE);
  await themes.waitFor();
  // Forced colours: only the chosen radio takes Highlight; the others keep the system button colours.
  await page.emulateMedia({ forcedColors: 'active' });
  const fills = await themes.getByRole('radio').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  assert.equal(new Set(fills.slice(0, 2)).size, 1, `unchosen radios look alike: ${fills}`);
  assert.notEqual(fills[2], fills[0], `chosen radio stands out: ${fills}`);
  await shot('theme-forced-colors.png');
  await page.emulateMedia({ forcedColors: 'none', colorScheme: 'light' });
  await radio('라이트').click();
  assert.equal(await page.getByRole('dialog').count(), 0, 'no settings dialog');
  await page.locator('body').click({ position: { x: 700, y: 400 } });
  await page.keyboard.press('Comma');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '명령 찾기' }).fill('설정');
  assert.equal(await page.getByRole('option', { name: /설정 열기|모델 연결 열기/ }).count(), 0, 'no settings commands');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0, ', opens nothing');

  // 2. Not connected: the row says 연결 안 됨 and opens 설정 > 모델 연결; Claude's one button says 연결.
  await row.getByText('연결 안 됨', { exact: true }).waitFor();
  assert.equal(await rowKey(), 'idle');
  await shot('row-idle-1440.png');
  await row.click();
  await dialog.waitFor();
  assert.equal(await page.getByRole('dialog', { name: '설정' }).count(), 1, 'named by its heading');
  await dialog.getByRole('region', { name: '모델 연결' }).waitFor();
  assert.equal(await dialog.getByRole('navigation', { name: '설정 항목' }).getByRole('button', { name: '모델 연결' }).getAttribute('aria-current'), 'true');
  assert.equal(await entry.locator('svg[data-provider-icon="claude"]').evaluate((s) => s.closest('[aria-hidden="true"]') !== null), true, 'the entry shows the Claude mark, hidden from assistive tech');
  assert.match(await state.innerText(), /연결 안 됨/);
  assert.equal(await action.innerText(), '연결');
  await shot('dialog-idle-1440.png');

  // 3. 연결: the CLI login starts; 로그인 중 with the sign-in link, the same button now says 취소 and keeps focus.
  await action.focus();
  await page.keyboard.press('Enter');
  await until(async () => (await action.innerText()) === '취소', '취소 button');
  assert.match(await state.innerText(), /로그인 중/);
  assert.equal(await active(), 'settings-provider-action', 'focus stays on the action button');
  const link = entry.getByRole('link', { name: /로그인 페이지 열기/ });
  await link.waitFor();
  assert.match(await link.getAttribute('href'), /^https:\/\/login\.example\.invalid\//);
  assert.equal(await rowKey(), 'busy');
  await shot('dialog-busy-1440.png');

  // 4. 취소: back to 연결 안 됨, said in the status line; a cancel is not an error.
  await page.keyboard.press('Enter');
  await until(async () => (await action.innerText()) === '연결', '연결 again after cancel');
  assert.ok(posts.includes('/api/providers/claude/cancel'));
  await until(async () => (await note.innerText()) === '로그인을 취소했어요.', 'cancel note');
  assert.equal(await entry.locator('.text-destructive').count(), 0, 'no error after a cancel');
  assert.equal(await active(), 'settings-provider-action');

  // 5. 연결 again; the login finishes: 연결됨 with the 5-hour usage, 해제, and the note says it connected.
  await page.keyboard.press('Enter');
  await until(async () => (await action.innerText()) === '해제', 'connected', 12000);
  assert.match(await state.innerText(), /연결됨/);
  await until(async () => (await note.innerText()) === 'Claude를 연결했어요.', 'connected note');
  assert.equal(posts.filter((p) => p === '/api/providers/claude/login').length, 2);
  await shot('dialog-connected-1440.png');

  // 6. Esc closes the modal and focus returns to the row; the row shows the connected state.
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await active(), 'model-row');
  assert.equal(await rowKey(), 'connected');
  await shot('row-connected-1440.png');

  // 7. After a reload the row is still connected.
  await page.reload();
  await row.waitFor();
  await until(async () => (await rowKey()) === 'connected', 'connected after reload');

  // 8. 해제 disconnects from Drawing only: the CLI stays logged in, so 연결 connects at once (no new CLI login).
  await row.click();
  await action.click();
  await until(async () => (await action.innerText()) === '연결', 'disconnected');
  assert.match(await note.innerText(), /연결을 해제했어요/);
  assert.equal(await rowKey(), 'idle');
  const logins = () => fake.calls().filter((c) => c.bin === 'claude' && c.args.join(' ') === 'auth login').length;
  const before = logins();
  await action.click();
  await until(async () => (await action.innerText()) === '해제', 'connected at once');
  assert.equal(logins(), before, 'no second CLI login');

  // 9. A login still running survives a reload: log the fake CLI out (cli: true), connect, reload mid-login.
  await action.click();
  await until(async () => (await action.innerText()) === '연결', 'disconnected again');
  await page.evaluate(() => fetch('/api/providers/claude/logout', { method: 'POST', headers: { 'x-drawing': '1', 'content-type': 'application/json' }, body: '{"cli":true}' }));
  await action.click();
  await until(async () => (await action.innerText()) === '취소', 'busy before reload');
  await page.reload();
  await row.waitFor();
  await until(async () => (await rowKey()) === 'busy', 'still 로그인 중 after reload');
  await shot('row-busy-1440.png');
  await row.click();
  assert.equal(await action.innerText(), '취소');
  await until(async () => (await action.innerText()) === '해제', 'login finished after reload', 12000);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  // 10. Not installed (state stubbed): the row says 설치 안 됨 and 모델 연결 offers 다시 확인.
  await page.route('**/api/state', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.providers.claude = { ...body.providers.claude, installed: false, connected: false, busy: false, cli: null, cliLoggedIn: false };
    await route.fulfill({ response: res, json: body });
  });
  await page.reload();
  await row.waitFor();
  await until(async () => (await rowKey()) === 'missing', 'missing');
  await shot('row-missing-1440.png');
  await row.click();
  assert.equal(await action.innerText(), '다시 확인');
  await shot('dialog-missing-1440.png');
  await page.keyboard.press('Escape');
  await page.unroute('**/api/state');
  await page.reload();
  await row.waitFor();

  // 11. 390px: in the drawer the row is at least 44px tall and opens the modal; Esc closes only the modal.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  const drawer = page.getByRole('dialog').getByRole('navigation', { name: '사이드바' });
  await drawer.waitFor();
  const drow = drawer.locator('[data-testid="model-row"][data-provider="claude"]');
  assert.ok((await drow.boundingBox()).height >= 44);
  await drow.click();
  await dialog.waitFor();
  assert.ok((await action.boundingBox()).height >= 44, 'action ≥ 44px');
  await shot('dialog-connected-390.png');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await drawer.count(), 1, 'Esc closes the modal only, not the drawer');

  // Only fakes ran.
  // Only the CLIs server/dispatch/cli.js ALLOWED lists since #606 (claude, codex, agy, git, gh), all of them fakes here.
  const strays = fake.calls().filter((c) => !['claude', 'codex', 'agy', 'git', 'gh'].includes(c.bin)).map((c) => c.bin);
  assert.deepEqual(strays, [], 'no CLI outside the allowed set');
  assert.deepEqual(errors, []);
});
