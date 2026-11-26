// Headless check of a saved session whose provider no longer runs (E508c, #532): its sheet hides the message box,
// shows the read-only note, and the empty-chat copy does not promise to resume it.
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
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

test('a saved session of a provider that no longer runs opens read-only', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-readonly-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-readonly-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  // A session saved by an older version with a provider the server no longer starts. Metadata only, as on disk.
  const now = Date.now();
  const legacy = {
    id: 'legacy-1', n: 1, name: 'Old', role: 'impl', roleName: '구현자', provider: 'legacy', model: 'legacy-model', modelLabel: 'Legacy',
    effort: null, perm: 'auto', canSpawn: false, cwd: repo, branch: null, worktree: false, parent: null, folder: null,
    status: 'idle', startedAt: now - 60e3, updatedAt: now - 30e3, turns: 1, ctx: 0, ctxWindow: 200000,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: null, providerSessionId: null,
  };
  mkdirSync(join(repo, '.dispatch'));
  writeFileSync(join(repo, '.dispatch', 'state.json'), JSON.stringify({ seq: 1, sessions: { [legacy.id]: legacy } }));

  const fake = fakeCliBin({ scenario: [{ type: 'system', subtype: 'init', session_id: 'fake-readonly' }, { type: 'result', subtype: 'success' }] });
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

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
    const errors = [];
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    await page.goto(`${BASE}/dispatch`);

    at('open the saved session');
    // The server closes it (done) on load, so it sits behind the 끝난 세션 toggle (#731 board).
    await page.getByRole('button', { name: /끝난 세션 1개 보기/ }).click();
    // #731 rows add a screen-reader state after the name, so open the row itself.
    await page.locator('[data-session="legacy-1"]').filter({ hasText: 'Old' }).click();
    // #728: a row opens the live view first; #905: its 대화 tab shows the chat inside the panel.
    const live = page.locator('dialog[data-agent-live="legacy-1"]');
    await live.getByRole('tab', { name: '대화', exact: true }).click();
    const sheet = live.locator('[data-session-tab="chat"]');
    await sheet.waitFor();

    at('read-only note instead of the message box');
    const note = sheet.getByRole('note');
    await note.waitFor();
    assert.equal(await note.innerText(), '이 세션은 더 이상 이어서 실행할 수 없어요. 대화만 볼 수 있어요.');
    assert.equal(await sheet.locator('textarea').count(), 0, 'no message box');

    at('empty chat does not offer to resume');
    const empty = sheet.getByText('이번 서버 실행 중에 주고받은 대화가 없어요.', { exact: true });
    await empty.waitFor();
    assert.equal(await sheet.getByText(/이어서 실행해요/).count(), 0);
    assert.deepEqual(errors, []);
  } catch (e) {
    const shot = join(tmpdir(), `dispatch-readonly-fail-${Date.now()}.png`);
    await page?.screenshot({ path: shot, fullPage: true }).catch(() => {});
    throw new Error(`[step: ${step}] ${e.message}\nscreenshot: ${shot}\nserver log tail:\n${log.slice(-1500)}`, { cause: e });
  }
});
