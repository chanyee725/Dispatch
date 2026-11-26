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
import { fakeCliBin } from '../fixtures/fake-cli/index.mjs';

const enabled = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;

async function startProject(root, env) {
  await mkdir(root, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { env });
  git('init', '-b', 'develop', '-q');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'init');
  return execFileSync('bash', ['plugin/scripts/start.sh', root], { env, encoding: 'utf8' }).trim();
}

test('the sidebar counts registered live projects and links to their boards', { skip: !enabled, timeout: 30_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const home = await mkdtemp(join(tmpdir(), 'dispatch-sidebar-'));
  const fake = fakeCliBin({ scenario: [] });
  const env = {
    ...process.env, ...fake.env, HOME: home, PATH: `${fake.dir}:${process.env.PATH}`,
    DRAWING_HOME: process.cwd(), DRAWING_USER_DEFAULTS: '', DISPATCH_PORT: '0', DRAW_PORT: '0',
  };
  const root = join(home, 'personal', 'Dispatch');
  const peerRoot = join(home, 'ws', 'physical-ai', 'sim-client');
  const forgedRoot = join(home, 'ws', 'physical-ai', 'keeper2-bridge');
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
    workspaces: [{ path: peerRoot }, { path: join(peerRoot, '.dispatch'), name: 'Alias' }],
  }));
  const base = await startProject(root, env);
  started.add(root);
  const peer = await startProject(peerRoot, env);
  started.add(peerRoot);

  forged = createServer((req, res) => {
    forgedRequests++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ projects: [
      { name: 'keeper2-bridge', path: forgedRoot, port: forged.address().port, current: true },
    ] }));
  });
  forged.listen(0, '127.0.0.1');
  await once(forged, 'listening');
  await mkdir(join(forgedRoot, '.dispatch'), { recursive: true });
  await writeFile(join(forgedRoot, '.dispatch', 'server.port'), String(forged.address().port));

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}#board`);

  const sidebar = page.getByLabel('사이드바', { exact: true });
  const projects = sidebar.getByRole('navigation', { name: '프로젝트', exact: true });
  const link = projects.getByRole('link', { name: 'Sim Client', exact: true });
  await link.waitFor();
  assert.deepEqual(await projects.getByRole('link').allTextContents(), ['Dispatch', 'Sim Client']);
  assert.equal(await projects.getByText('2', { exact: true }).count(), 1);
  assert.equal(await projects.getByRole('link', { name: 'Dispatch', exact: true }).getAttribute('aria-current'), 'location');
  assert.equal(forgedRequests, 0);
  if (process.env.DRAW_SHOTS) await page.screenshot({ path: join(process.env.DRAW_SHOTS, 'sidebar-services.png') });

  await link.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(`${peer}#board`);
  await projects.getByRole('link', { name: 'Sim Client', exact: true }).waitFor();
  assert.equal(await projects.getByRole('link', { name: 'Sim Client', exact: true }).getAttribute('aria-current'), 'location');

  stop(peerRoot);
  started.delete(peerRoot);
  await page.goto(`${base}#board`);
  await projects.getByText('1', { exact: true }).waitFor();
  assert.deepEqual(await projects.getByRole('link').allTextContents(), ['Dispatch']);
});
