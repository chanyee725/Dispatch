// Which agent's live view is open (E559, #728; docs/design/agent-live-view.md §5). A tiny module store, so the
// sidebar, the document margin, the board and the diagram overlay can all call openAgentLive() without a provider.
// The open sid is mirrored into the URL hash (`#file=…&agent=<sid>`, or `#agent=<sid>` with no file) with
// replaceState, so a reload keeps the panel. The sid is an opaque hub id: no personal data in the URL.
import { useSyncExternalStore } from 'react';
import { returnToOrigin } from './origin.ts';

export type LiveFrom = 'sidebar' | 'doc' | 'board' | 'node' | 'palette' | 'sheet';

const AGENT_RE = /(?:^#|&)agent=([^&]*)/;

/** The `agent=` value of a hash, or null. */
export function agentFromHash(hash: string): string | null {
  const m = AGENT_RE.exec(hash);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** The hash with its `agent=` part set to `sid` (null drops it); every other part is kept. */
export function withAgent(hash: string, sid: string | null): string {
  const parts = hash.replace(/^#/, '').split('&').filter((p) => p && !p.startsWith('agent='));
  if (sid) parts.push(`agent=${encodeURIComponent(sid)}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

let target: string | null = null;
let trigger: HTMLElement | null = null;
/** The path the panel head shows before the agent's name (#942), e.g. ['대시보드', '실행 중인 세션']. */
let trail: readonly string[] = [];
let hashRead = false;
let sheets = 0;
const subs = new Set<() => void>();
const notify = () => {
  for (const f of subs) f();
};

function writeHash(sid: string | null) {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  const next = withAgent(hash, sid);
  if (next === hash) return;
  window.history.replaceState(window.history.state ?? { drawing: 1 }, '', `${pathname}${search}${next}`);
}

/** Reads `agent=` from the address bar once, so a reload reopens the panel, then follows it on `hashchange`. */
function readHashOnce() {
  if (hashRead || typeof window === 'undefined') return;
  hashRead = true;
  const sid = agentFromHash(window.location.hash);
  if (sid && !target) target = sid;
  window.addEventListener('hashchange', followHash);
}

/**
 * Back/forward or a hash typed into the address bar: the panel follows the `agent=` part (gone → closes, another sid
 * → shows it). Never writes the hash itself (the hash already says it, and replaceState fires no `hashchange`), so
 * this cannot loop.
 */
export function followHash(): void {
  const sid = agentFromHash(window.location.hash);
  if (sid === target) return;
  // Gone: close as the close button does (the hash write in it is a no-op, the hash has no agent= any more).
  if (!sid) return closeAgentLive();
  target = sid;
  trigger = null;
  trail = [];
  notify();
}

/** Opens the live view of `sid`. Opening the one already open closes it (a toggle from the same trigger). */
export function openAgentLive(sid: string, opts: { trigger?: HTMLElement | null; from?: LiveFrom; trail?: readonly string[] } = {}): void {
  readHashOnce();
  if (!sid) return;
  if (target === sid && opts.from !== 'sheet') return closeAgentLive();
  target = sid;
  trigger = opts.trigger !== undefined ? opts.trigger : (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  trail = opts.trail ?? [];
  writeHash(sid);
  notify();
}

/**
 * Closes the panel and gives focus back to the trigger that opened it (when it is still on the page): scrolled into
 * view when off screen, and its card flashes once (#942, origin.ts).
 */
export function closeAgentLive(): void {
  if (!target) return;
  target = null;
  const back = trigger;
  trigger = null;
  trail = [];
  writeHash(null);
  notify();
  if (back?.isConnected) requestAnimationFrame(() => returnToOrigin(back));
}

const subscribe = (f: () => void) => {
  readHashOnce();
  subs.add(f);
  return () => void subs.delete(f);
};
const read = () => target;
const readTrail = () => trail;
const readSheets = () => sheets > 0;

/** Which sid is open (for aria-expanded on triggers), null when closed. */
export const useAgentLiveTarget = () => useSyncExternalStore(subscribe, read, read);
/** The open panel's path (empty when opened from somewhere without one, e.g. a reload or the address bar). */
export const useAgentLiveTrail = () => useSyncExternalStore(subscribe, readTrail, readTrail);

/**
 * A modal session sheet (SessionSheet) is open: the panel hides under it and shows again when it closes.
 * Returns the function that marks it closed.
 */
export function holdForSheet(): () => void {
  sheets++;
  notify();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    sheets--;
    notify();
  };
}

export const useSheetOpen = () => useSyncExternalStore(subscribe, readSheets, readSheets);

/** Tests only. */
export function resetLiveStore() {
  target = null;
  trigger = null;
  trail = [];
  hashRead = true;
  sheets = 0;
  notify();
}
