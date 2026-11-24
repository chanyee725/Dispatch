// Usage: node shoot.mjs <repo-root> <label: before|after> [outdir]
// Scratch git repo + workspace in a temp dir, fake CLIs on PATH, free port, headless 1280x800 둘 다 보기.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [repoRoot, label = 'before', outDir = '/tmp/e714-shots'] = process.argv.slice(2);
const CHROME = process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell`;
const PW = process.env.PLAYWRIGHT_CORE || '/tmp/org943-shot/node_modules/playwright-core';
const { chromium } = await import(pathToFileURL(join(PW, 'index.mjs')).href);
const { fakeCliBin } = await import(pathToFileURL(join(repoRoot, 'test/fixtures/fake-cli/index.mjs')).href);
const { which } = await import(pathToFileURL(join(repoRoot, 'server/dispatch/cli.js')).href);
const port = await new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
if (port === 4000 || port === 4001) throw new Error('preview port');
const repo = mkdtempSync(join(tmpdir(), 'e714-repo-'));
const home = mkdtempSync(join(tmpdir(), 'e714-home-'));
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
git('init', '-q'); writeFileSync(join(repo, 'README'), 'scratch\n'); git('add', '.'); git('commit', '-qm', 'init');
const ws = join(repo, 'ws'); mkdirSync(ws);
const fake = fakeCliBin({ scenario: [{ type: 'system', subtype: 'init', session_id: 'x' }, { type: 'result', subtype: 'success', total_cost_usd: 0 }] });
const PATH = `${fake.dir}:${dirname(which('git'))}`;
const server = spawn(process.execPath, ['server/index.js', ws], { cwd: repoRoot, env: { PATH, HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', ...fake.env, PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
const cleanup = async () => { server.kill(); await new Promise((r) => setTimeout(r, 500)); fake.cleanup(); rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); rmSync(home, { recursive: true, force: true }); };
try {
  for (let i = 0; i < 100 && !log.includes(`workspace ${ws}`); i++) await new Promise((r) => setTimeout(r, 100));
  if (!log.includes(`http://127.0.0.1:${port}/`) || !log.includes(`workspace ${ws}`)) throw new Error('unexpected server log: ' + log);
  console.log(`server ok: port ${port}, workspace ${ws}`);
  const BASE = `http://127.0.0.1:${port}`;
  const call = async (m, u, b, sess) => { const r = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1', ...(sess ? { 'x-drawing-session': sess } : {}) }, body: b && JSON.stringify(b) }); return r.json(); };
  const CODE = [
    'PLC [icon: cpu] > Gateway [icon: server]',
    'Gateway > Server [icon: aws-ec2]',
    'Server > Web [icon: monitor]',
    'Web > Robot controller [icon: tool]',
    'Server > Database [icon: database]',
    'Robot controller > Safety relay [icon: shield]',
  ].join('\n');
  const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const f = await call('POST', '/api/file', { path: 'demo', title: 'demo' });
  const doc = (withDiagram) => ({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '아키텍처' }] }, para('PLC에서 로봇까지 명령이 흐르는 구조예요.'), ...(withDiagram ? [{ type: 'diagram', attrs: { blockId: 'b1' } }] : []), para('위 그림 아래에 이어 쓰는 글이에요.')] });
  const blocks = [{ id: 'b1', type: 'architecture', code: CODE, x: 0, y: 0, w: 0, h: 0 }];
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const shot = (n) => page.screenshot({ path: join(outDir, `${label}-${n}.png`) });
  // Scene A: the diagram arrives while the page is open (an agent writing it): first fit + live update.
  await page.goto(`${BASE}/#file=demo.dpx.json`);
  await page.waitForSelector('.doc-editor', { timeout: 30000 });
  console.log('put1', JSON.stringify(await call('PUT', '/api/file?path=demo', { ...f, version: 2, document: doc(false), blocks: [] })).slice(0,200));
  await page.waitForTimeout(1500);
  const pr = await call('PUT', '/api/file?path=demo', { ...f, version: 2, revision: 2, document: doc(true), blocks }); console.log('put2', JSON.stringify(pr).slice(0,200));
  await page.waitForSelector('figure.doc-diagram img, .doc-diagram-pic img', { timeout: 20000 }).catch(() => console.log('no doc diagram img'));
  await page.waitForTimeout(3500);
  await shot('1-live-both');
  // Scene B: fresh load of the same file, 둘 다 보기: canvas first fit and the document side's right edge.
  await page.reload();
  await page.waitForSelector('.excalidraw', { timeout: 30000 });
  await page.waitForTimeout(4000);
  await shot('2-reload-both');
  const m = await page.evaluate(() => {
    const fig = document.querySelector('figure.doc-diagram'); const sc = fig?.querySelector('.doc-diagram-pic, [class*=scroll]') || fig;
    const img = fig?.querySelector('img'); const pane = document.querySelector('.doc-editor')?.getBoundingClientRect();
    const r = (e) => e && (({ left, right, width }) => ({ left: Math.round(left), right: Math.round(right), width: Math.round(width) }))(e.getBoundingClientRect());
    return { pane: pane && { right: Math.round(pane.right), width: Math.round(pane.width) }, figure: r(fig), scroller: sc && { ...r(sc), scrollW: sc.scrollWidth, clientW: sc.clientWidth, overflowX: getComputedStyle(sc).overflowX }, img: r(img), canvasBox: r(document.querySelector('.excalidraw')) };
  });
  console.log(label, JSON.stringify(m));
  console.log('stage', JSON.stringify(await page.evaluate(() => { const s = document.querySelector('.doc-diagram-stage'); const b = document.querySelector('.doc-diagram-bar'); return s && { scrollW: s.scrollWidth, clientW: s.clientWidth, wide: s.hasAttribute('data-wide'), bar: b ? getComputedStyle(b).display : null }; })));

  // Scene C/D: nodes with code references (</> badge), then written one node at a time (mid-write).
  const put = async (code) => { const cur = await call('GET', '/api/file?path=demo'); return call('PUT', '/api/file?path=demo', { ...cur, document: doc(true), blocks: [{ id: 'b1', type: 'architecture', code, x: 0, y: 0, w: 0, h: 0 }] }); };
  const N = [
    'PLC [icon: cpu, code: "gateway/plc.js:1-20#read"]',
    'Gateway [icon: server, code: "gateway/index.js:1-40#main"]',
    'Server [icon: aws-ec2, code: "server/index.js:1-50#start"]',
    'Web [icon: monitor, code: "web/app.js:1-30#App"]',
    'Robot controller [icon: tool, code: "server/robot.js:1-60#send"]',
    'Database [icon: database, code: "server/db.js:1-20#open"]',
  ];
  const E = ['PLC > Gateway', 'Gateway > Server', 'Server > Web', 'Web > Robot controller', 'Server > Database'];
  await put(N.map((n, i) => n + '\n').join('') + E.join('\n'));
  await page.waitForTimeout(4500);
  await shot('3-code-badge-both');
  await put(N[0]); await page.waitForTimeout(2500);
  for (let k = 2; k <= 4; k++) { await put(N.slice(0, k).join('\n') + '\n' + E.slice(0, k - 1).join('\n')); await page.waitForTimeout(900); }
  await page.waitForTimeout(600);
  await shot('4-midwrite-both');
  console.log('badges', await page.locator('[data-code-badge]').count());
  await page.evaluate(() => { window.__cur = []; const es = new EventSource('/api/events'); es.addEventListener('cursor', (e) => window.__cur.push(Date.now() + ' ' + e.data.slice(0, 160))); });
  await page.waitForTimeout(500);
  // Scene E: a named session writes the diagram, then a line of text 0.6 s later: the caret should stay on the block.
  await page.reload();
  await page.waitForSelector('.excalidraw', { timeout: 30000 });
  await page.waitForTimeout(5000);
  const cur = await call('GET', '/api/file?path=demo');
  const code2 = N.map((n) => n + '\n').join('') + E.join('\n') + '\nRobot controller > Safety relay [icon: shield]';
  console.log('cput1', JSON.stringify(await call('PUT', '/api/file?path=demo', { ...cur, document: doc(true), blocks: [{ ...cur.blocks[0], code: code2 }] }, 'tester')).slice(0, 120));
  await page.waitForTimeout(600);
  const cur2 = await call('GET', '/api/file?path=demo');
  const d2 = doc(true); d2.content[3] = para('위 그림 아래에 이어 쓰는 글이에요. 안전 릴레이를 더했어요.');
  console.log('cput2', JSON.stringify(await call('PUT', '/api/file?path=demo', { ...cur2, document: d2 }, 'tester')).slice(0, 120));
  const samples = [];
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(300); if (i === 3) await shot('5-caret-held-both'); samples.push(await page.evaluate(() => [...document.querySelectorAll('[data-doc-agent-cursor]')].map((e) => Math.round(e.getBoundingClientRect().top)).join('/'))); }
  console.log('events', JSON.stringify(await page.evaluate(() => window.__cur)));
  console.log('caret samples (every 300ms)', samples.join(' '));
  console.log('caret', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-doc-agent-cursor]')].map((e) => { const r = e.getBoundingClientRect(); return { cls: e.className, top: Math.round(r.top), left: Math.round(r.left) }; }))));
  console.log('figure', JSON.stringify(await page.evaluate(() => { const r = document.querySelector('figure.doc-diagram').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; })));
  console.log('page errors:', JSON.stringify(errors));
  await browser.close();
} finally { await cleanup(); }
