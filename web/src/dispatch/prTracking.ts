// PR/CI tracking switch logic used by the workspace settings (#425), over the
// /api/workspace/pr-tracking route. Framework-free so it is unit-tested without a DOM (test/web/pr-tracking.test.ts);
// the React hook is in usePrTracking.ts.
import { api, ApiError } from '../api.ts';
import type { StatusLine } from '../statusLine.ts';

/** null: loading. 'unsupported': this server has no such route. { broken }: settings file unreadable (409). */
export type PrState = boolean | null | 'unsupported' | { broken: string };

export type PrClient = Pick<typeof api, 'prTracking' | 'setPrTracking'>;

export function createPrTracking(opts: { status: StatusLine; onState: (s: PrState) => void; client?: PrClient; savedNote?: string }) {
  const { status, onState, client = api, savedNote = '저장했어요.' } = opts;
  let state: PrState = null;
  let seq = 0;
  let alive = true;
  const set = (s: PrState) => {
    state = s;
    onState(s);
  };
  const broken = () => typeof state === 'object' && state !== null;
  return {
    attach() {
      alive = true;
    },
    dispose() {
      alive = false;
    },
    async load() {
      const mine = ++seq;
      try {
        const r = await client.prTracking();
        if (alive && mine === seq) set(r.on);
      } catch (e) {
        if (alive && mine === seq) set(e instanceof ApiError && e.status === 409 ? { broken: e.message } : 'unsupported');
      }
    },
    // An unreadable settings file shows its cause and keeps the switch enabled; pressing it re-reads the file. A retry
    // that still fails says so in the status line. Responses can arrive out of order: only the newest toggle may touch
    // the state or the status line (#419 items 3/5); a superseded toggle's non-409 error is carried (see statusLine.ts).
    async toggle(on: boolean) {
      const mine = ++seq;
      const wasBroken = broken();
      const ticket = status.begin();
      const stale = () => !alive || mine !== seq;
      try {
        const r = wasBroken ? await client.prTracking() : await client.setPrTracking(on);
        if (stale()) return;
        set(r.on);
        // A silent switch (savedNote '') stays silent on recovery too: its status line is the aria-describedby target.
        status.announce(ticket, wasBroken && savedNote ? '다시 불러왔어요.' : savedNote);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          if (stale()) return;
          set({ broken: e.message });
          // The cause is on its own line; an earlier failure's text must not pile onto it.
          status.dropCarried();
          if (wasBroken) status.announce(ticket, '아직 읽을 수 없어요.');
        } else status.announce(ticket, e instanceof Error ? e.message : '저장하지 못했어요.', true);
      }
    },
  };
}
