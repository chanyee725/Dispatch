// Headless check of the agent live view (E559, #728): a fake session on the 세션 board opens the panel from its card,
// the panel closes by its button and by Esc, turns into a bottom sheet under 720px, and keeps session tools available without a chat tab.
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

test('agent live view opens from a board card, closes by button and Esc, keeps tools available without chat', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-live-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-live-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const gate = join(home, 'gate-end');
  const question = '계속 진행할까요?';
  // Runs one command, then waits (stays 작업 중) until the test ends it.
  const fake = fakeCliBin({
    scenario: [
      { type: 'system', subtype: 'init', session_id: 'fake-live' },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }], usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      { $waitFor: gate },
      { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: question }], usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: 'result', subtype: 'success', total_cost_usd: 0.001 },
    ],
  });
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
  t.after(async () => {
    writeFileSync(gate, '');
    await browser?.close();
    server.kill();
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
  const call = async (m, u, b) => {
    const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    const body = await res.json();
    assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
    return body;
  };
  await call('POST', '/api/providers/claude/login');
  const s = (await call('POST', '/api/sessions', { items: [{ role: 'impl', prompt: 'run the tests' }], worktree: false })).sessions[0];

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  const chatRequests = [];
  page.on('request', (request) => {
    if (/\/api\/(chats\b|sessions\/[^/]+\/messages?\b)/.test(new URL(request.url()).pathname)) {
      chatRequests.push(request.method());
    }
  });
  await page.goto(`${BASE}/dispatch`);
  const card = page.locator(`[data-session-board] [data-agent="${s.id}"]`);
  const open = card.locator(`button[data-agent-live="${s.id}"]`);
  await open.waitFor({ timeout: 15_000 });
  // The board row is the trigger itself (#731): its accessible name is the session's own text.
  const panel = page.locator(`dialog[data-agent-live="${s.id}"]`);
  const isOpen = () => panel.evaluate((el) => el.matches(':popover-open')).catch(() => false);

  // 1. The card button opens a right-docked 400px panel; focus moves into it; the hash names the agent.
  await open.click();
  await panel.waitFor();
  assert.equal(await isOpen(), true, 'panel open');
  assert.equal(await card.getAttribute('aria-current'), 'true');
  const box = await panel.boundingBox();
  // #905: 460px, 8px off the right edge, floating 24px above the bottom.
  assert.ok(Math.abs(box.width - 460) <= 1 && Math.abs(box.x + box.width - 1272) <= 1 && Math.abs(box.y + box.height - 776) <= 1, `floating 460px panel: ${JSON.stringify(box)}`);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '닫기', 'focus on the close button');
  assert.match(await page.evaluate(() => location.hash), new RegExp(`agent=${encodeURIComponent(s.id)}`));
  await page.waitForFunction((id) => /npm test/.test(document.querySelector(`dialog[data-agent-live="${id}"]`)?.textContent ?? ''), s.id, { timeout: 10_000 });
  // Only the state label is announced; the clock that ticks every second is outside the live region.
  const regions = await panel.evaluate((el) => [...el.querySelectorAll('[aria-live]')].map((r) => [r.getAttribute('aria-live'), r.textContent, !!r.querySelector('[data-live-clock]')]));
  assert.ok(regions.length >= 1 && regions.every(([, t, clock]) => !clock && !/째/.test(t)), `live regions: ${JSON.stringify(regions)}`);
  const text = await panel.textContent();
  assert.ok(!text.includes(home) && !text.includes(repo) && !/\/home\//.test(text), `no home paths in the panel: ${text}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'agent-live-board-1280.png') });

  // 2. The close button closes it and focus returns to the card's button.
  await panel.getByRole('button', { name: '닫기' }).first().click();
  await page.waitForFunction((id) => !document.querySelector(`dialog[data-agent-live="${id}"]:popover-open`), s.id);
  assert.equal(await card.getAttribute('aria-current'), null);
  await page.waitForFunction((id) => document.activeElement?.getAttribute('data-agent-live') === id, s.id, { timeout: 3000 }); // focus returns in the next frame

  // 3. Esc closes it (pressed once focus has moved into the panel: Esc is handled there).
  await open.click();
  await panel.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '닫기');
  await page.keyboard.press('Escape');
  await page.waitForFunction((id) => !document.querySelector(`dialog[data-agent-live="${id}"]:popover-open`), s.id);

  // 4. Under 720px it is a full-width bottom sheet.
  await page.setViewportSize({ width: 600, height: 800 });
  await open.click();
  await panel.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '닫기');
  const sheetBox = await panel.boundingBox();
  assert.ok(sheetBox.x <= 1 && Math.abs(sheetBox.width - 600) <= 1 && Math.abs(sheetBox.y + sheetBox.height - 800) <= 1 && Math.abs(sheetBox.height - 560) <= 2, `bottom sheet: ${JSON.stringify(sheetBox)}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'agent-live-sheet-600.png') });
  await page.setViewportSize({ width: 1280, height: 800 });

  // 5. The progress view offers the retained tabs and session controls without a chat entry point.
  const tabs = panel.getByRole('tablist', { name: '에이전트 보기' }).getByRole('tab');
  assert.deepEqual(await tabs.allInnerTexts(), ['진행', '작업 보기', '변경사항', '정보', '조직도']);
  assert.equal(await panel.getByRole('button', { name: '대화 보기' }).count(), 0);
  assert.equal(await panel.getByRole('textbox', { name: '메시지' }).count(), 0);
  const interrupt = panel.getByRole('button', { name: '중단' });
  await interrupt.waitFor();
  assert.equal(await interrupt.isEnabled(), true);
  const progress = panel.getByRole('tab', { name: '진행' });
  await progress.focus();
  await page.keyboard.press('ArrowRight');
  await panel.getByRole('tab', { name: '작업 보기', selected: true }).waitFor();
  await page.keyboard.press('ArrowRight');
  await panel.getByText('바뀐 파일이 없어요.').waitFor();
  await page.keyboard.press('ArrowRight');
  await panel.getByText('세션 ID', { exact: true }).waitFor();
  await page.keyboard.press('ArrowRight');
  await panel.locator('[data-session-tab="org"]').waitFor();
  assert.equal(await isOpen(), true);
  assert.deepEqual(chatRequests, [], 'browsing the board and live panel does not request chat or transcripts');

  // 6. A pending question still accepts a reply from the progress tab.
  writeFileSync(gate, '');
  await progress.click();
  const answer = panel.getByRole('region', { name: '답할 것' });
  await answer.getByText(question).waitFor();
  await answer.getByRole('textbox', { name: '답변' }).fill('진행해 주세요.');
  const reply = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/sessions/${s.id}/message` && response.request().method() === 'POST',
  );
  await answer.getByRole('button', { name: '답변 보내기' }).click();
  assert.equal((await reply).ok(), true);
  await answer.waitFor({ state: 'hidden' });

  // 7. The saved history management remains reachable in General Settings.
  await panel.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '설정' });
  await settings.getByTestId('settings-chat-history').getByRole('button', { name: '모두 지우기' }).waitFor();
  const body = await page.locator('body').textContent();
  assert.ok(!body.includes(home) && !body.includes(repo), 'no scratch home or repo path on the page');

  assert.deepEqual(errors, []);
});
