import { useEffect, useMemo, useRef, useState } from "react";
import { alertCandidates, badgeTitle, nextAlerts } from "@/lib/alerts";
import { attentionItems } from "@/lib/attention";
import { stateOf } from "@/lib/format";
import { alertsOn } from "@/lib/notify";
import { useApp } from "@/store";

/**
 * Keeps the tab title at "(N) Dispatch" with the 확인 필요 count, and raises a browser notification
 * for the four alert reasons (see lib/alerts). Renders nothing.
 */
export function AlertWatcher({ onOpen }: { onOpen: (id: string) => void }) {
  const ready = useApp(s => s.ready);
  const sessions = useApp(s => s.sessions);
  const tasks = useApp(s => s.tasks ?? []);
  const limits = useApp(s => s.limits);
  const guard = useApp(s => s.settings.guard);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);

  const items = useMemo(() => attentionItems({ sessions, tasks, limits, guard, now, stateOf }), [sessions, tasks, limits, guard, now]);

  useEffect(() => { document.title = badgeTitle(ready ? items.length : 0); }, [ready, items.length]);

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
      } catch { /* some browsers only allow notifications from a service worker; the badge still counts */ }
    }
  }, [ready, items, now, sessions]);

  return null;
}
