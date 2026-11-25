import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { which } from '../../server/dispatch/cli.js';
import { fakeCliBin, until } from '../fixtures/fake-cli/index.mjs';

const enabled = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;

test('branch and usage panels recover after a render error and a failed request', {
  skip: !enabled && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run',
  timeout: 60_000,
}, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise((resolve) => reservation.close(resolve));
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-branch-usage-'));
  const repo = join(dir, 'repo');
  const home = join(dir, 'home');
  mkdirSync(repo);
  mkdirSync(home);
  const fake = fakeCliBin();
  let server;
  let exited;
  let browser;
  t.after(async () => {
    await browser?.close();
    server?.kill();
    await exited;
    fake.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'develop');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'scratch commit', '--allow-empty');
  const hash = git('rev-parse', 'HEAD');
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server/index.js', repo], {
    env: {
      ...fake.env,
      HOME: home,
      PATH: `${fake.dir}:${dirname(which('git'))}`,
      DISPATCH_PORT: String(port),
      DRAW_WORKSPACE_WATCH: 'poll',
      NODE_TEST_CONTEXT: 'child',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  exited = once(server, 'exit');
  let log = '';
  server.stdout.on('data', (data) => { log += data; });
  await until(() => log.includes(`${base}/`) && log.includes(`workspace ${repo}`), 10_000);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const branch = 'dispatch/scratch';
  await page.route('**/api/branches/live', (route) => route.fulfill({ json: {
    base: 'develop', pr: 'disabled', rows: [{
      branch, sessions: [], issue: null, ahead: 0, behind: 0, lastAt: null, subject: 'scratch commit', dirty: null, merged: false, pr: null,
    }],
  } }));
  const validTree = {
    base: 'develop',
    commits: [{ hash, parents: [], branch: 'develop', at: null, subject: 'scratch commit' }],
    tips: [{ branch: 'develop', hash }, { branch, hash }],
  };
  let tree = { ...validTree, commits: [null] }; // Accepted by the API shape check, then throws inside rendering.
  await page.route('**/api/branches/tree', (route) => route.fulfill({ json: tree }));
  let failUsage = true;
  await page.route('**/api/usage', (route) => failUsage
    ? route.fulfill({ status: 500, json: { error: 'Test request failed' } })
    : route.continue());

  await page.goto(`${base}/#board=branches`);
  const crash = page.getByRole('alert').filter({ hasText: '화면을 그리지 못했어요' });
  await crash.waitFor();
  const main = page.locator('[data-session-board]');
  await main.getByRole('link', { name: '세션 보드' }).waitFor();
  const usageTab = page.getByRole('button', { name: '사용량', exact: true });
  await usageTab.focus();
  await usageTab.press('Enter');
  const usageError = page.getByRole('alert').filter({ hasText: '사용량을 불러오지 못했어요' });
  await usageError.waitFor();
  assert.equal(await crash.count(), 0);
  failUsage = false;
  await usageError.getByRole('button', { name: '다시 불러오기' }).click();
  await main.getByText('캐시 적중률', { exact: true }).waitFor();
  assert.equal(await usageError.count(), 0);

  tree = validTree;
  await page.getByRole('button', { name: '브랜치', exact: true }).click();
  await page.getByRole('heading', { name: '커밋 그래프' }).waitFor();
  await page.locator('[data-branch-tree]').getByText(branch, { exact: true }).waitFor();
  assert.equal(await crash.count(), 0);
});
