// New agent activity and app events while the app is open (E537 #654, E540 #671). Nothing pops up on the
// page (action results are Sonner toasts, #899). While the page is hidden and notifications are
// on (설정 > 일반, dispatch/lib/notify.ts), start, finish and error activity also goes out as a browser notification
// (app events do the same from notifyApp, appNotify.ts). Renders nothing.
import { useEffect, useRef } from 'react';
import type { ToastTarget } from './appEvents';
import { setNotifyOpener, watchAppEvents } from './appNotify';
import { activitySentence } from '../../../shared/dispatch/agent-activity.ts';
import { alertsOn } from '../dispatch/lib/notify';
import { alertRoute } from './activity';
import { onNewActivity } from './store';

/** onSession: a session id (where a browser notification's click goes); other notifications only bring the tab forward. */
export function ActivityAlerts({ onSession }: { onSession: (id: string) => void }) {
  const openSession = useRef(onSession);
  openSession.current = onSession;

  useEffect(
    () =>
      onNewActivity((e) => {
        if (alertRoute(e, { visible: document.visibilityState === 'visible', notify: alertsOn() }) !== 'notification') return;
        try {
          const n = new Notification('에이전트 활동', { body: activitySentence(e), tag: `activity:${e.id}` });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        } catch {
          // Some browsers only allow notifications from a service worker.
        }
      }),
    [],
  );
  useEffect(() => {
    watchAppEvents();
    const go = (target: ToastTarget) => ('session' in target ? openSession.current(target.session) : window.focus());
    setNotifyOpener((t) => t.target && go(t.target));
  }, []);
  return null;
}
