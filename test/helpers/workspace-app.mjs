// Shared by the workspace test files: an app on a scratch workspace, an SSE reader for `workspace` events.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.js';
import { modules } from '../../server/modules.js';

export async function withApp(fn) {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const outside = await mkdtemp(join(tmpdir(), 'draw-out-'));
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: modules });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-drawing': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn({ ws, outside, base, call, app });
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

export const q = (p) => encodeURIComponent(p);

export function sseReader(base) {
  const events = [];
  const ac = new AbortController();
  const waiters = [];
  const done = (async () => {
    const res = await fetch(`${base}/api/events`, { signal: ac.signal });
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev === 'workspace') {
            events.push(JSON.parse(data));
            waiters.splice(0).forEach((w) => w());
          }
        }
      }
    } catch {}
  })();
  const waitFor = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (!events.some(pred)) {
      if (Date.now() > end) throw new Error(`timeout; got ${JSON.stringify(events)}`);
      await new Promise((r) => { waiters.push(r); setTimeout(r, 50); });
    }
    return events.find(pred);
  };
  return { events, waitFor, stop: () => { ac.abort(); return done; } };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
