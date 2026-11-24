// Headless check of 설정 with Dispatch off (#620, #624): a workspace outside git. The 설정 modal still renders: the
// theme choice works, and the session sections (answer style, team, role models, usage, limits) are read-only, each
// with one line saying why and what to do. Nothing is saved.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no
// real claude can start. It refuses to go on unless the server log names its port and workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

test('설정 with Dispatch off: the modal renders, theme works, session sections read-only with the reason', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  // A plain folder, not a git repo: Dispatch is off with reason not-git.
  const ws = mkdtempSync(join(tmpdir(), 'draw-settings-off-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-settings-off-home-'));
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
    server.kill();
    fake.cleanup();
    rmSync(ws, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
  const status = await (await fetch(`${BASE}/api/dispatch`)).json();
  assert.equal(status.enabled, false);
  assert.equal(status.reason, 'not-git');

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  const posts = [];
  page.on('request', (r) => r.method() !== 'GET' && r.url().includes('/api/settings') && posts.push(r.url()));
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);

  // 1. The modal opens on 일반: the theme choice works; the answer-style switch is read-only with the reason.
  await page.goto(BASE);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '설정' });
  await dialog.waitFor();
  const nav = dialog.getByRole('navigation', { name: '설정 항목' });
  const section = (name) => nav.getByRole('button', { name, exact: true }).click();
  const general = dialog.getByRole('region', { name: '일반' });
  await general.getByTestId('settings-off-note').waitFor();
  assert.match(await general.getByTestId('settings-off-note').innerText(), /git 저장소 밖.*다시 열면 바꿀 수 있어요/);
  assert.equal(await general.getByRole('switch', { name: '답변 스타일 지침 넣기' }).or(general.getByRole('checkbox', { name: '답변 스타일 지침 넣기' })).isDisabled(), true);
  const themes = general.getByRole('radiogroup', { name: '화면 테마' });
  await themes.getByRole('radio', { name: '다크', exact: true }).click();
  assert.equal(await theme(), 'dark');
  await themes.getByRole('radio', { name: '라이트', exact: true }).click();
  assert.equal(await theme(), 'light');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/settings-off-modal-1440.png` });

  // 2. Every session section renders read-only with its defaults and the reason; nothing offers 저장.
  await section('사용 한도');
  const limits = dialog.getByRole('region', { name: '사용 한도' });
  const five = limits.getByRole('spinbutton', { name: /^5시간 한도/ });
  await five.waitFor();
  assert.equal(await five.isDisabled(), true);
  assert.notEqual(await five.inputValue(), '');
  await limits.getByRole('group', { name: '모델별 사용량' }).getByTestId('settings-off-note').waitFor();
  await section('관리자와 팀');
  const team = dialog.getByRole('region', { name: '관리자와 팀' });
  const maxChildren = team.getByRole('spinbutton', { name: /^관리자 한 명이 둘 수 있는 팀원/ });
  assert.equal(await maxChildren.isDisabled(), true);
  assert.equal(await maxChildren.inputValue(), '8', 'defaults show');
  await team.getByTestId('settings-off-note').waitFor();
  await section('모드별 모델');
  await dialog.getByRole('region', { name: '모드별 모델' }).getByTestId('settings-off-note').waitFor();
  assert.equal(await dialog.getByRole('button', { name: '저장' }).count(), 0, 'nothing to save');
  const notes = await dialog.getByTestId('settings-off-note').allTextContents();
  assert.ok(notes.length >= 5, `each session section says why: ${notes.length}`);
  for (const t of notes) assert.match(t, /git 저장소 밖/);

  // 3. Narrow width: the modal fits and nothing overflows sideways; a <select> picks the section.
  // Below 768px the sidebar becomes a drawer (a different tree), so open the modal again from there.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.reload();
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await dialog.waitFor();
  const select = dialog.getByRole('combobox', { name: '설정 항목' });
  await select.selectOption({ label: '사용 한도' });
  await five.waitFor();
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `fits 390px: ${JSON.stringify(box)}`);
  // Nothing inside the modal scrolls sideways.
  const wide = await dialog.evaluate((d) => [d, ...d.querySelectorAll('.settings-dialog-body')].map((e) => e.scrollWidth - e.clientWidth));
  assert.deepEqual(wide, [0, 0], `no sideways scroll in the modal at 390px: ${wide}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/settings-off-modal-390.png` });

  assert.deepEqual(posts, [], 'nothing saved');
  assert.deepEqual(errors, []);
});
