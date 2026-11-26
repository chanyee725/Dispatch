// Headless checks of the 작업 보드 dashboard and full board.
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

const options = { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 };

async function withBoard(t, run) {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-board-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-board-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  mkdirSync(join(ws, 'alpha'));
  mkdirSync(join(ws, 'beta'));

  const fake = fakeCliBin({ scenario: [{ type: 'system', subtype: 'init', session_id: 'fake-board' }, { type: 'result', subtype: 'success' }] });
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
    const call = async (m, u, b) => {
      const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
      const body = await res.json();
      assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
      return body;
    };

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
    const errors = [];
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    await run({ at, call, page, BASE });
    assert.deepEqual(errors, []);
  } catch (e) {
    const shot = join(tmpdir(), `dispatch-board-fail-${Date.now()}.png`);
    await page?.screenshot({ path: shot, fullPage: true }).catch(() => {});
    throw new Error(`[step: ${step}] ${e.message}\nscreenshot: ${shot}\nserver log tail:\n${log.slice(-1500)}`, { cause: e });
  }
}

test('right task card shows live ETA beside the owner', options, (t) =>
  withBoard(t, async ({ at, call, page, BASE }) => {
    at('seed right-card tasks');
    const add = (body) => call('POST', '/api/tasks', body);
    const active = await add({ title: '진행 작업', stage: 'impl', owner: '구현자', eta_minutes: 4 });
    const missing = await add({ title: '미등록 작업', stage: 'review' });
    const finished = await add({ title: '완료 작업', stage: 'impl', owner: '검토자', eta_minutes: 4 });
    await add({ id: finished.id, stage: 'done' });
    await page.clock.install({ time: active.etaAt - 4 * 60_000 + 5_000 });
    await page.goto(`${BASE}/dispatch`);

    at('right-card ETA and adjacent owner');
    const card = page.locator('[data-card="tasks"]');
    const rowFor = ({ id }) => card.locator(`[data-row="${id}"]`);
    const row = rowFor(active);
    const eta = row.locator('[data-eta]');
    await eta.filter({ hasText: /^3분 남음$/ }).waitFor();
    const owner = row.getByText('구현자', { exact: true });
    assert.equal(await owner.count(), 1, 'the assigned owner is visible');
    const [etaBox, ownerBox] = await Promise.all([eta.boundingBox(), owner.boundingBox()]);
    assert.ok(etaBox && ownerBox, 'ETA and owner are visible');
    assert.equal(ownerBox.y, etaBox.y, 'ETA and owner share a line');
    assert.ok(ownerBox.x >= etaBox.x + etaBox.width && ownerBox.x - etaBox.x - etaBox.width <= 12,
      'owner appears immediately to the right of the ETA');
    assert.equal(await rowFor(missing).locator('[data-eta]').innerText(), 'ETA 미추정');
    assert.equal(await rowFor(missing).getByText('맡은 사람 없음', { exact: true }).count(), 1);

    at('completed task row');
    await card.getByRole('button', { name: '완료 1개' }).click();
    assert.equal(await rowFor(finished).locator('[data-eta]').innerText(), '완료');
    assert.equal(await rowFor(finished).getByText('검토자', { exact: true }).count(), 1);

    at('deadline crosses without a server update');
    await page.clock.fastForward(5 * 60_000);
    await eta.filter({ hasText: /^1분 지남$/ }).waitFor();
    assert.equal(await owner.count(), 1);
    if (SHOTS) await card.screenshot({ path: join(SHOTS, 'task-board-dashboard.png') });
  }));

test('작업 보드 shows tasks by stage and follows live changes', options, (t) =>
  withBoard(t, async ({ at, call, page, BASE }) => {
    at('seed tasks');
    const makeLead = async (folder) => (await call('POST', '/api/sessions', {
      items: [{ role: 'lead', provider: 'claude', task: 'check the board' }], worktree: false, folder,
    })).sessions[0];
    const lead = await makeLead('alpha');
    const task = await call('POST', '/api/tasks', { lead: lead.id, title: '로그인 화면 만들기', stage: 'impl', owner: 'Ivy', eta_minutes: 4 });
    await call('POST', '/api/tasks', { title: '결제 검토', stage: 'review', owner: 'Rae' });
    await call('POST', '/api/tasks', { title: '배포 막힘', stage: 'blocked', note: '키가 없어요' });

    await page.clock.install({ time: task.etaAt - 4 * 60_000 + 5_000 });
    await page.goto(`${BASE}/dispatch`);

    const row = page.locator(`[data-row="${task.id}"]`);
    const rowEta = row.locator('[data-eta]');
    await rowEta.filter({ hasText: /^3분 남음$/ }).waitFor();
    await page.clock.fastForward(60_000);
    await rowEta.filter({ hasText: /^2분 남음$/ }).waitFor();

    at('open the board');
    await page.getByRole('button', { name: '전체 보기', exact: true }).click();
    const board = page.locator('[data-board]');
    await board.waitFor();
    const card = (title) => board.locator(`[data-task="${title}"]`);
    await board.locator('[data-stage="impl"]').locator(`[data-task="로그인 화면 만들기"]`).waitFor();
    await board.locator('[data-stage="review"]').locator(`[data-task="결제 검토"]`).waitFor();
    await board.locator('[data-stage="blocked"]').locator(`[data-task="배포 막힘"]`).waitFor();
    // All seven stage columns are there, empty ones included.
    assert.equal(await board.locator('[data-stage]').count(), 7);

    at('owner, lead and ETA');
    const impl = card('로그인 화면 만들기');
    await impl.getByText('Ivy', { exact: true }).waitFor();
    assert.equal(await impl.locator('[data-eta]').innerText(), '2분 남음');
    assert.equal(await impl.locator('[data-task-lead]').innerText(), lead.name);
    const etaBox = await impl.locator('[data-eta]').boundingBox();
    const leadBox = await impl.locator('[data-task-lead]').boundingBox();
    assert.ok(leadBox.x >= etaBox.x + etaBox.width, 'lead is to the right of the ETA');
    assert.ok(await impl.locator('[data-bar]').count() >= 1, 'a stage-time bar');
    await card('배포 막힘').getByText('맡은 사람 없음').waitFor();
    await card('결제 검토').getByText('Rae', { exact: true }).waitFor();
    // The sheet slides in; shoot (and check the width) once it has stopped.
    await page.waitForFunction(() => document.querySelector('[data-slot=sheet-content]').getAnimations().length === 0);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e19b-board.png') });
    // #811 dropped activity toasts (and MODAL_SELECTOR); the open sheet is still a modal dialog.
    assert.equal(await page.locator('[data-slot=sheet-content]').getAttribute('role'), 'dialog', 'the open sheet is a dialog');

    at('blocked reason and capped done column');
    await card('배포 막힘').locator('[data-blocked-reason]').filter({ hasText: '키가 없어요' }).waitFor();
    for (let i = 0; i < 12; i++) await call('POST', '/api/tasks', { title: `끝난 일 ${i}`, stage: 'done' });
    const done = board.locator('[data-stage="done"]');
    await done.getByRole('button', { name: '2개 더 보기' }).waitFor();
    assert.equal(await done.locator('[data-task]').count(), 10);
    assert.equal(await done.locator('[data-eta]').first().innerText(), '완료');
    const toggle = done.getByRole('button', { name: '2개 더 보기' });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await done.locator('[data-task]').count(), 12);
    // #411: the same button stays mounted, keeps focus and flips to 접기.
    const fold = done.getByRole('button', { name: '접기' });
    assert.equal(await fold.getAttribute('aria-expanded'), 'true');
    assert.ok(await fold.evaluate((el) => el === document.activeElement), 'focus stays on the toggle');
    await fold.click();
    assert.equal(await done.locator('[data-task]').count(), 10);
    await done.getByRole('button', { name: '2개 더 보기' }).click();
    assert.equal(await done.locator('[data-task]').count(), 12);

    at('live stage change');
    await call('POST', '/api/tasks', { id: task.id, stage: 'test' });
    await board.locator('[data-stage="test"]').locator('[data-task="로그인 화면 만들기"]').waitFor();
    assert.equal(await board.locator('[data-stage="impl"] [data-task]').count(), 0);
    const spans = await card('로그인 화면 만들기').locator('[data-bar]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bar')));
    assert.deepEqual(spans, ['plan', 'impl', 'test']);

    at('live new task');
    await call('POST', '/api/tasks', { title: '문서 정리', stage: 'plan' });
    await board.locator('[data-stage="plan"]').locator('[data-task="문서 정리"]').waitFor();

    at('narrow screen scrolls the board');
    await page.setViewportSize({ width: 600, height: 800 });
    assert.ok(await board.evaluate((e) => e.scrollWidth > e.clientWidth), 'columns scroll sideways instead of squeezing');

    at('close with Esc');
    await page.keyboard.press('Escape');
    await board.waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-slot=sheet-content]').count(), 0, 'no sheet once it is closed');

    at('dashboard deadline crosses without a server update');
    await page.clock.fastForward(180_000);
    await rowEta.filter({ hasText: /^기한 초과$/ }).waitFor();
    const current = (await call('GET', '/api/tasks')).tasks.find((item) => item.id === task.id);
    assert.equal(current.etaAt, task.etaAt);

    at('pick the project with two leads');
    const peer = await makeLead('alpha');
    const otherLead = await makeLead('beta');
    const peerTask = await call('POST', '/api/tasks', { lead: peer.id, title: '같은 프로젝트 작업', stage: 'impl' });
    const otherTask = await call('POST', '/api/tasks', { lead: otherLead.id, title: '다른 프로젝트 작업', stage: 'impl' });
    // An assignment with no remaining session and no known project is only visible under 전체.
    const unknown = await call('POST', '/api/tasks', { lead: 'missing', title: '프로젝트 미상 작업', stage: 'impl' });
    const finished = await call('POST', '/api/tasks', { lead: lead.id, title: '완료한 프로젝트 작업' });
    await call('POST', '/api/tasks', { id: finished.id, stage: 'done' });
    const rowFor = ({ id }) => page.locator(`[data-row="${id}"]`);
    const showDone = () => page.getByRole('button', { name: /^완료 \d+개$/ }).click();
    await page.goto(`${BASE}/#board&folder=alpha`);
    await rowFor(peerTask).waitFor();
    await showDone();
    await rowFor(finished).waitFor();
    assert.equal(await rowFor(otherTask).count(), 0);
    assert.equal(await rowFor(unknown).count(), 0);

    at('removed lead keeps both cards in the selected project after a page reload');
    await call('POST', `/api/sessions/${lead.id}/remove`);
    await page.reload();
    await rowEta.filter({ hasText: /^기한 초과$/ }).waitFor();
    await page.getByRole('button', { name: '전체 보기', exact: true }).click();
    const retained = board.locator('[data-stage="test"]').locator('[data-task="로그인 화면 만들기"]');
    await retained.locator('[data-task-lead]').filter({ hasText: /^관리자 확인 불가$/ }).waitFor();
    await board.locator('[data-stage="done"]').locator('[data-task="완료한 프로젝트 작업"]').waitFor();
    await card('같은 프로젝트 작업').waitFor();
    assert.deepEqual(await retained.locator('[data-bar]').evaluateAll((els) => els.map((el) => el.getAttribute('data-bar'))), spans);
    assert.deepEqual((await call('GET', '/api/tasks')).tasks.find((item) => item.id === task.id), current);
    await page.keyboard.press('Escape');
    await board.waitFor({ state: 'detached' });

    at('the other project excludes retained and unknown cards');
    await page.goto(`${BASE}/#board&folder=beta`);
    await rowFor(otherTask).waitFor();
    await page.getByRole('button', { name: '전체 보기', exact: true }).click();
    await card('다른 프로젝트 작업').waitFor();
    for (const title of ['로그인 화면 만들기', '완료한 프로젝트 작업', '같은 프로젝트 작업', '프로젝트 미상 작업']) {
      assert.equal(await card(title).count(), 0, title);
    }
    await page.keyboard.press('Escape');
    await board.waitFor({ state: 'detached' });

    at('all projects show the retained cards, and explicit removal still works');
    await page.goto(`${BASE}/#board`);
    await row.waitFor();
    await rowFor(unknown).waitFor();
    await showDone();
    await rowFor(finished).waitFor();
    await call('POST', `/api/tasks/${finished.id}/remove`);
    await rowFor(finished).waitFor({ state: 'detached' });
    await row.waitFor();
  }));
