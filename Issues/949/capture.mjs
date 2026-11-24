// Headless 1400px screenshots of the 플랜 tab with a 5-step linear plan, light and dark (#949).
// Usage: CHROME=/path/chrome-headless-shell PLAYWRIGHT_CORE=/path/playwright-core node Issues/949/capture.mjs <prefix>
// Starts its own server on a free port against a scratch workspace in a scratch git repo, and stops it at the end.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const prefix = process.argv[2] ?? 'after';
const out = new URL('.', import.meta.url).pathname;
const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
const port = await new Promise((ok) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});
const repo = mkdtempSync(join(tmpdir(), 'draw-949-'));
const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd: repo, stdio: 'ignore' });
git('init', '-q');
writeFileSync(join(repo, 'README'), 'scratch\n');
git('add', '.');
git('commit', '-qm', 'init');
const ws = join(repo, 'ws');
mkdirSync(ws);
const server = spawn(process.execPath, ['server/index.js', ws], { env: { ...process.env, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
let browser;
try {
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`))) throw new Error(`unexpected server log: ${log}`);
  const BASE = `http://127.0.0.1:${port}`;
  const call = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) })).json();
  const STEPS = ['plan', 'impl', 'review', 'test', 'merge'];
  const CODE = ['plan [label: "계획 세우기"]', 'impl [label: "구현"]', 'review [label: "리뷰"]', 'test [label: "테스트"]', 'merge [label: "머지"]', 'plan > impl > review > test > merge'].join('\n');
  const plan = { v: 1, block: 'b1', defaults: { role: 'impl' }, steps: STEPS.map((id) => ({ id, node: id, role: { plan: 'lead', review: 'review', test: 'test', merge: 'merge' }[id] })) };
  const f = await call('POST', '/api/file', { path: 'run', title: 'Run' });
  const put = await call('PUT', '/api/file?path=run', {
    ...f,
    version: 2,
    blocks: [{ id: 'b1', type: 'flowchart', code: CODE, x: 0, y: 0, w: 0, h: 0 }],
    document: { type: 'doc', content: [{ type: 'diagram', attrs: { blockId: 'b1' } }] },
    plan,
  });
  if (put.error) throw new Error(JSON.stringify(put));

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript((t) => localStorage.setItem('drawing.theme', t), theme);
    const page = await ctx.newPage();
    // The theme comes from localStorage only: the user-defaults file under ~ is neither read nor written.
    await page.route('**/api/user-defaults', (r) => r.fulfill({ status: 404, body: '{}' }));
    await page.goto(`${BASE}/#file=run`);
    await page.getByRole('button', { name: '플랜', exact: true }).click();
    await page.locator('[data-plan-view] [data-step="merge"]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const c = document.querySelector('.plan-canvas');
      const last = document.querySelector('[data-step="merge"]').getBoundingClientRect();
      const r = c.getBoundingClientRect();
      return { canvas: Math.round(r.width), scroll: c.scrollWidth, client: c.clientWidth, lastRight: Math.round(last.right), canvasRight: Math.round(r.right) };
    });
    console.log(theme, JSON.stringify(m));
    await page.screenshot({ path: join(out, `${prefix}-${theme}-1400.png`) });
    await ctx.close();
  }
} finally {
  await browser?.close();
  server.kill();
  rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
