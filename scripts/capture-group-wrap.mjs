// Before/after captures for the experimental group wrap (E65, #276; docs/design/flowchart-group-wrap.md).
// Headless only. Starts its own server on a free port, on a scratch workspace inside a scratch git repo in the
// temp dir, opens the sample flowchart in the canvas view at 1440x900 @2x, fits it, and saves light and dark
// pictures with the wrap off and on. Prints the fit zoom and the connector counts.
//
//   CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//     node scripts/capture-group-wrap.mjs <outdir> [fixture-name]
//
// Needs `npm run build` first (the server serves web/dist).
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderDiagram } from '../shared/render/index.ts';
import { layoutMetrics } from '../test/render/layout-metrics.ts';

const [out, name = 'flowchart-procure-to-pay'] = process.argv.slice(2);
if (!out || !process.env.CHROME || !process.env.PLAYWRIGHT_CORE) {
  console.error('usage: CHROME=... PLAYWRIGHT_CORE=... node scripts/capture-group-wrap.mjs <outdir> [fixture-name]');
  process.exit(2);
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const code = readFileSync(join(repo, 'test/dsl/fixtures', `${name}.eraser`), 'utf8');
mkdirSync(out, { recursive: true });

// A port nobody listens on: bind to 0, read the port, release it.
const port = await new Promise((ok) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});
const root = mkdtempSync(join(tmpdir(), 'draw-wrap-'));
execFileSync('git', ['init', '-q'], { cwd: root });
execFileSync('git', ['-c', 'user.name=scratch', '-c', 'user.email=scratch@example.invalid', 'commit', '--allow-empty', '-qm', 'init'], { cwd: root });
const ws = join(root, 'ws');
mkdirSync(ws);
const server = spawn(process.execPath, ['server/index.js', ws], { cwd: repo, env: { ...process.env, DRAW_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

let browser;
try {
  for (let i = 0; i < 100 && !log.includes(`workspace ${ws}`); i++) await new Promise((r) => setTimeout(r, 100));
  // Another session's server may hold a port: only go on when the log names this port and this workspace.
  if (!(log.includes(`127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`))) throw new Error(`server did not start on the scratch workspace:\n${log}`);
  const BASE = `http://127.0.0.1:${port}`;
  const call = async (method, url, body) =>
    (await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: body && JSON.stringify(body) })).json();
  // One file per capture: a block keeps the size it was first drawn at, so a shared file would carry the
  // "before" width into the "after" picture.
  const makeFile = async (path) => {
    const file = await call('POST', '/api/file', { path, title: 'flowchart' });
    await call('PUT', `/api/file?path=${path}`, {
      ...file,
      version: 2,
      blocks: [{ id: 'b1', type: 'flowchart', code, x: 0, y: 0, w: 0, h: 0 }],
      document: { type: 'doc', content: [{ type: 'diagram', attrs: { blockId: 'b1' } }, { type: 'paragraph' }] },
    });
  };

  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const rows = [];
  for (const wrap of [false, true]) {
    const metrics = layoutMetrics((await renderDiagram(code, { wrapGroups: wrap })).scene);
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      await ctx.addInitScript(
        ([t, w]) => {
          localStorage.setItem('drawing.theme', t);
          if (w) localStorage.setItem('drawing.experiment.groupWrap', '1');
        },
        [theme, wrap],
      );
      const path = `flowchart-${wrap ? 'after' : 'before'}-${theme}`;
      await makeFile(path);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/#file=${path}`);
      await page.waitForSelector('.ProseMirror', { timeout: 30000 });
      await page.getByRole('button', { name: '캔버스', exact: true }).first().click();
      await page.waitForSelector('[data-canvas] canvas', { timeout: 30000 });
      await page.waitForTimeout(2000);
      const box = await page.locator('[data-canvas]').boundingBox();
      // Give the canvas the keyboard without clicking (a click could land on the block); Shift+1 is "zoom to fit".
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.evaluate(() => document.querySelector('[data-canvas] .excalidraw-container, [data-canvas] .excalidraw')?.focus());
      await page.keyboard.press('Shift+1');
      await page.waitForTimeout(1500);
      const zoom = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => /^\d+%$/.test(t)) ?? null);
      const shot = join(out, `${wrap ? 'after' : 'before'}-${name}-${theme}.png`);
      const png = await page.screenshot({ path: shot });
      // Drawn width of the picture on screen (CSS px): the widest run of rows that differ from the canvas background,
      // between the toolbar and the zoom buttons. Against the picture's own width this is the scale text is read at.
      const drawn = await page.evaluate(
        async ({ url, box }) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          const k = img.naturalWidth / innerWidth;
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0);
          const x0 = Math.round((box.x + 8) * k);
          const y0 = Math.round((box.y + 170) * k);
          const w = Math.round((box.width - 16) * k);
          const h = Math.round((box.height - 170 - 90) * k);
          const d = g.getImageData(x0, y0, w, h).data;
          const bg = [d[0], d[1], d[2]];
          let lo = w;
          let hi = -1;
          for (let y = 0; y < h; y += 2) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 6) {
                if (x < lo) lo = x;
                if (x > hi) hi = x;
              }
            }
          }
          return hi < 0 ? 0 : (hi - lo + 1) / k;
        },
        { url: `data:image/png;base64,${png.toString('base64')}`, box },
      );
      const saved = (await call('GET', `/api/file?path=${path}`)).blocks?.[0] ?? {};
      // Groups span the picture but for its 12 px margins.
      const scale = Math.round((drawn / (metrics.width - 24)) * 100);
      rows.push({ wrap, theme, zoom, blockW: Math.round(saved.w ?? 0), drawnW: Math.round(drawn), textScale: `${scale}%`, ...metrics, shot });
      await ctx.close();
    }
  }
  console.table(rows.map(({ shot: _s, ...r }) => r));
  for (const r of rows) console.log(r.shot);
} finally {
  await browser?.close();
  server.kill();
  rmSync(root, { recursive: true, force: true });
}
