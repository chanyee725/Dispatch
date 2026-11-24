// Headless 1400px screenshots of #954, light and dark: the issue row opens the chat dock with the issue card, the
// helper's proposal and the 시작하기 bar; then 시작하기 once (a new lead is made) and the status line.
// Usage: CHROME=/path/chrome-headless-shell PLAYWRIGHT_CORE=/path/playwright-core node Issues/954/capture.mjs
// Starts its own server on a free port against a scratch workspace in a scratch git repo, with the fake CLIs
// (test/fixtures/fake-cli: claude answers with a canned proposal, gh lists two issues), and stops it at the end.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeCliBin } from '../../test/fixtures/fake-cli/index.mjs';

const out = new URL('.', import.meta.url).pathname;
const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
const port = await new Promise((ok) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});
const repo = mkdtempSync(join(tmpdir(), 'draw-954-'));
const home = mkdtempSync(join(tmpdir(), 'draw-954-home-'));
const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd: repo, stdio: 'ignore' });
git('init', '-q');
writeFileSync(join(repo, 'README'), 'scratch\n');
git('add', '.');
git('commit', '-qm', 'init');
const ws = join(repo, 'ws');
mkdirSync(ws);

const PROPOSAL = [
  '**할 일**: 이슈 행을 누르면 채팅에서 제안을 받고, 시작하기로만 관리자에게 넘겨요.',
  '**범위**: `IssuesCard`, `ChatDock`, 시작 바. 서버는 요약 API만 써요.',
  '**팀**: 관리자 1(Sonnet), 구현 1(Opus), 리뷰 1(Sonnet).',
].join('\n\n');
const fake = fakeCliBin({
  scenarios: {
    claude: [
      { type: 'system', subtype: 'init', session_id: 'fake-954' },
      { $sleep: 600 },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: PROPOSAL }], usage: { input_tokens: 10, output_tokens: 5 } } },
      { type: 'result', subtype: 'success', total_cost_usd: 0.001 },
    ],
  },
});
// The fake gh comes first on PATH (git's folder may hold a real one).
writeFileSync(join(fake.dir, 'gh'), `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(new URL('../../test/fixtures/fake-cli/gh.mjs', import.meta.url).pathname).href)});\n`, { mode: 0o755 });
const ghScenario = join(fake.dir, 'gh.json');
writeFileSync(ghScenario, JSON.stringify({
  'issue list': [
    { number: 954, title: 'E954: 이슈에서 채팅으로 제안받고 시작하기', url: 'https://github.com/o/r/issues/954' },
    { number: 951, title: 'E951: 세션 보드 정렬', url: 'https://github.com/o/r/issues/951' },
  ],
  954: { number: 954, body: '## 목표\n이슈 행을 누르면 도우미가 할 일과 범위, 팀을 제안하고 시작하기를 눌러야 관리자에게 가요.\n\n- 시작하기는 한 번만' },
}));
const PATH = `${fake.dir}:${dirname(execFileSync('which', ['git']).toString().trim())}`;
const server = spawn(process.execPath, ['server/index.js', ws], {
  env: { HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', ...fake.env, FAKE_GH_SCENARIO: ghScenario, PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
let browser;
try {
  for (let i = 0; i < 100 && !log.includes(`workspace ${ws}`); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`))) throw new Error(`unexpected server log: ${log}`);
  const BASE = `http://127.0.0.1:${port}`;
  await fetch(`${BASE}/api/providers/claude/login`, { method: 'POST', headers: { 'x-drawing': '1' } });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  // Dark first: the light pass presses 시작하기, which gives #954 a team, and a row with a team opens the team panel.
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript((t) => localStorage.setItem('drawing.theme', t), theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    await page.route('**/api/user-defaults', (r) => r.fulfill({ status: 404, body: '{}' }));
    await page.goto(`${BASE}/`);
    const row = page.locator('[data-issue-open="954"]').first();
    await row.waitFor({ timeout: 30000 }).catch(async (e) => {
      console.log('issues', await (await fetch(`${BASE}/api/issues`)).text(), page.url());
      await page.screenshot({ path: join(out, 'debug.png') });
      throw e;
    });
    await page.screenshot({ path: join(out, `${theme}-1-rows.png`) });
    await row.click();
    await page.locator('[data-chat-issue="954"]').waitFor({ timeout: 10000 });
    const bar = page.locator('[data-issue-start-bar]');
    await bar.waitFor({ timeout: 30000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${theme}-2-proposal.png`) });
    // No lead was made before 시작하기.
    const before = await (await fetch(`${BASE}/api/state`)).json();
    const leadsBefore = before.sessions.filter((s) => s.role === 'lead').length;
    if (theme === 'light') {
      await page.locator('[data-issue-revise]').click();
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      const btn = page.locator('[data-issue-start-button]');
      // Two presses in a row: only one lead may be made.
      await btn.evaluate((b) => { b.click(); b.click(); });
      await page.locator('[data-issue-start-bar] [role="status"]', { hasText: '만들었어요' }).waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      const after = await (await fetch(`${BASE}/api/state`)).json();
      const leadsAfter = after.sessions.filter((s) => s.role === 'lead').length;
      console.log(JSON.stringify({ theme, focusAfterRevise: focused, leadsBefore, leadsAfter, disabled: await btn.isDisabled() }));
      await page.screenshot({ path: join(out, `${theme}-3-started.png`) });
    } else {
      console.log(JSON.stringify({ theme, leadsBefore }));
    }
    if (errors.length) console.log('page errors', errors);
    await ctx.close();
  }
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) await new Promise((ok) => { server.once('exit', ok); server.kill(); });
  fake.cleanup();
  rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
