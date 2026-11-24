// Usage per provider (E545, #685), shared by the sidebar usage card (E548, #698). Every source is one the app
// already reads elsewhere; nothing new on the server, nothing stored. Metadata only: usage percentages.
//   - GET /api/limits + GET /api/state providers (same as 설정 > 사용 한도, #676)
// Reloads every 30 s while the page is visible, and at once when the server pushes `limits` or `providers`. The last
// result is kept for the page (#705): the sidebar card mounts on every hover and starts from it, with no loading jump.
import { useEffect, useState } from 'react';
import { api, type ProviderLimits, type ProviderState } from '../api';
import { events } from './events';
import { lastValue } from './lastValue';
import { usageGroups, type UsageEntry, type UsageGroup } from '../settings/model';
import { pollWhileVisible } from '../home/model';

const POLL_MS = 30_000;
/** With nothing to show after a failed read, try again this soon instead of waiting for the next poll (#705). */
const RETRY_MS = 5_000;
const kept = lastValue<UsageGroup[]>();

/** Connected providers with their usage windows; null while loading, 'failed' when either request failed. */
export function useUsage(): UsageGroup[] | 'failed' | null {
  const [groups, setGroups] = useState<UsageGroup[] | 'failed' | null>(kept.get);
  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void Promise.all([api.limits(), api.providers()]).then(
        ([l, p]: [ProviderLimits, Record<string, ProviderState>]) => {
          const next = kept.put(usageGroups(l as Record<string, UsageEntry>, p));
          if (live) setGroups(next);
        },
        () => {
          const next = kept.put('failed');
          if (!live) return;
          setGroups(next);
          clearTimeout(retry);
          if (next === 'failed') retry = setTimeout(load, RETRY_MS);
        },
      );
    const stop = pollWhileVisible(load, POLL_MS);
    const offs = [events.subscribe('limits', load), events.subscribe('providers', load)];
    return () => {
      live = false;
      clearTimeout(retry);
      stop();
      offs.forEach((off) => off());
    };
  }, []);
  return groups;
}
