// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// Project mode (E30a): since 1042f847 the server started with --project-mode serves the whole app; /dispatch goes to the
// 세션 보드 in the shell (#731), whose ⋯ menu holds the PR·CI item.
// Scratch git repo in a temp dir, scratch HOME, fake CLIs only; the server log must name this workspace.
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
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

test('project mode: / opens the app shell, /dispatch opens the 세션 보드 with PR·CI tracking', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 60_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-pmode-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-pmode-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'workspace');
  mkdirSync(ws);
  const fake = fakeCliBin({ scenario: [] });
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', '--project-mode', ws], {
    env: { HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', ...fake.env, PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  let browser;
  t.after(async () => {
    await browser?.close();
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 300)));
  const BASE = `http://127.0.0.1:${port}`;
  // 1042f847: / is the app shell (sidebar and all), no redirect to /dispatch.
  await page.goto(`${BASE}/`);
  await page.getByRole('navigation', { name: '사이드바' }).waitFor({ timeout: 10_000 });
  assert.equal(new URL(page.url()).pathname, '/');
  // #731: /dispatch goes to the shell's 세션 보드. Its header is one row at 1280px: the 48px tabs and the bottom border
  // (E30d's 48px was the old run header's).
  await page.goto(`${BASE}/dispatch`);
  await page.waitForURL((u) => u.pathname === '/' && u.hash.startsWith('#board'));
  const header = page.locator('[data-session-board] header');
  await header.waitFor({ timeout: 10_000 });
  const headerH = await header.evaluate((el) => el.getBoundingClientRect().height);
  const tabsH = await header.getByRole('navigation', { name: '세션 보드 화면' }).evaluate((el) => el.getBoundingClientRect().height);
  assert.deepEqual([tabsH, headerH], [48, 49], `board header ${headerH}px, tabs ${tabsH}px`);
  // E30c: PR/CI tracking (a ⋯ menu item since #731) flips through the real route.
  const sw = page.getByRole('menuitemcheckbox', { name: 'PR·CI 추적', exact: true });
  const openMenu = async () => {
    await page.waitForFunction(() => !document.querySelector('button[aria-label="더 보기"]')?.disabled, null, { timeout: 10_000 });
    await page.getByRole('button', { name: '더 보기' }).click();
    await sw.waitFor({ timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('[role="menuitemcheckbox"]')?.getAttribute('aria-disabled') !== 'true');
  };
  await openMenu();
  assert.equal(await sw.getAttribute('aria-checked'), 'true');
  const on = async () => (await (await fetch(`${BASE}/api/workspace/pr-tracking`)).json()).on;
  await sw.click();
  await page.getByRole('menuitemcheckbox', { name: 'PR·CI 추적', exact: true, checked: false }).waitFor();
  assert.equal(await on(), false);
  await sw.click();
  await page.getByRole('menuitemcheckbox', { name: 'PR·CI 추적', exact: true, checked: true }).waitFor();
  assert.equal(await on(), true);
  await page.keyboard.press('Escape');

  // The board nav stays whole at phone and desktop widths, also with a broken settings.json (409).
  const nav = page.getByRole('navigation', { name: '세션 보드 화면' });
  const navFits = () =>
    nav.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { fits: r.width > 0 && el.scrollWidth <= el.clientWidth + 1 && r.left >= 0 && r.right <= innerWidth + 1, width: r.width, scroll: el.scrollWidth };
    });
  const BROKEN = /설정 파일을 읽을 수 없어요/;
  for (const broken of [false, true]) {
    if (broken) writeFileSync(join(ws, '.drawing', 'settings.json'), '{ not json');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.reload();
      await nav.waitFor({ timeout: 10_000 });
      if (broken) await page.getByText(BROKEN).waitFor({ state: 'attached', timeout: 10_000 });
      const m = await navFits();
      assert.ok(m.fits, `nav clipped at ${width}px (broken settings: ${broken}): ${JSON.stringify(m)}`);
    }
  }
  // The item's name stays fixed; the broken-file cause is its title and the board's status line.
  await openMenu();
  assert.match((await sw.getAttribute('title')) ?? '', BROKEN);
  assert.deepEqual(errors, []);
});
