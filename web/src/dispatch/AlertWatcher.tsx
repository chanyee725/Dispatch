// Browser notifications for /dispatch (ported from standalone Dispatch's AlertWatcher, #624): rings for the four
// alert reasons (lib/alerts.ts) once the user turned them on in 설정 > 일반. Only /dispatch mounts it, so nothing
// rings from the editor; no tab-title badge. Titles and bodies carry a session name and one fixed line, no transcript.
import { useEffect, useMemo, useRef } from 'react';
import { attentionItems } from '../../../shared/dispatch/attention.ts';
import { useNow } from './AttentionStrip';
import { alertCandidates, nextAlerts } from './lib/alerts.ts';
import { stateOf } from './lib/format.ts';
import { alertsOn } from './lib/notify.ts';
import { useDispatch } from './store';

export function AlertWatcher({ onOpen }: { onOpen: (id: string) => void }) {
  const ready = useDispatch(s => s.ready);
  const sessions = useDispatch(s => s.sessions);
  const tasks = useDispatch(s => s.tasks);
  const limits = useDispatch(s => s.limits);
  const guard = useDispatch(s => s.settings.guard);
  const now = useNow();
  const items = useMemo(() => attentionItems({ sessions, tasks, limits, guard, now, stateOf }), [sessions, tasks, limits, guard, now]);

  // null until the first snapshot: what is already on screen when the tab opens does not ring.
  const prev = useRef<Set<string> | null>(null);
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    if (!ready) return;
    const names = new Map(sessions.map(s => [s.id, s.name]));
    const cands = alertCandidates(items, now, id => names.get(id));
    const { fire, active } = nextAlerts(prev.current ?? new Set(cands.map(c => c.key)), cands);
    prev.current = active;
    if (!fire.length || !alertsOn()) return;
    for (const a of fire) {
      try {
        const n = new Notification(a.title, { body: a.body, tag: a.key });
        n.onclick = () => { window.focus(); if (a.sessionId) open.current(a.sessionId); n.close(); };
      } catch { /* some browsers only allow notifications from a service worker */ }
    }
  }, [ready, items, now, sessions]);

  return null;
}
