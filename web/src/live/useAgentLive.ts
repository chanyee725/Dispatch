// Data for one agent's live view (E559, #728): GET /api/sessions/:id/live once when it opens, then only the `live`
// and `session` events of that sid on the shared stream. Other sids are dropped by a substring test on the raw event text
// before any JSON.parse, so 20 busy agents cost the open panel almost nothing. A reconnect loads it again (events
// sent while the stream was down are gone). Memory only.
import { useCallback, useEffect, useState } from 'react';
import { applyLiveDelta, type AgentLive, type LiveDelta } from '../../../shared/dispatch/live.ts';
import type { Session } from '../../../shared/dispatch/types.ts';
import { events } from '../lib/events.ts';

/**
 * The event as an object when its top-level `key` is `sid`, else null. A plain substring test on the raw text
 * (`"id":"<sid>"`, as the server's JSON.stringify writes it, at any position) drops other agents' events before any
 * JSON.parse; the parsed top-level field then decides, so neither the server's key order nor a nested match counts.
 */
export function eventFor<T extends object>(raw: string, key: 'id' | 'sid', sid: string): T | null {
  if (!raw.includes(`"${key}":${JSON.stringify(sid)}`)) return null;
  try {
    const d = JSON.parse(raw) as Record<string, unknown> | null;
    return d && typeof d === 'object' && d[key] === sid ? (d as T) : null;
  } catch {
    return null;
  }
}

export interface AgentLiveState {
  live: AgentLive | null;
  session: Session | null;
  /** 'missing': the hub does not know this id (removed, or never a session). */
  error: 'missing' | 'failed' | null;
  loading: boolean;
  online: boolean;
  reload(): void;
}

export function useAgentLive(sid: string | null): AgentLiveState {
  const [live, setLive] = useState<AgentLive | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<AgentLiveState['error']>(null);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    setLive(null);
    setSession(null);
    setError(null);
    if (!sid || sid.startsWith('outside:')) {
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    // Deltas that arrive while the GET is in flight are applied on top of its answer.
    let held: LiveDelta[] | null = [];
    const load = () => {
      held = [];
      setLoading(true);
      void fetch(`/api/sessions/${encodeURIComponent(sid)}/live`, { signal: ctl.signal })
        .then(async (r) => {
          if (r.status === 404) return 'missing' as const;
          if (!r.ok) return 'failed' as const;
          return (await r.json()) as { session: Session; live: AgentLive };
        })
        .catch(() => (ctl.signal.aborted ? null : ('failed' as const)))
        .then((d) => {
          if (ctl.signal.aborted || d === null) return;
          setLoading(false);
          const queued = held ?? [];
          held = null;
          if (d === 'missing' || d === 'failed') return setError(d);
          setError(null);
          setSession(d.session);
          setLive(queued.reduce(applyLiveDelta, d.live));
        });
    };
    const offLive = events.subscribe('live', (raw) => {
      const d = eventFor<LiveDelta>(raw, 'sid', sid);
      if (!d) return;
      if (held) held.push(d);
      else setLive((cur) => (cur ? applyLiveDelta(cur, d) : cur));
    });
    const offSession = events.subscribe('session', (raw) => {
      const s = eventFor<Session>(raw, 'id', sid);
      if (s) setSession(s);
    });
    const offRemoved = events.subscribe('removed', (raw) => {
      if (eventFor(raw, 'id', sid)) setError('missing');
    });
    let first = true;
    const offConn = events.onConnection((up) => {
      setOnline(up);
      if (!up) return;
      if (first) first = false;
      else load();
    });
    load();
    return () => {
      ctl.abort();
      offLive();
      offSession();
      offRemoved();
      offConn();
    };
  }, [sid, attempt]);

  return { live, session, error, loading, online, reload };
}
