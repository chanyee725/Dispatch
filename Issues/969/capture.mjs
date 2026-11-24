// Headless 1400px screenshots of #969, light and dark: 설정 > 관리자와 팀 with the 오래 쓴 세션 자동 교체 toggle.
// Usage: CHROME=/path/chrome-headless-shell PLAYWRIGHT_CORE=/path/playwright-core node Issues/969/capture.mjs
// Starts its own server on a free port against a scratch workspace in a scratch git repo, with the fake CLIs, and
// stops it at the end.
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
const repo = mkdtempSync(join(tmpdir(), 'draw-969-'));
const home = mkdtempSync(join(tmpdir(), 'draw-969-home-'));
const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd: repo, stdio: 'ignore' });
git('init', '-q');
writeFileSync(join(repo, 'README'), 'scratch\n');
git('add', '.');
git('commit', '-qm', 'init');
const ws = join(repo, 'ws');
mkdirSync(ws);
const fake = fakeCliBin();
const PATH = `${fake.dir}:${dirname(execFileSync('which', ['git']).toString().trim())}`;
const server = spawn(process.execPath, ['server/index.js', ws], {
  env: { HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', ...fake.env, PATH },
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
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript((t) => {
      localStorage.setItem('drawing.theme', t);
    }, theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    await page.goto(`${BASE}/dispatch#settings`);
    await page.getByRole('button', { name: '관리자와 팀' }).or(page.getByRole('tab', { name: '관리자와 팀' })).first().click({ timeout: 30000 });
    const toggle = page.getByText('오래 쓴 세션 자동 교체').first();
    await toggle.waitFor({ timeout: 30000 }).catch(async (e) => {
      await page.screenshot({ path: join(out, 'debug.png') });
      throw e;
    });
    await toggle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${theme}-settings-team.png`) });
    console.log(JSON.stringify({ theme, errors }));
    await ctx.close();
  }
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) await new Promise((ok) => { server.once('exit', ok); server.kill(); });
  fake.cleanup();
  rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
