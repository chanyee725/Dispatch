// Headless check of the rest of the Dispatch screens (E29, #156): one fake Claude session reports tokens, a cost and
// a usage-limit event; then 사용량 shows today's cost, the 5-hour limit and the session in the top-10 table,
// a second session's turn still makes 사용량 refetch, 다시 불러오기 recovers a failed first load,
// 타임라인 shows the session's row, and 상시 화면 (#tv) shows its tile in the dark theme and Esc goes back.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no real
// claude, codex or agy can start. It refuses to go on unless the server log names its port and workspace.
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

test('사용량, 타임라인 and 상시 화면 show a fake session', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-usage-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-usage-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);

  const far = Math.floor(Date.now() / 1000) + 3600;
  const scenario = [
    { type: 'system', subtype: 'init', session_id: 'fake-usage-session' },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 5000 } } },
    { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.42, resetsAt: far, status: 'allowed' }, seven_day: { utilization: 0.1, resetsAt: far, status: 'allowed' } } } },
    { type: 'result', subtype: 'success', total_cost_usd: 1.25 },
  ];
  const fake = fakeCliBin({ scenario });
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
  // Each check names its step, so a failure says where it stopped (with the server log tail and a screenshot).
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

    const call = async (m, u, b) => {
      const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
      const body = await res.json();
      assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
      return body;
    };
    at('fake session');
    await call('POST', '/api/providers/claude/login');
    const { sessions } = await call('POST', '/api/sessions', { items: [{ role: 'impl', prompt: 'say ok' }], worktree: false });
    const name = sessions[0].name;
    // Wait until the fake turn's cost is counted and the session is at rest, so nothing moves under the page.
    let settled = false;
    for (let i = 0; i < 100 && !settled; i++) {
      const { days } = await call('GET', '/api/usage');
      const { sessions: list } = await call('GET', '/api/state');
      settled = days.at(-1).cost > 0 && list.find((s) => s.name === name)?.state === 'resting';
      if (!settled) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(settled, 'the fake turn should finish with its cost counted');

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
    const errors = [];
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    let usageFetches = 0;
    page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/usage') usageFetches++; });

    at('사용량');
    await page.goto(`${BASE}/dispatch#usage`);
    const nav = page.getByRole('navigation', { name: '세션 보드 화면' });
    await nav.getByRole('link', { name: '사용량' }).and(page.locator('[aria-current="page"]')).waitFor();
    await page.getByText('$1.25').first().waitFor();
    await page.locator('[data-limit="5시간"]').getByText('42%').waitFor();
    await page.locator(`[data-session="${name}"]`).waitFor();
    assert.ok(await page.getByRole('columnheader', { name: '모델' }).first().isVisible());
    // Cost shares are neutral bars: the only session holds 100% of the cost, which must not read as a limit warning.
    const shares = page.locator('[aria-label$="비용 비율"]');
    assert.ok(await shares.count() >= 1, 'at least one cost share bar');
    for (const tone of await shares.evaluateAll((els) => els.map((e) => e.getAttribute('data-tone')))) assert.equal(tone, 'neutral');
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e29-usage.png'), fullPage: true });
    // Session events that don't move the cost total (the snapshot, state pushes) don't refetch /api/usage.
    await page.waitForTimeout(2500);
    assert.equal(usageFetches, 1, 'one /api/usage request while the cost total stays the same');

    // A second session's turn changes the totals, so the page refetches /api/usage.
    at('second session refetch');
    const { sessions: second } = await call('POST', '/api/sessions', { items: [{ role: 'impl', prompt: 'say ok' }], worktree: false });
    for (let i = 0; i < 100 && usageFetches < 2; i++) await page.waitForTimeout(100);
    assert.ok(usageFetches >= 2, `a usage change should refetch /api/usage (requests: ${usageFetches})`);
    await page.locator(`[data-session="${second[0].name}"]`).waitFor();

    at('타임라인');
    await nav.getByRole('link', { name: '타임라인' }).click();
    assert.equal(new URL(page.url()).hash, '#board=timeline'); // board hashes since the project nav (legacy #timeline still opens it)
    const row = page.locator(`[data-row="${name}"]`);
    await row.waitFor();
    assert.match(await row.getAttribute('aria-label'), new RegExp(`^${name}, 지금 `));
    await row.locator('[data-span]').first().waitFor(); // at least one state span
    // A finished fake turn leaves the session resting; its bar is drawn solid so it stays visible on the track.
    const resting = row.locator('[data-span="resting"] > span');
    if (await resting.count()) assert.equal(await resting.first().evaluate((e) => getComputedStyle(e).opacity), '1');
    // The 실패한 순간 legend mark uses the failure colour token in both themes (a missing token renders it transparent).
    const legend = page.locator('[data-legend="failed"]');
    const themeAtStart = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((th) => (document.documentElement.dataset.theme = th), theme);
      const bg = await legend.evaluate((e) => getComputedStyle(e).backgroundColor);
      assert.ok(!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg) && !/\/ 0\)$/.test(bg), `legend mark is transparent in ${theme}: ${bg}`);
    }
    await page.evaluate((th) => (th ? (document.documentElement.dataset.theme = th) : delete document.documentElement.dataset.theme), themeAtStart);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e29-timeline.png') });
    // Forced colors drop the bar backgrounds; a system-colour border keeps each mark visible.
    await page.emulateMedia({ forcedColors: 'active' });
    for (const mark of [row.locator('[data-span] > span').first(), legend]) {
      const b = await mark.evaluate((e) => { const c = getComputedStyle(e); return { style: c.borderLeftStyle, width: parseFloat(c.borderLeftWidth), color: c.borderLeftColor }; });
      assert.ok(b.style !== 'none' && b.width > 0, `mark has no border in forced colors: ${JSON.stringify(b)}`);
      // Preflight already makes the style solid, so also check that a system colour (not transparent) is set.
      assert.ok(!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(b.color), `mark border is transparent in forced colors: ${JSON.stringify(b)}`);
    }
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e29-timeline-forced.png') });
    await page.emulateMedia({ forcedColors: 'none' });

    // 상시 화면: dark, a tile per session, Esc goes back to the board.
    at('상시 화면');
    const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
    // 2026-11-20: 상시 화면 left the board's ⋯ menu; its address still opens it.
    await page.evaluate(() => { location.hash = '#board=tv'; });
    await page.locator('[data-always-on]').waitFor();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.locator(`[data-tile="${name}"]`).waitFor();
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e29-always-on.png') });
    await page.keyboard.press('Escape');
    await page.locator('[data-always-on]').waitFor({ state: 'detached' });
    assert.equal(new URL(page.url()).hash, '#board=timeline');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), themeBefore);
    at('상시 화면 from its address');
    await page.goto(`${BASE}/dispatch#board=tv`);
    await page.locator(`[data-tile="${name}"]`).waitFor(); // #board=tv opens it straight away
    await page.keyboard.press('Escape');
    await page.locator('[data-always-on]').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), themeBefore);

    // A tile opens the session sheet on the board.
    at('tile opens the sheet');
    await page.goto(`${BASE}/dispatch#tv`);
    await page.locator(`[data-tile="${name}"]`).click();
    await page.locator('[data-always-on]').waitFor({ state: 'detached' });
    await page.getByRole('dialog').waitFor();

    // A failed first load shows the error; 다시 불러오기 loads the page once the server answers again.
    at('reload after a failed first load');
    const failing = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    failing.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    await failing.route('**/api/usage', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"테스트 실패"}' }));
    await failing.goto(`${BASE}/dispatch#usage`);
    const alert = failing.getByRole('alert').filter({ hasText: '사용량을 불러오지 못했어요' });
    await alert.waitFor();
    await failing.unroute('**/api/usage');
    await alert.getByRole('button', { name: '다시 불러오기' }).click();
    await failing.getByText('$1.25').first().waitFor();
    assert.equal(await alert.count(), 0);
    await failing.close();

    // Session events keep coming: each POST runs one more fake turn (state pushes, cost and token changes).
    const sessionId = sessions[0].id;
    const churn = async (ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        await fetch(`${BASE}/api/sessions/${sessionId}/message`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: '{"text":"say ok"}' }).catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
      }
    };

    // #334: while the first load keeps failing, session events retry at most once per 2 s.
    at('retries stay 2 s apart while the first load fails');
    const retrying = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    retrying.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    const tries = [];
    await retrying.route('**/api/usage', (r) => { tries.push(Date.now()); return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"테스트 실패"}' }); });
    await retrying.goto(`${BASE}/dispatch#usage`);
    await retrying.getByRole('alert').filter({ hasText: '사용량을 불러오지 못했어요' }).waitFor();
    await churn(6500);
    assert.ok(tries.length >= 3, `session events should retry the failed load (tries: ${tries.length})`);
    for (let i = 1; i < tries.length; i++) assert.ok(tries[i] - tries[i - 1] >= 1900, `tries ${i - 1} and ${i} are ${tries[i] - tries[i - 1]} ms apart`);

    // #334: a slow answer that is out while session events come in is still applied, not dropped and asked again.
    // No wall-clock waits: the first request is held until the server has counted the session events, and any later
    // request is never answered, so the page can only show the numbers if the held answer was applied.
    at('a slow answer survives session events');
    await retrying.unroute('**/api/usage');
    const slow = [];
    let release;
    const held = new Promise((ok) => (release = ok));
    await retrying.route('**/api/usage', async (r) => {
      slow.push(Date.now());
      if (slow.length > 1) return; // never answered
      await held;
      await r.continue();
    });
    // One fake turn at a time until the page sends its retry (spaced 2 s after the last failed try).
    const progress = async () => {
      const s = (await call('GET', '/api/state')).sessions.find((x) => x.id === sessionId);
      return { out: s.turns, resting: s.state === 'resting' };
    };
    const turn = async () => {
      const before = (await progress()).out;
      await call('POST', `/api/sessions/${sessionId}/message`, { text: 'say ok' });
      for (let i = 0; i < 200; i++) {
        const now = await progress();
        if (now.out > before && now.resting) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.fail('the fake turn did not finish');
    };
    const giveUp = Date.now() + 30_000; // only a bound for a broken page; the loop ends on the request
    while (slow.length === 0 && Date.now() < giveUp) await turn();
    assert.equal(slow.length, 1, `session events should send one retry (requests: ${slow.length})`);
    // Two more finished turns (cost and state events) while it is out, then the answer.
    await turn();
    await turn();
    release();
    await retrying.getByText('캐시 적중률').waitFor();
    assert.equal(await retrying.getByRole('alert').filter({ hasText: '사용량을 불러오지 못했어요' }).count(), 0);
    await retrying.close();

    assert.deepEqual(errors, []);
  } catch (e) {
    const shot = join(tmpdir(), `dispatch-usage-fail-${Date.now()}.png`);
    await page?.screenshot({ path: shot, fullPage: true }).catch(() => {});
    throw new Error(`[step: ${step}] ${e.message}\nscreenshot: ${shot}\nserver log tail:\n${log.slice(-1500)}`, { cause: e });
  }
});
