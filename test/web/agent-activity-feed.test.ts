// E537 (#654): the app's activity log — adding events and which events go out as a browser notification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEvent, alertRoute } from '../../web/src/activity/activity.ts';
import type { ActivityEvent, ActivityLog } from '../../shared/dispatch/agent-activity.ts';

const ev = (id: string, at: number, kind: ActivityEvent['kind'] = 'start', extra: Partial<ActivityEvent> = {}): ActivityEvent => ({ id, at, kind, sid: 's1', name: 'Jude', role: 'impl', file: 'P/07 서버.dpx.json', ...extra });
const empty: ActivityLog = { events: [] };

test('addEvent: oldest first, no duplicates, malformed dropped', () => {
  let log = addEvent(empty, ev('b', 2000));
  log = addEvent(log, ev('a', 1000));
  assert.deepEqual(log.events.map((e) => e.id), ['a', 'b']);
  assert.equal(addEvent(log, ev('a', 1000)), log, 'same id: same log');
  assert.equal(addEvent(log, { id: 'x' }), log, 'malformed: same log');
});

test('alertRoute: no toast in view (#811), notification when hidden and on, progress never pops up', () => {
  assert.equal(alertRoute({ kind: 'start' }, { visible: true, notify: true }), null);
  assert.equal(alertRoute({ kind: 'finish' }, { visible: false, notify: true }), 'notification');
  assert.equal(alertRoute({ kind: 'error' }, { visible: false, notify: false }), null);
  assert.equal(alertRoute({ kind: 'progress' }, { visible: true, notify: true }), null);
});
