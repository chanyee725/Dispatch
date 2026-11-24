// One shared model-connection subscription (#616, #625): the sidebar rows, the run view and the 설정 modal all read
// the same GET /api/dispatch answer, provider state and usage, instead of each opening its own polling and fetching
// /api/dispatch again. It starts with the first reader and stops with the last. React-free so node --test can drive
// it with fake requests and events. Status only: no account, email or token reaches here.
import type { DispatchStatus, ProviderLimits, ProviderState } from '../api';

export type ModelsSnapshot = {
  status: DispatchStatus | null;
  /** State per provider id, as the server reports it. */
  providers: Record<string, ProviderState>;
  limits: ProviderLimits;
};

export type ModelsDeps = {
  dispatch: () => Promise<DispatchStatus>;
  providers: () => Promise<Record<string, ProviderState>>;
  limits: () => Promise<ProviderLimits>;
  /** Live events; each returns an unsubscribe. */
  onProviders: (fn: (pv: Record<string, ProviderState>) => void) => () => void;
  onLimits: (fn: () => void) => () => void;
  onConnection: (fn: (up: boolean) => void) => () => void;
  /** Window event fired after a connect, cancel or disconnect (MODELS_CHANGED). */
  onChanged: (fn: () => void) => () => void;
  every: (fn: () => void, ms: number) => () => void;
  /** While a CLI login runs: check back often, give up after a while (pollLogins). Returns a stop function. */
  pollLogins: (load: () => void) => () => void;
};

export type ModelsStore = {
  subscribe: (fn: () => void) => () => void;
  get: () => ModelsSnapshot;
  reload: () => Promise<void>;
};

export const RELOAD_EVERY_MS = 60_000;

export function createModelsStore(deps: ModelsDeps): ModelsStore {
  let snap: ModelsSnapshot = { status: null, providers: {}, limits: {} };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ModelsSnapshot>) => {
    snap = { ...snap, ...patch };
    listeners.forEach((l) => l());
  };
  // One reload at a time; a call while one runs shares it.
  let running: Promise<void> | null = null;
  const reload = () =>
    (running ??= (async () => {
      try {
        const s = await deps.dispatch();
        if (!s.enabled) return set({ status: s });
        const [pv, lim] = await Promise.all([deps.providers(), deps.limits().catch(() => ({}))]);
        set({ status: s, providers: pv, limits: lim });
      } catch {
        set({ status: { enabled: false } });
      } finally {
        running = null;
      }
    })());

  let stop: (() => void) | null = null;
  let stopPoll: (() => void) | null = null;
  const busy = () => Object.values(snap.providers).some((p) => p?.busy);
  // A running login polls as a fallback (the event stream may be down); it stops once no provider is busy.
  const watchBusy = () => {
    if (busy() && !stopPoll) stopPoll = deps.pollLogins(() => void reload());
    else if (!busy() && stopPoll) {
      stopPoll();
      stopPoll = null;
    }
  };
  const start = () => {
    void reload();
    let first = true;
    const offs = [
      deps.every(() => void reload(), RELOAD_EVERY_MS),
      deps.onChanged(() => void reload()),
      deps.onProviders((pv) => pv && typeof pv === 'object' && set({ providers: pv })),
      deps.onLimits(() => void deps.limits().then((limits) => set({ limits }), () => {})),
      // After a dropped connection the events in between are lost: read the state again.
      deps.onConnection((up) => {
        if (up && !first) void reload();
        if (up) first = false;
      }),
    ];
    listeners.add(watchBusy);
    stop = () => {
      offs.forEach((off) => off());
      listeners.delete(watchBusy);
      stopPoll?.();
      stopPoll = null;
    };
  };

  return {
    subscribe(fn) {
      listeners.add(fn);
      if (!stop) start();
      return () => {
        listeners.delete(fn);
        // Only the busy watcher left: nobody reads, so stop.
        if (stop && [...listeners].every((l) => l === watchBusy)) {
          stop();
          stop = null;
        }
      };
    },
    get: () => snap,
    reload,
  };
}
