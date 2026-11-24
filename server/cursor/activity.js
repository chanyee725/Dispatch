// Agent activity log (E537, issue #654): start / progress / finish / error events of the agent sessions working on
// the workspace's documents, for the app's activity feed, toasts and browser notifications. Shape and copy:
// shared/dispatch/agent-activity.ts; the rules: ./activity-log.js.
//   GET  /api/activity             -> { events }
//   SSE  `activity`                -> one new event
// Metadata only (who, which file and section, when, what kind), never a transcript or tool text. Kept in
// <workspace>/.drawing/activity.json, the newest ACTIVITY_MAX events, written atomically a moment after a change.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ACTIVITY_MAX, parseActivityLog } from '../../shared/dispatch/agent-activity.ts';
import { createActivityLog } from './activity-log.js';

export const ACTIVITY_FILE = ['.drawing', 'activity.json'];
const WRITE_DELAY_MS = 500;
export async function setup(ctx, { now = Date.now, writeDelayMs = WRITE_DELAY_MS } = {}) {
  const dir = ctx.workspaceDir ? join(ctx.workspaceDir, ACTIVITY_FILE[0]) : null;
  const path = dir ? join(dir, ACTIVITY_FILE[1]) : null;
  let log = { events: [] };
  if (path) {
    try {
      log = parseActivityLog(JSON.parse(await readFile(path, 'utf8')));
    } catch {
      // No log yet, or a damaged one: start empty (it is only history).
    }
  }

  let timer = null;
  let writing = Promise.resolve();
  const flush = () => {
    timer = null;
    if (!path) return writing;
    const text = JSON.stringify({ version: 1, ...log });
    writing = writing
      .then(async () => {
        await mkdir(dir, { recursive: true });
        const tmp = `${path}.${process.pid}.tmp`;
        await writeFile(tmp, text);
        await rename(tmp, path);
      })
      .catch(() => {});
    return writing;
  };
  const save = () => {
    if (!timer) timer = setTimeout(flush, writeDelayMs);
  };

  // Events go out in order (one chain).
  let seq = 0;
  let chain = Promise.resolve();
  const emit = (e) => {
    // One failing event (a throwing broadcast) must not reject the chain, or every later event would be lost.
    chain = chain
      .then(() => {
        const ev = { id: `${e.at}-${++seq}`, ...e };
        log.events.push(ev);
        if (log.events.length > ACTIVITY_MAX) log.events.splice(0, log.events.length - ACTIVITY_MAX);
        save();
        ctx.hub.broadcast('activity', ev);
      })
      .catch(() => {});
    return chain;
  };

  // The documents whose edits started and finished stays are gone, so only past events and session state remain.
  const hub = ctx.modules.dispatch?.hub ?? null;
  const activity = createActivityLog({ emit, session: (sid) => hub?.get?.(sid) ?? null, now });
  const onSession = (s) => activity.sessionUpdate(s);
  hub?.on('session', onSession);

  return {
    /** For tests: resolves once every event so far is in the log. */
    settled: () => chain,
    routes: [
      {
        method: 'GET',
        path: '/api/activity',
        handler(_req, res) {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify(log));
        },
      },
    ],
    async close() {
      hub?.off('session', onSession);
      await chain;
      if (timer) {
        clearTimeout(timer);
        await flush();
      }
    },
  };
}
