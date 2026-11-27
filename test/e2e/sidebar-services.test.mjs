// Run after npm run build with DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { fakeCliBin, until } from '../fixtures/fake-cli/index.mjs';

const enabled = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;

async function startProject(root, env) {
  await mkdir(root, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { env });
  git('init', '-b', 'develop', '-q');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'init');
  return execFileSync('bash', ['plugin/scripts/start.sh', root], { env, encoding: 'utf8' }).trim();
}

test('the sidebar counts open sessions per service and marks the current project', { skip: !enabled, timeout: 30_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const home = await mkdtemp(join(tmpdir(), 'dispatch-sidebar-'));
  const fake = fakeCliBin({ scenario: [
    { type: 'system', subtype: 'init', session_id: 'fake-sidebar' },
    { type: 'result', subtype: 'success' },
  ] });
  const env = {
    ...process.env, ...fake.env, HOME: home, PATH: `${fake.dir}:${process.env.PATH}`,
    DRAWING_HOME: process.cwd(), DRAWING_USER_DEFAULTS: '', DISPATCH_PORT: '0', DRAW_PORT: '0',
  };
  const root = join(home, 'personal', 'Dispatch');
  const peerRoot = join(home, 'ws', 'physical-ai', 'sim-client');
  const keeperRoot = join(home, 'ws', 'physical-ai', 'keeper2-bridge');
  const studioRoot = join(home, 'ws', 'physical-ai', 'sim-studio');
  const forgedRoot = join(home, 'forged');
  const stop = (project) => execFileSync('bash', ['plugin/skills/dispatch/scripts/stop.sh', project], { env });
  const started = new Set();
  let browser, forged, forgedRequests = 0;
  t.after(async () => {
    await browser?.close();
    for (const project of started) stop(project);
    if (forged?.listening) await new Promise((resolve) => forged.close(resolve));
    fake.cleanup();
    await rm(home, { recursive: true, force: true });
  });

  const defaults = join(home, '.dispatch', 'drawing.json');
  await mkdir(dirname(defaults));
  await writeFile(defaults, JSON.stringify({
    version: 1,
    prStatus: false,
    workspaces: [{ path: peerRoot }, { path: join(peerRoot, '.dispatch'), name: 'Alias' }, { path: forgedRoot }],
  }));
  const base = await startProject(root, env);
  started.add(root);
  const peer = await startProject(peerRoot, env);
  started.add(peerRoot);
  for (const project of [keeperRoot, studioRoot]) {
    await startProject(project, env);
    started.add(project);
  }

  const post = async (url, body) => {
    const response = await fetch(new URL(url, peer), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-drawing': '1' },
      body: body && JSON.stringify(body),
    });
    assert.ok(response.ok, `${url}: HTTP ${response.status}`);
    return response.json();
  };
  await post('/api/providers/claude/login');
  const make = async (role, parent) => (await post('/api/sessions', {
    items: [{ role, model: 'claude-sonnet-5-5', task: 'fixture' }], parent, worktree: false,
  })).sessions[0];
  const lead = await make('lead');
  const member = await make('impl', lead.id);
  const finished = await make('impl', lead.id);
  await until(async () => {
    const { sessions } = await (await fetch(new URL('/api/state', peer))).json();
    return sessions.length === 3 && sessions.every((session) => session.status === 'idle');
  });
  await post(`/api/sessions/${finished.id}/kill`);

  forged = createServer((req, res) => {
    forgedRequests++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ projects: [
      { name: 'forged', path: forgedRoot, port: forged.address().port, current: true },
    ] }));
  });
  forged.listen(0, '127.0.0.1');
  await once(forged, 'listening');
  await mkdir(join(forgedRoot, '.dispatch'), { recursive: true });
  await writeFile(join(forgedRoot, '.dispatch', 'server.port'), String(forged.address().port));

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.clock.install();
  await page.goto(`${base}#board`);

  const sidebar = page.getByLabel('사이드바', { exact: true });
  const projects = sidebar.getByRole('navigation', { name: '프로젝트', exact: true });
  const project = (name) => projects.getByRole('link', { name, exact: true });
  const current = projects.locator('[aria-current="location"]');
  const count = (name) => project(name).locator('[data-slot="sidebar-menu-badge"]');
  const waitCount = (name, value) => count(name).filter({ hasText: new RegExp(`^${value}$`) }).waitFor();
  const dispatch = project('Dispatch');
  const link = project('Sim Client');
  await waitCount('Sim Client', 2);
  assert.equal(await dispatch.getAttribute('aria-current'), 'location');
  assert.equal(await current.count(), 1);
  assert.equal(await projects.getByRole('link').count(), 4);
  assert.equal(await projects.getByText('4', { exact: true }).count(), 1);
  for (const name of ['Dispatch', 'Keeper2 Bridge', 'Sim Studio']) await waitCount(name, 0);
  assert.equal(forgedRequests, 0);

  const styles = [];
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.locator(`html[data-theme="${theme}"]`).waitFor();
    const active = await dispatch.evaluate((link) => {
      const row = getComputedStyle(link);
      const bar = getComputedStyle(link, '::before');
      return { background: row.backgroundColor, weight: row.fontWeight, bar: bar.borderInlineStartWidth, barColor: bar.borderInlineStartColor };
    });
    assert.equal(active.weight, '600');
    assert.equal(active.bar, '2px');
    assert.notEqual(active.background, 'rgba(0, 0, 0, 0)');
    assert.notEqual(await count('Dispatch').evaluate((n) => getComputedStyle(n).color),
      await count('Sim Client').evaluate((n) => getComputedStyle(n).color));
    styles.push(active);
    if (process.env.DRAW_SHOTS) await sidebar.screenshot({ path: join(process.env.DRAW_SHOTS, `${theme}.png`) });
  }
  assert.notEqual(styles[0].background, styles[1].background);
  assert.notEqual(styles[0].barColor, styles[1].barColor);

  await post(`/api/sessions/${member.id}/kill`);
  await page.clock.fastForward(16_000);
  await waitCount('Sim Client', 1);
  await link.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(`${peer}#board`);
  await waitCount('Sim Client', 1);
  assert.equal(await link.getAttribute('aria-current'), 'location');
  assert.equal(await dispatch.getAttribute('aria-current'), null);

  await post(`/api/sessions/${lead.id}/kill`);
  await waitCount('Sim Client', 0);

  stop(peerRoot);
  started.delete(peerRoot);
  await page.goto(`${base}#board`);
  await waitCount('Dispatch', 0);
  assert.equal(await link.count(), 0);
});
