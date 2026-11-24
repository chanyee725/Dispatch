// Live branch rows (#792) from GET /api/branches/live and the commit tree (#877) from GET /api/branches/tree: polled
// while the page is visible and reloaded soon after any session event (a commit, a switch, a finished turn), so the
// view moves without a page reload.
import { useEffect, useState } from 'react';
import { events } from '../lib/events';
import { pollWhileVisible } from '../home/model';
import type { BranchTree, LiveBranches } from './lib/liveBranches.ts';

const POLL_MS = 10_000;
const EVENT_GAP_MS = 5_000;

/** null while the first answer loads, 'failed' when it did not come; a failed reload keeps the answer already shown. */
function useLive<T>(url: string, valid: (d: T) => boolean): T | 'failed' | null {
  const [data, setData] = useState<T | 'failed' | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const load = () =>
      void fetch(url, { signal: ctl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<T>) : null), () => null)
        .then((d) => {
          if (ctl.signal.aborted) return;
          setData((old) => (d && valid(d) ? d : old && old !== 'failed' ? old : 'failed'));
        });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        load();
      }, EVENT_GAP_MS);
    };
    const stop = pollWhileVisible(load, POLL_MS);
    const offs = ['session', 'removed'].map((t) => events.subscribeJson<unknown>(t, soon));
    return () => {
      ctl.abort();
      stop();
      offs.forEach((off) => off());
      if (timer) clearTimeout(timer);
    };
    // `valid` is a module-level function per caller; the url alone decides what loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return data;
}

const liveOk = (d: LiveBranches) => Array.isArray(d.rows);
const treeOk = (d: BranchTree) => Array.isArray(d.commits) && Array.isArray(d.tips);

export const useLiveBranches = () => useLive<LiveBranches>('/api/branches/live', liveOk);
export const useBranchTree = () => useLive<BranchTree>('/api/branches/tree', treeOk);
