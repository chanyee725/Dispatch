// Pure helpers shared by the board's cards (no React).
import { whenLabel } from '../lib/when.ts';

/** The app's time label (lib/when.ts); "-" when there is no time. */
export function relativeTime(ms: number, now = Date.now()): string {
  return ms ? whenLabel(ms, now) : '-';
}

type VisibilityDoc = { visibilityState: string; addEventListener: (t: 'visibilitychange', fn: () => void) => void; removeEventListener: (t: 'visibilitychange', fn: () => void) => void };
type Timers = { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (t: unknown) => void };
const realTimers: Timers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (t) => clearInterval(t as number) };

/**
 * Calls `load` now and every `ms` while the page is visible. A hidden page stops the timer; showing it again
 * loads at once and restarts the timer. Returns a stop function.
 */
export function pollWhileVisible(load: () => void, ms: number, doc: VisibilityDoc = document, timers: Timers = realTimers): () => void {
  let timer: unknown = null;
  const start = () => {
    if (timer === null) timer = timers.setInterval(load, ms);
  };
  const stop = () => {
    if (timer !== null) timers.clearInterval(timer);
    timer = null;
  };
  const onChange = () => {
    if (doc.visibilityState === 'visible') {
      load();
      start();
    } else stop();
  };
  if (doc.visibilityState === 'visible') {
    load();
    start();
  }
  doc.addEventListener('visibilitychange', onChange);
  return () => {
    stop();
    doc.removeEventListener('visibilitychange', onChange);
  };
}
