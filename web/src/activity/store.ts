// The page's activity log (E537, #654): GET /api/activity once, then SSE `activity` (one new event); a
// reconnect loads it again. New events go to the listeners
// (browser notifications) only after the first load, so history never pops up. Memory only.
import { parseActivityLog } from '../../../shared/dispatch/agent-activity.ts';
import { events } from '../lib/events';
import { addEvent, type ActivityEvent, type ActivityLog } from './activity';

let log: ActivityLog = { events: [] };
let loaded = false;
let started = false;
const fresh = new Set<(e: ActivityEvent) => void>();
const set = (next: ActivityLog) => {
  if (next === log) return;
  log = next;
};

function load() {
  void fetch('/api/activity')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d) return;
      const got = parseActivityLog(d);
      // Keep events that came over the stream while the request ran.
      let next: ActivityLog = { events: got.events };
      for (const e of log.events) next = addEvent(next, e);
      loaded = true;
      set(next);
    })
    .catch(() => {});
}

function start() {
  if (started) return;
  started = true;
  events.subscribeJson<unknown>('activity', (e) => {
    const next = addEvent(log, e);
    if (next === log) return;
    set(next);
    if (loaded) for (const f of fresh) f(e as ActivityEvent);
  });
  let first = true;
  events.onConnection((online) => {
    if (!online) return;
    if (first) first = false;
    else load();
  });
  load();
}

/** fn(event) for each event that comes in after the first load. */
export function onNewActivity(fn: (e: ActivityEvent) => void) {
  start();
  fresh.add(fn);
  return () => void fresh.delete(fn);
}
