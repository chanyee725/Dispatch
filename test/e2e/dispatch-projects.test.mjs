// Headless check of the project views (E505d, #484; in the shell since #731; a card dashboard since #879): the 세션
// 보드 takes its scope from the board address (no 프로젝트 card, one project per server), so an old /dispatch#folder= or
// #board=timeline link shows only that project's sessions and timeline, usage labels what is account-wide, back/forward walk the board, and a project home has a 세션 tab linking to the scoped board in the shell.
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

test('세션 board and project home follow the project', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-proj-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-proj-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(join(ws, 'alpha'), { recursive: true });
  mkdirSync(join(ws, 'beta'));
  writeFileSync(join(ws, 'alpha', '.project.json'), JSON.stringify({ name: '알파' }));
  writeFileSync(join(ws, 'beta', '.project.json'), JSON.stringify({ name: '베타' }));

  const fake = fakeCliBin({ scenario: [{ type: 'system', subtype: 'init', session_id: 'fake-proj' }, { type: 'result', subtype: 'success' }] });
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { HOME: home, DRAW_PORT: String(port), ...fake.env, PATH, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
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
    // Wait for the server to exit: it can still be writing run records into the repo, which made rmSync fail (#761).
    if (server.exitCode === null && server.signalCode === null) await new Promise((ok) => { server.once('exit', ok); server.kill(); });
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  try {
    for (let i = 0; i < 100 && !log.includes(`workspace ${ws}`); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
    const call = async (m, u, b) => {
      const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
      const body = await res.json();
      assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
      return body;
    };

    at('seed projects and sessions');
    await call('POST', '/api/providers/claude/login');
    await call('POST', '/api/file', { path: 'alpha/계획', title: '계획' });
    await call('POST', '/api/file', { path: 'beta/계획', title: '계획' });
    const projects = (await call('GET', '/api/workspace/projects')).projects;
    const alpha = projects.find((p) => p.name === '알파').path;
    const beta = projects.find((p) => p.name === '베타').path;
    // Session names are picked by the server at random, so the test reads them back. Rows are found by session id:
    // one name can hold another (Leo, Cleo), and hasText matches substrings, which once matched two rows (#761).
    const mk = async (folder) => (await call('POST', '/api/sessions', { worktree: false, folder, items: [{ role: 'impl', task: 'x' }] })).sessions[0];
    const [a1, a2] = [await mk(alpha), await mk(alpha)];
    const b1 = await mk(beta);
    const u1 = await mk(undefined);

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
    const errors = [];
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    // /dispatch is an old address now: the shell's 세션 보드 takes over (#731).
    await page.goto(`${BASE}/dispatch`);
    await page.waitForURL(`${BASE}/#board`);
    const board = page.locator('[data-session-board]');
    // No 프로젝트 card any more (one project per server, #879): the scope comes from the board address.
    const scopeIs = async (folder) => assert.ok(decodeURIComponent(await page.evaluate(() => location.hash)).includes(`folder=${folder}`));
    const pick = (folder) => page.evaluate((f) => { location.hash = `#board&folder=${encodeURIComponent(f)}`; }, folder);
    const row = (x) => board.locator(`button[data-session="${x.id}"]`);
    const timeline = board.locator('[data-card="timeline"]');

    at('board lists every project and 미분류');
    await row(a1).waitFor();
    assert.equal(await page.locator('[data-nav="board"]').getAttribute('aria-current'), 'page');
    assert.equal(await board.locator('[data-card="projects"]').count(), 0);
    await row(b1).waitFor();
    await row(u1).waitFor();
    // The model tag names the provider by its display name, not the raw id (#521).
    const tag = row(a1).locator('[data-provider]');
    assert.equal(await tag.getAttribute('data-provider'), 'claude');
    assert.equal(await tag.innerText(), 'Claude');

    at('pick a project');
    await pick(alpha);
    await page.waitForFunction(() => location.hash.startsWith('#board&folder='));
    await row(a2).waitFor();
    assert.equal(await row(b1).count(), 0);
    assert.equal(await row(u1).count(), 0);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e505d-board.png') });

    at('timeline card and usage keep the project');
    await timeline.locator(`[data-row="${a1.name}"]`).waitFor();
    assert.equal(await timeline.locator(`[data-row="${b1.name}"]`).count(), 0);
    await board.locator('[data-card="usage"]').getByRole('button', { name: '자세히' }).click();
    await page.waitForFunction(() => location.hash.startsWith('#board=usage&folder='));
    await page.getByRole('heading', { name: '알파 사용량' }).waitFor();
    await page.getByRole('heading', { name: /한도 · 계정 전체/ }).waitFor();
    await page.getByText('이 프로젝트의 세션만').waitFor();
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e505d-usage.png') });

    at('back walks the board, then leaves it');
    await page.goBack();
    await timeline.locator(`[data-row="${a1.name}"]`).waitFor();
    await scopeIs(alpha);
    await page.locator('[data-nav="all"]').click();
    await page.waitForFunction(() => !location.hash.startsWith('#board'));
    assert.equal(await page.locator('[data-session-board]').count(), 0);
    await page.goBack();
    await page.locator(`[data-row="${a1.name}"]`).waitFor();

    at('old links: #board=timeline, #folder= (미분류) and #folder=<path> open the board');
    await page.goto(`${BASE}/#board=timeline&folder=${encodeURIComponent(beta)}`);
    await page.reload(); // a hash-only goto keeps the loaded page
    await timeline.locator(`[data-row="${b1.name}"]`).waitFor();
    assert.equal(await timeline.locator(`[data-row="${a1.name}"]`).count(), 0);
    await scopeIs(beta);
    await page.goto(`${BASE}/dispatch#folder=`);
    await page.waitForURL(`${BASE}/#board&folder=`);
    await row(u1).waitFor();
    assert.equal(await row(a1).count(), 0);
    await page.goto(`${BASE}/dispatch#folder=${encodeURIComponent(beta)}`);
    await row(b1).waitFor();
    assert.equal(await row(a1).count(), 0);

    at('project list fails: a notice, sessions grouped by folder name');
    await page.route('**/api/workspace/projects', (r) => r.fulfill({ status: 500, body: '{}' }));
    await page.goto(`${BASE}/#board`);
    await page.reload(); // a hash-only goto keeps the loaded page
    await page.getByText('프로젝트 목록을 불러오지 못했어요.', { exact: false }).waitFor();
    await page.unroute('**/api/workspace/projects');

    at('project usage fails, then 다시 불러오기 (#522)');
    let failUsage = true;
    await page.route(/\/api\/usage\?folder=/, (r) => (failUsage ? r.fulfill({ status: 500, body: '{}' }) : r.continue()));
    await page.goto(`${BASE}/dispatch#usage&folder=${encodeURIComponent(alpha)}`);
    await page.waitForURL(/#board=usage&folder=/);
    const panel = page.getByRole('region', { name: '알파 사용량' });
    await panel.getByText('프로젝트 사용량을 불러오지 못했어요.').waitFor();
    failUsage = false;
    await panel.getByRole('button', { name: '다시 불러오기' }).click();
    await panel.getByText('2개', { exact: true }).waitFor();
    assert.equal(await panel.getByText('프로젝트 사용량을 불러오지 못했어요.').count(), 0);
    await page.unroute(/\/api\/usage\?folder=/);

    at('phone: the board fits without sideways scrolling');
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`${BASE}/#board`);
    await page.reload();
    await row(a1).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e505d-narrow.png') });

    at('shortcut S opens the board from the dashboard');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/`);
    await page.reload();
    // The sidebar's project row; its name also carries the file count.
    const alphaNav = page.getByRole('button').filter({ has: page.getByText('알파', { exact: true }) });
    await alphaNav.waitFor();
    await page.keyboard.press('s');
    await page.waitForFunction(() => location.hash === '#board');
    await row(a1).waitFor();

    at('project home 세션 tab links to the board in the shell');
    await page.goto(`${BASE}/`);
    await page.reload();
    await alphaNav.waitFor();
    // G P opens the command menu on projects only (listed by folder name); picking one opens its home.
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await page.getByRole('combobox', { name: '명령 찾기' }).waitFor();
    await page.getByRole('option', { name: 'alpha', exact: true }).click();
    await page.getByRole('tab', { name: '세션' }).click();
    await page.getByRole('region', { name: '세션' }).getByText(a1.name, { exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: '세션' }).getByText(b1.name, { exact: true }).count(), 0);
    await page.getByRole('region', { name: '실행 기록' }).getByText('아직 없어요', { exact: false }).waitFor();
    const link = page.getByRole('link', { name: /세션 보드에서 보기/ });
    assert.equal(await link.getAttribute('href'), `/#board&folder=${encodeURIComponent(alpha)}`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e505d-home.png') });
    await link.click();
    await page.waitForFunction(() => location.hash.startsWith('#board&folder='));
    await scopeIs(alpha);
    await row(a1).waitFor();
    assert.equal(await row(b1).count(), 0);
    assert.deepEqual(errors, []);
  } catch (e) {
    const shot = join(tmpdir(), `dispatch-projects-fail-${Date.now()}.png`);
    await page?.screenshot({ path: shot, fullPage: true }).catch(() => {});
    throw new Error(`[step: ${step}] ${e.message}\nscreenshot: ${shot}\nserver log tail:\n${log.slice(-1500)}`, { cause: e });
  }
});
