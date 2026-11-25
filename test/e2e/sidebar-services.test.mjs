// Run after npm run build with DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createApp } from '../../server/app.js';

const enabled = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

test('the sidebar shows running Dispatch services and links to their boards', { skip: !enabled, timeout: 30_000 }, async () => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const home = await mkdtemp(join(tmpdir(), 'dispatch-sidebar-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  let peer, app, browser;
  try {
    const root = join(home, 'Dispatch');
    const workspaceDir = join(root, '.dispatch');
    await mkdir(join(workspaceDir, 'transcripts'), { recursive: true });
    await mkdir(join(workspaceDir, 'wt'));
    const git = (...args) => execFileSync('git', ['-C', root, ...args]);
    git('init', '-b', 'develop', '-q');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'init');

    const peerRoot = join(home, 'ws', 'physical-ai', 'sim-client');
    let peerPort;
    peer = createServer((req, res) => {
      if (req.url === '/api/projects') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ projects: [{ name: 'sim-client', path: peerRoot, port: peerPort, current: true }] }));
      } else {
        res.end('sim-client board');
      }
    });
    peerPort = await listen(peer);
    await mkdir(join(peerRoot, '.dispatch'), { recursive: true });
    await writeFile(join(peerRoot, '.dispatch', 'server.port'), String(peerPort));

    app = await createApp({ workspaceDir, projectMode: true });
    const port = await listen(app.server);
    const base = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#board`);

    const sidebar = page.getByLabel('사이드바', { exact: true });
    const projects = sidebar.getByRole('list', { name: '실행 중인 프로젝트' });
    const link = projects.getByRole('link', { name: `sim-client :${peerPort}` });
    await link.waitFor();
    assert.equal(await projects.getByRole('link').count(), 2);
    assert.equal(await projects.getByRole('link', { name: `Dispatch :${port}` }).getAttribute('aria-current'), 'location');
    assert.equal(await sidebar.getByLabel('팀장 필터').count(), 0);
    assert.equal(await sidebar.locator('[data-sidebar-session]').count(), 0);
    assert.equal(await sidebar.getByText(/transcripts|^wt$|미분류/).count(), 0);
    await link.click();
    await page.waitForURL(`http://127.0.0.1:${peerPort}/#board`);
    await page.getByText('sim-client board').waitFor();
  } finally {
    await browser?.close();
    await app?.close();
    if (peer?.listening) await new Promise((resolve) => peer.close(resolve));
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
