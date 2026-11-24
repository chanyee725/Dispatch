// Agent activity of the app (E537, issue #654): the server's activity log (shared/dispatch/agent-activity.ts) as the
// page keeps it, and when a new event goes out as a browser notification (page hidden, notifications on; no pop-ups
// on the page itself). Pure (no React or DOM), so it runs under `node --test`. Metadata only: who, which file, when.
import { ACTIVITY_MAX, isActivityEvent, type ActivityEvent, type ActivityLog } from '../../../shared/dispatch/agent-activity.ts';

export type { ActivityEvent, ActivityLog };

/** The log with one new event (the same log when it is already there or malformed). Oldest first, capped. */
export function addEvent(log: ActivityLog, e: unknown): ActivityLog {
  if (!isActivityEvent(e) || log.events.some((x) => x.id === e.id)) return log;
  const events = [...log.events, e].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-ACTIVITY_MAX);
  return { ...log, events };
}

/** Progress events come often (one per section): they never go out as a notification. */
export const alerts = (e: Pick<ActivityEvent, 'kind'>) => e.kind !== 'progress';

/** How to tell the user about a new event on the page: a browser notification when the page is hidden and they
 * are turned on, else nothing . */
export function alertRoute(e: Pick<ActivityEvent, 'kind'>, page: { visible: boolean; notify: boolean }): 'notification' | null {
  if (!alerts(e) || page.visible) return null;
  return page.notify ? 'notification' : null;
}
