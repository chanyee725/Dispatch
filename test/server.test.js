import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createApp } from '../server/app.js';

test('server serves index.html, unknown API is 404, module routes are mounted', async () => {
  const pub = await mkdtemp(join(tmpdir(), 'draw-pub-'));
  await writeFile(join(pub, 'index.html'), '<!doctype html><div id="root"></div>');
  const mod = {
    name: 'demo',
    setup: async () => ({ routes: [{ method: 'GET', path: '/api/demo', handler: (req, res) => res.end('ok') }] }),
  };
  const app = await createApp({ workspaceDir: pub }, { publicDir: pub, moduleList: [mod] });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="root"/);
    assert.equal((await fetch(`${base}/some/deep/link`)).status, 200);
    assert.equal(await (await fetch(`${base}/api/demo`)).text(), 'ok');
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
    const info = await (await fetch(`${base}/api/info`)).json();
    assert.equal(info.workspace, basename(pub));
  } finally {
    await app.close();
    await rm(pub, { recursive: true, force: true });
  }
});
