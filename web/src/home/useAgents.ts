// Live list of agent sessions in the workspace: the first answer of GET /api/workspace/agents, then every `agents`
// snapshot on the shared event stream; a reconnect asks again so nothing is missed while the stream was down.
// null while loading; 'off' when this server has no agent feed (older server); 'failed' when the request failed
// (network or server error), so the panel says it could not load instead of "no agents" and offers a retry.
import { useCallback, useEffect, useState } from 'react';
import { events } from '../lib/events';
import { parseAgents, type AgentPresence } from './agents';

export type AgentsState = AgentPresence[] | 'off' | 'failed' | null;

export function useAgents(): { agents: AgentsState; retry: () => void } {
  const [agents, setAgents] = useState<AgentsState>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setAgents((old) => (old === 'failed' ? null : old));
    setAttempt((n) => n + 1);
  }, []);
  useEffect(() => {
    const ctl = new AbortController();
    let streamed = false; // an event already came in: a late GET answer must not roll it back
    const load = () =>
      void fetch('/api/workspace/agents', { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : r.status === 404 ? 'off' : 'failed'))
        .catch(() => 'failed' as const)
        .then((d) => {
          if (ctl.signal.aborted || streamed) return;
          // A failed request never hides a list already shown; with nothing shown yet it is an error, not "no agents".
          if (d === 'off' || d === 'failed') setAgents((old) => (Array.isArray(old) ? old : d));
          else setAgents(parseAgents(d));
        });
    load();
    const offAgents = events.subscribeJson<unknown>('agents', (e) => {
      streamed = true;
      setAgents(parseAgents(e));
    });
    let first = true;
    const offOpen = events.onConnection((online) => {
      if (!online) return;
      if (first) first = false;
      else {
        streamed = false;
        load();
      }
    });
    return () => {
      ctl.abort();
      offAgents();
      offOpen();
    };
  }, [attempt]);
  return { agents, retry };
}
