// Records the README demo video headlessly with the real Claude CLI: a lead gets one line ("PLC에서 데이터를 받아온 뒤
// 로봇을 움직이는 웹 페이지를 만들어야 해."), makes a teammate who draws the architecture and flow diagrams, writes the
// plan (requirements, test conditions, steps), and the video ends on the plan just before 시작하기. Nothing is built.
//
//   npm run build
//   CHROME=/path/to/chrome PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/record-demo.mjs [outDir]
//
// outDir defaults to docs/images; it gets demo.mp4 (H.264, 1280×800, 30–120 s) and demo-poster.png. PLAYWRIGHT_CORE
// must match a Playwright ffmpeg build in ~/.cache/ms-playwright (recordVideo needs it); the system ffmpeg cuts and
// speeds up the raw video. DEMO_SHOTS=<dir> also saves a screenshot per scene. DEMO_FAKE=1 runs the same screens with
// the fake CLI from test/fixtures (no agent work, no cost) to check the script itself.
//
// Real CLI (allowed for this demo only, #1040): `claude` must be logged in. Lead and teammate run claude-sonnet-5-5,
// only plan, docs and diagrams; every session is removed at the end. The server runs on a free port (never 4000/4001)
// against a scratch git project (one commit) under the temp dir, and refuses to go on unless its own log names that
// port and workspace. HOME stays the real one so the CLI finds its login; DRAWING_USER_DEFAULTS=off keeps personal
// app defaults out. The page masks the home path, user name, git name and email before they paint, and the run
// fails if any of them is still on screen.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeCliBin } from '../test/fixtures/fake-cli/index.mjs';
import { which } from '../server/dispatch/cli.js';

const { CHROME, PLAYWRIGHT_CORE } = process.env;
if (!CHROME || !PLAYWRIGHT_CORE) {
  console.error('set CHROME and PLAYWRIGHT_CORE (see the header of this file)');
  process.exit(2);
}
const FAKE = process.env.DEMO_FAKE === '1';
const outDir = resolve(process.argv[2] ?? 'docs/images');
const SHOTS = process.env.DEMO_SHOTS; // optional folder for scene screenshots
const W = 1440;
const H = 900; // 16:10, scaled to 1280×800 in the MP4
const MODEL = 'claude-sonnet-5-5';
const MIN_SECONDS = 40; // final length; fast segments speed up or slow down (never below 1×) to land in between
const MAX_SECONDS = 110;
const ASK = 'PLC에서 데이터를 받아온 뒤 로봇을 움직이는 웹 페이지를 만들어야 해.';
// Appended (not typed) to the visible one-liner: keeps the real run to planning only and in this order.
const RULES = [
  '',
  '(데모 실행) 구현은 하지 말고 계획까지만 해요.',
  `1) 먼저 create_sessions로 문서화 팀원 1명(model "${MODEL}")을 만들어 "아키텍처" 문서를 쓰게 해요: PLC → 게이트웨이 → 서버 → 웹 → 로봇 컨트롤러 아키텍처 다이어그램 하나와 명령 흐름도 하나(atelier-diagram 스킬).`,
  '2) 그다음 write_plan으로 계획(목표, 단계(구현·리뷰), 위험)을 써요.',
  '3) 이어서 atelier-doc 스킬로 그 계획 문서의 목표 아래에 "요구사항"과 "테스트 조건"(PLC 연결 끊김, 값 범위 밖, 로봇 정지 명령, 지연) 섹션을 넣어요. 단계 다이어그램 블록과 단계 목록은 건드리지 않아요.',
  '4) 계획 경로 한 줄로 턴을 끝내요. 시작하기는 누르지 않아요.',
].join('\n');

const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = (f) => { try { return f(); } catch { return ''; } };

// Strings that must never reach the screen. Collected here, never printed or written anywhere.
const SECRETS = [
  homedir(),
  userInfo().username,
  quiet(() => execFileSync('git', ['config', 'user.email']).toString().trim()),
  quiet(() => execFileSync('git', ['config', 'user.name']).toString().trim()),
].filter((s) => s && s.length >= 3);

// A scratch project under the temp dir with a neutral name and one commit.
const scratch = mkdtempSync(join(tmpdir(), 'demo-'));
const repo = join(scratch, 'plc-robot-console');
for (const d of ['gateway', 'server', 'web']) mkdirSync(join(repo, d), { recursive: true });
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'demo', GIT_AUTHOR_EMAIL: 'demo@example.invalid', GIT_COMMITTER_NAME: 'demo', GIT_COMMITTER_EMAIL: 'demo@example.invalid' };
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: gitEnv });
git('init', '-q', '-b', 'develop');
writeFileSync(join(repo, 'README.md'), '# plc-robot-console\n\nPLC 값을 받아 로봇 컨트롤러에 명령을 보내는 웹 콘솔.\n');
writeFileSync(join(repo, 'gateway', 'README.md'), '# gateway\n\nPLC(Modbus TCP)에서 값을 읽어 서버로 보낸다.\n');
writeFileSync(join(repo, 'server', 'README.md'), '# server\n\n게이트웨이 값을 받아 웹으로 내보내고 로봇 명령을 중계한다.\n');
writeFileSync(join(repo, 'web', 'README.md'), '# web\n\n운전 화면: PLC 값, 로봇 상태, 명령 버튼.\n');
writeFileSync(join(repo, '.gitignore'), '.atelier/\n');
git('add', '.');
git('commit', '-qm', 'init');
const ws = join(repo, 'workspace');
mkdirSync(ws);

let fake = null;
let gate = null;
if (FAKE) {
  gate = join(scratch, 'gate-end');
  fake = fakeCliBin({
    scenario: [
      { type: 'system', subtype: 'init', session_id: 'fake-demo' },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: '계획을 세우는 중이에요' }], usage: { input_tokens: 1, output_tokens: 1 } } },
      { $waitFor: gate },
      { type: 'result', subtype: 'success', total_cost_usd: 0.001 },
    ],
  });
}
const port = await freePort();
if (port === 4000 || port === 4001) throw new Error('refusing the preview ports');
const env = FAKE
  ? { HOME: scratch, DRAW_PORT: String(port), ...fake.env, PATH: `${fake.dir}:${dirname(which('git'))}` }
  : { ...process.env, DRAW_PORT: String(port), DRAWING_USER_DEFAULTS: 'off' };
// When this script runs from inside an agent session, its Atelier and Claude Code variables (session ids, the
// parent server's URL, messaging sockets) must not reach the demo server or its sessions.
for (const k of Object.keys(env)) if (/^(DISPATCH_|DRAWING_SESSION|CLAUDE_CODE_|CLAUDECODE$|CLAUDE_PID$|CLAUDE_EFFORT$)/.test(k)) delete env[k];
const server = spawn(process.execPath, ['server/index.js', ws], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
const BASE = `http://127.0.0.1:${port}`;
let browser;
const call = async (m, u, b) => {
  const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${m} ${u}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};
const sessions = async () => (await call('GET', '/api/state')).sessions ?? [];
const cleanup = async () => {
  // Every session goes, idle or not (#1040: clean up when done).
  for (const s of await sessions().catch(() => [])) await call('POST', `/api/sessions/${s.id}/remove`, {}).catch(() => {});
  if (gate) writeFileSync(gate, '');
  await browser?.close().catch(() => {});
  // Wait for the server to exit: it saves its state on SIGTERM, which would otherwise land after the rm below.
  await new Promise((r) => (server.exitCode !== null ? r() : (server.once('exit', r), server.kill(), setTimeout(r, 5000))));
  fake?.cleanup();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};

/** Every *.dpx.json path in the workspace tree. */
const files = async () => {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (typeof n.path === 'string' && n.path.endsWith('.dpx.json')) out.push(n.path);
    Object.values(n).forEach(walk);
  };
  walk((await call('GET', '/api/tree')).tree);
  return [...new Set(out)];
};
const isPlan = (p) => /(^|\/)계획(-\d+)?\.dpx\.json$/.test(p);
/** Polls `f` until it returns something truthy or `ms` pass; returns the value or null. */
const until = async (f, ms, every = 1500) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await f().catch(() => null);
    if (v) return v;
    await sleep(every);
  }
  return null;
};

try {
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await sleep(100);
  if (!(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`))) throw new Error('unexpected server log (port or workspace not named)');
  await call('POST', '/api/providers/claude/login');
  const prov = (await call('GET', '/api/state')).providers?.claude;
  if (!prov?.connected) throw new Error('Claude is not connected: log the claude CLI in first');

  const { chromium } = await import(pathToFileURL(join(PLAYWRIGHT_CORE, 'index.mjs')).href);
  browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: join(scratch, 'video'), size: { width: W, height: H } } });
  await ctx.addInitScript(() => localStorage.setItem('drawing.theme', 'dark'));
  // Masks private strings in text and attributes before the browser paints them.
  await ctx.addInitScript((secrets) => {
    const subs = secrets.map((s, i) => [s, i === 0 ? '~' : 'user']);
    const fix = (v) => subs.reduce((acc, [s, r]) => (acc.includes(s) ? acc.split(s).join(r) : acc), v);
    const fixNode = (n) => {
      if (n.nodeType === 3) {
        const v = fix(n.data);
        if (v !== n.data) n.data = v;
      } else if (n.nodeType === 1) {
        for (const a of ['title', 'aria-label', 'placeholder', 'value']) {
          const v = n.getAttribute?.(a);
          if (v && fix(v) !== v) n.setAttribute(a, fix(v));
        }
        n.childNodes.forEach(fixNode);
      }
    };
    new MutationObserver((ms) => ms.forEach((m) => (m.type === 'characterData' ? fixNode(m.target) : m.type === 'attributes' ? fixNode(m.target) : m.addedNodes.forEach(fixNode))))
      .observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder', 'value'] });
  }, SECRETS);
  const page = await ctx.newPage();
  const t0 = Date.now();
  // Segments of the raw video and how fast each plays in the MP4.
  const marks = [];
  const mark = (speed) => marks.push({ at: (Date.now() - t0) / 1000, speed });
  let n = 0;
  const leaked = async () => {
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    return SECRETS.some((s) => text.includes(s));
  };
  const shot = async (name) => {
    if (await leaked()) throw new Error(`private text on screen at scene ${name}`);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`) });
    }
  };
  const open = async (path) => {
    await page.evaluate((h) => (location.hash = h), `#file=${encodeURIComponent(path)}`);
    await page.locator('.ProseMirror').first().waitFor({ timeout: 15000 }).catch(() => {});
  };

  // 1. Session board, empty → 새 세션 → the one-line ask, lead only, Sonnet.
  mark(1);
  await page.goto(`${BASE}/dispatch`);
  await page.getByRole('button', { name: /새 세션/ }).first().waitFor({ timeout: 15000 });
  await sleep(1200);
  await page.getByRole('button', { name: /새 세션/ }).first().click();
  const dialog = page.locator('dialog[open]');
  const prompt = dialog.getByLabel('공통 프롬프트');
  await prompt.click();
  await page.keyboard.type(ASK, { delay: 60 });
  await sleep(500);
  while ((await dialog.getByRole('button', { name: '이 줄 지우기' }).count()) > 1) {
    await dialog.getByRole('button', { name: '이 줄 지우기' }).last().click();
    await sleep(300);
  }
  await dialog.getByLabel('모델').first().selectOption(MODEL).catch(() => {});
  await prompt.fill(ASK + '\n' + RULES);
  await prompt.evaluate((el) => (el.scrollTop = 0));
  await sleep(800);
  await shot('ask');
  await dialog.getByRole('button', { name: /세션 1개 시작/ }).click();
  await dialog.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});

  // 2. The lead starts and makes its teammate.
  mark(1);
  await sleep(3000);
  mark(20);
  const lead = (await sessions())[0];
  const team = await until(async () => ((await sessions()).length >= 2 ? true : null), FAKE ? 5000 : 5 * 60_000);
  mark(1);
  await sleep(2500);
  await shot('team');

  // 3. The teammate's diagram document grows live (agent cursor, #1039).
  mark(25);
  if (FAKE) {
    // Stand-ins for what the agents write, so the document scenes run too.
    await call('POST', '/api/file', { path: '제어/아키텍처', title: '아키텍처' });
    await call('POST', '/api/file', { path: '제어/계획', title: '계획' });
  }
  const diagramDoc = await until(async () => (await files()).find((p) => !isPlan(p)), FAKE ? 3000 : 6 * 60_000);
  if (diagramDoc) {
    await open(diagramDoc);
    mark(8);
    // Stay while it grows, until the teammate is done (idle, or removed after its report).
    await until(async () => ((await sessions()).filter((s) => s.id !== lead?.id).every((s) => s.status === 'idle') ? true : null), FAKE ? 3000 : 8 * 60_000);
    mark(1);
    await sleep(1500);
    await shot('diagram');
  }

  // 4. The plan: requirements, test conditions, steps; the lead ends its turn; we stop just before 시작하기.
  mark(25);
  const planDoc = await until(async () => (await files()).find(isPlan), FAKE ? 3000 : 8 * 60_000);
  if (planDoc) {
    await open(planDoc);
    mark(8);
    await until(async () => ((await sessions()).find((s) => s.id === lead?.id)?.status === 'idle' ? true : null), FAKE ? 3000 : 6 * 60_000);
    mark(1);
    await sleep(1500);
    await shot('plan');
    const scroller = page.locator('.ProseMirror').first();
    for (let i = 0; i < 6; i++) {
      await scroller.evaluate((el) => (el.closest('[data-doc-scroll], main, .overflow-auto') ?? document.scrollingElement).scrollBy({ top: 320, behavior: 'smooth' })).catch(() => {});
      await sleep(900);
    }
    const startBtn = page.getByRole('button', { name: /시작하기/ }).first();
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.hover(); // never clicked: the demo ends before the run
      await sleep(2500);
    }
    await shot('before-start');
  }
  if (!team || !diagramDoc || !planDoc) console.error(`scenes missing: team=${!!team} diagram=${!!diagramDoc} plan=${!!planDoc}`);
  mark(0); // end

  const video = page.video();
  await ctx.close();
  const raw = await video.path();
  mkdirSync(outDir, { recursive: true });

  // Segments → durations; fast ones (speed > 1) scale by k so the whole lands in MIN_SECONDS..MAX_SECONDS.
  const segs = marks.slice(0, -1).map((m, i) => ({ from: m.at, to: marks[i + 1].at, speed: m.speed })).filter((s) => s.to - s.from > 0.05);
  const rate = (s, k) => (s.speed > 1 ? Math.max(1, s.speed * k) : s.speed);
  const len = (k) => segs.reduce((a, s) => a + (s.to - s.from) / rate(s, k), 0);
  let k = 1;
  while (len(k) > MAX_SECONDS && k < 200) k *= 1.1;
  while (len(k) < MIN_SECONDS && k > 0.01) k /= 1.1;
  const filter = segs
    .map((s, i) => `[0:v]trim=start=${s.from.toFixed(3)}:end=${s.to.toFixed(3)},setpts=(PTS-STARTPTS)/${rate(s, k).toFixed(3)}[v${i}]`)
    .join(';') + `;${segs.map((_, i) => `[v${i}]`).join('')}concat=n=${segs.length}:v=1:a=0,fps=30,scale=1280:800:flags=lanczos[out]`;
  const mp4 = join(outDir, 'demo.mp4');
  const poster = join(outDir, 'demo-poster.png');
  const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
  ff('-i', raw, '-filter_complex', filter, '-map', '[out]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
  ff('-sseof', '-2', '-i', mp4, '-frames:v', '1', '-update', '1', poster);
  console.log(`${mp4} ${(statSync(mp4).size / 1024 / 1024).toFixed(2)} MB, ~${len(k).toFixed(0)} s, raw ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} catch (e) {
  console.error(String(e?.stack ?? e).slice(0, 2000));
  process.exitCode = 1;
} finally {
  await cleanup();
}
