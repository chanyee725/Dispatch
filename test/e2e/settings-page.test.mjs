// Headless check of the 설정 modal (#587, #624): the section list, the answer-style switch, team values, a role's
// default model and the limits form each saved from their own section; edits survive switching sections; the last
// section is remembered; 390px fits with a <select> for the sections.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no
// real claude can start. It refuses to go on unless the server log names its port and workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

test('설정 modal: sections, save team settings, a role model and limits, remembered section, 390px', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-settings-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-settings-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const fake = fakeCliBin();
  const port = await freePort();
  // Fakes first; git's own folder after them (fakes win any name clash).
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { PATH, HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', FAKE_CLI_LOG: fake.env.FAKE_CLI_LOG, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  t.after(async () => {
    await browser?.close();
    server.kill();
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
  const state = async () => (await (await fetch(`${BASE}/api/state`)).json());

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  // The 사용 한도 section's own GET /api/limits (the sidebar's model rows ask too, without a content-type): it must wait
  // until that section is shown (#639), even though every section is mounted.
  const sectionLimits = (r) => r.url().endsWith('/api/limits') && r.headers()['content-type'] === 'application/json';
  let limitsAsked = 0;
  page.on('request', (r) => sectionLimits(r) && limitsAsked++);

  // 1. The sidebar 설정 row opens the modal on 일반, with the section list on the left.
  await page.goto(BASE);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '설정' });
  await dialog.waitFor();
  const nav = dialog.getByRole('navigation', { name: '설정 항목' });
  const section = (name) => nav.getByRole('button', { name, exact: true }).click();
  assert.deepEqual(await nav.getByRole('button').allInnerTexts(), ['일반', '모델 연결', '모드별 모델', '관리자와 팀', '사용 한도', '작업 폴더', '멈춤 감지']);
  assert.equal(await nav.getByRole('button', { name: '일반' }).getAttribute('aria-current'), 'true');
  await dialog.getByRole('radiogroup', { name: '화면 테마' }).waitFor();

  // 2. 일반: the answer-style switch saves at once.
  const general = dialog.getByRole('region', { name: '일반' });
  const reply = general.locator('#settings-reply-style');
  await page.waitForFunction(() => !document.querySelector('#settings-reply-style')?.disabled);
  assert.equal(await reply.isChecked(), true);
  await reply.uncheck();
  await general.getByText('저장했어요.').waitFor();
  assert.equal((await state()).settings.team.replyStyle, false);

  // 3. 관리자와 팀: change a number and save; untouched values stay.
  await section('관리자와 팀');
  const team = dialog.getByRole('form', { name: '관리자와 팀' });
  const maxChildren = team.getByRole('spinbutton', { name: /^관리자 한 명이 둘 수 있는 팀원/ });
  assert.equal(await maxChildren.inputValue(), '8');
  await maxChildren.fill('4');
  const before = await state();
  await team.getByRole('button', { name: '저장' }).click();
  await team.getByText('저장했어요.').waitFor();
  let s = await state();
  assert.equal(s.settings.team.maxChildren, 4);
  assert.equal(s.settings.team.rotateLead, before.settings.team.rotateLead, 'untouched values stay');

  // 3a. Auto-remove of finished teammates (#640): the switch and the grace period save together.
  const autoRemove = team.getByRole('checkbox', { name: '일이 끝난 팀원 자동으로 지우기' });
  const grace = team.getByRole('spinbutton', { name: /^끝난 팀원 지우기 전 기다리는 시간/ });
  assert.equal(await autoRemove.isChecked(), true);
  assert.equal(await grace.inputValue(), '120');
  await grace.fill('2');
  await team.getByRole('button', { name: '저장' }).click();
  await team.locator('#team-autoRemoveGraceSec-error').waitFor();
  assert.equal((await state()).settings.team.autoRemoveGraceSec, 120, 'a bad grace is not sent');
  await grace.fill('45');
  await autoRemove.uncheck();
  await team.getByRole('button', { name: '저장' }).click();
  await team.getByText('저장했어요.').waitFor();
  s = await state();
  assert.equal(s.settings.team.autoRemoveDone, false);
  assert.equal(s.settings.team.autoRemoveGraceSec, 45);
  assert.equal(s.settings.team.maxChildren, 4);

  // 3b. A change made elsewhere while the modal is open shows in untouched fields, and the next save does not
  // send the old value back (#615).
  const post = (body) => fetch(`${BASE}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: JSON.stringify(body) });
  const rotateLead = team.getByRole('spinbutton', { name: /^관리자 대화 새로 시작/ });
  await rotateLead.fill('3'); // in-progress edit, not saved yet
  assert.ok((await post({ team: { maxChildren: 6, rotateLead: 9 } })).ok);
  await page.waitForFunction(() => document.querySelector('#team-maxChildren')?.value === '6');
  assert.equal(await rotateLead.inputValue(), '3', 'the in-progress edit stays');
  await rotateLead.fill('9');
  await team.getByRole('button', { name: '저장' }).click();
  await team.getByText('바뀐 게 없어요.').waitFor();
  assert.ok((await post({ team: { maxChildren: 4 } })).ok);
  await page.waitForFunction(() => document.querySelector('#team-maxChildren')?.value === '4');

  // 4. A bad value is not sent: the Korean message shows under the field (no browser bubble) and the field gets
  // focus; once fixed, saving with nothing changed says so.
  await maxChildren.fill('0');
  await team.getByRole('button', { name: '저장' }).click();
  await team.locator('#team-maxChildren-error').waitFor();
  assert.equal(await maxChildren.getAttribute('aria-invalid'), 'true');
  assert.match(await maxChildren.getAttribute('aria-describedby'), /team-maxChildren-error/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'team-maxChildren');
  assert.equal((await state()).settings.team.maxChildren, 4);
  await maxChildren.fill('4');
  assert.equal(await team.locator('#team-maxChildren-error').count(), 0, 'the message clears once fixed');
  assert.equal(await maxChildren.getAttribute('aria-invalid'), 'false');
  await team.getByRole('button', { name: '저장' }).click();
  await team.getByText('바뀐 게 없어요.').waitFor();

  // 5. 모드별 모델 (#748): pick another model for a role in the open mode (구현) and save it; an unsaved edit in another
  // section survives switching.
  await maxChildren.fill('5');
  // A provider's models can be picked only once it is connected (#676); the fake claude is logged in, so this connects.
  const conn = await fetch(`${BASE}/api/providers/claude/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: '{}' });
  assert.equal((await conn.json()).connected, true);
  await section('모드별 모델');
  const roles = dialog.getByRole('form', { name: '모드별 모델' });
  await roles.getByRole('tablist', { name: '모드' }).waitFor();
  assert.equal(await roles.getByRole('tab', { name: '구현' }).getAttribute('aria-selected'), 'true');
  // The six modes include 조사 (#856); its tab explains the mode.
  assert.deepEqual(await roles.getByRole('tab').allInnerTexts().then((t) => t.map((x) => x.trim())), ['계획/설계', '구현', '리뷰·테스트', '문서', '빠른 수정', '조사']);
  await roles.getByRole('tab', { name: '조사' }).click();
  await roles.getByText('웹 서치와 자료 모으기에 맞춘 모드예요.').waitFor();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'settings-research-1440.png') });
  await roles.getByRole('tab', { name: '구현' }).click();
  const role = before.roles[0];
  const roleSelect = roles.getByRole('combobox', { name: role.name, exact: true });
  const was = await roleSelect.inputValue();
  const other = before.models.find((m) => m.id !== was && m.provider === 'claude');
  assert.ok(other, 'a second model to pick');
  await roleSelect.selectOption(other.id);
  assert.match(await roles.getByRole('tab', { name: /구현/ }).innerText(), /구현/);
  await roles.getByRole('button', { name: '저장' }).click();
  await roles.getByText('저장했어요.').waitFor();
  const mp = await (await fetch(`${BASE}/api/mode-profiles`)).json();
  assert.equal(mp.stored.cells.impl[role.id].model, other.id);
  s = await state();
  assert.equal(s.settings.team.maxChildren, 4, 'another section\'s edit is not sent');
  await section('관리자와 팀');
  assert.equal(await maxChildren.inputValue(), '5', 'the unsaved edit survives switching sections');

  // 5b. Closing with unsaved input asks first (#638): the modal takes closedby="none"; Esc and the X button open a
  // confirm with the safe 계속 수정하기 focused; Esc in the confirm closes only the confirm; 닫기 drops the edit.
  const confirm = page.getByRole('dialog', { name: '저장하지 않은 내용이 있어요' });
  assert.equal(await dialog.getAttribute('closedby'), 'none');
  await page.keyboard.press('Escape');
  await confirm.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '계속 수정하기');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'settings-close-confirm-1440.png') });
  await confirm.getByRole('button', { name: '계속 수정하기' }).click();
  await confirm.waitFor({ state: 'hidden' });
  assert.ok(await dialog.isVisible(), 'keep editing leaves the modal open');
  assert.equal(await maxChildren.inputValue(), '5', 'and the edit stays');
  await dialog.getByRole('button', { name: '설정 닫기' }).click();
  await confirm.waitFor();
  await page.keyboard.press('Escape');
  await confirm.waitFor({ state: 'hidden' });
  assert.ok(await dialog.isVisible(), 'Esc in the confirm closes only the confirm');
  await dialog.getByRole('button', { name: '설정 닫기' }).click();
  await confirm.getByRole('button', { name: '닫기', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await state()).settings.team.maxChildren, 4, 'the dropped edit was never sent');
  // Nothing unsaved: Esc closes at once, no confirm.
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await dialog.waitFor();
  assert.equal(await maxChildren.inputValue(), '4');
  assert.equal(await dialog.getAttribute('closedby'), 'closerequest');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await confirm.count(), 0);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await dialog.waitFor();

  // 6. 사용 한도: per-provider usage and the guard form; Dispatch on, so nothing is read-only. Its usage is asked for
  // only now that it is shown.
  assert.equal(limitsAsked, 0, 'the hidden 사용 한도 section asked for /api/limits');
  const asked = page.waitForRequest(sectionLimits);
  await section('사용 한도');
  await asked;
  const limits = dialog.getByRole('region', { name: '사용 한도' });
  await limits.getByRole('group', { name: '모델별 사용량' }).waitFor();
  const five = limits.getByRole('spinbutton', { name: /^5시간 한도/ });
  await five.fill('80');
  await limits.getByRole('button', { name: '저장' }).click();
  await limits.getByText('저장했어요.').waitFor();
  assert.equal((await state()).settings.guard.five, 0.8);
  assert.equal(await dialog.getByTestId('settings-off-note').count(), 0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'settings-modal-1440.png') });

  // 7. Reopen after a reload: saved values show, and the modal opens on the section last chosen.
  await page.reload();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await dialog.waitFor();
  assert.equal(await nav.getByRole('button', { name: '사용 한도' }).getAttribute('aria-current'), 'true');
  await section('관리자와 팀');
  assert.equal(await maxChildren.inputValue(), '4');
  await section('모드별 모델');
  assert.equal(await roleSelect.inputValue(), other.id);

  // 8. Narrow width: the modal fits, a <select> picks the section, nothing overflows sideways.
  // Below 768px the sidebar becomes a drawer (a different tree), so open the modal again from there.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.reload();
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await dialog.waitFor();
  const select = dialog.getByRole('combobox', { name: '설정 항목' });
  // The 일반 switches get a 20px box at this width (#638).
  await select.selectOption({ label: '일반' });
  for (const id of ['#settings-alerts', '#settings-reply-style']) {
    const b = await dialog.locator(id).boundingBox();
    assert.ok(b && b.width >= 20 && b.height >= 20, `${id} is 20px at 390px: ${JSON.stringify(b)}`);
  }
  await select.selectOption({ label: '관리자와 팀' });
  await maxChildren.waitFor();
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `fits 390px: ${JSON.stringify(box)}`);
  // Nothing inside the modal scrolls sideways.
  const wide = await dialog.evaluate((d) => [d, ...d.querySelectorAll('.settings-dialog-body')].map((e) => e.scrollWidth - e.clientWidth));
  assert.deepEqual(wide, [0, 0], `no sideways scroll in the modal at 390px: ${wide}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'settings-modal-390.png') });
  assert.deepEqual(errors, []);
});
