// Which issue's team panel is open (#925). Same idea as store.ts: a tiny module store so the dashboard card can open
// it without a provider. The team panel hides while a session's live panel is open (one panel at a time) and shows
// again when that closes, so 돌아가기 in the live panel lands back here.
import { useSyncExternalStore } from 'react';
import { returnToOrigin } from './origin.ts';

let target: number | null = null;
let trigger: HTMLElement | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

/** Opens the team panel of issue `n`; the same issue again closes it. */
export function openIssueTeam(n: number, trigger_?: HTMLElement | null): void {
  if (target === n) return closeIssueTeam();
  target = n;
  trigger = trigger_ ?? (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  notify();
}

export function closeIssueTeam(): void {
  if (target == null) return;
  target = null;
  const back = trigger;
  trigger = null;
  notify();
  // Back to the row that opened it: scrolled into view and flashed once (#942).
  if (back?.isConnected) requestAnimationFrame(() => returnToOrigin(back));
}

const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
const read = () => target;
export const useIssueTeamTarget = () => useSyncExternalStore(subscribe, read, read);
