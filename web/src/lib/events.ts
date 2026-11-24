// One shared /api/events connection. It opens when the first subscriber arrives and closes when the last one leaves.
// A plain network drop is retried by the browser's own EventSource. A non-200 answer (404, 502 from a restarting
// server) closes the EventSource for good, so then this client opens a new one after a growing delay.

type Source = {
  addEventListener(type: string, fn: (e: Event) => void): void;
  close(): void;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  /** 2 (CLOSED) means the browser gave up and will not retry by itself. */
  readyState?: number;
};

export interface RetryOptions {
  /** First delay before reopening a closed stream, doubled each failed try up to `maxMs`. */
  baseMs?: number;
  maxMs?: number;
}

const CLOSED = 2;

export interface EventsClient {
  /** Calls `fn` with the raw `data` of each event of `type`. Returns the unsubscribe function. */
  subscribe(type: string, fn: (data: string) => void): () => void;
  /** Like `subscribe`, but parses the JSON data; an event that does not parse is skipped. */
  subscribeJson<T>(type: string, fn: (event: T) => void): () => void;
  /**
   * Calls `fn(true)` whenever the stream is open (also right away when it already is, and after every
   * reconnect) and `fn(false)` on an error. Counts as a subscriber while registered.
   */
  onConnection(fn: (online: boolean) => void): () => void;
}

export function createEventsClient(open: () => Source | null, retry: RetryOptions = {}): EventsClient {
  const baseMs = retry.baseMs ?? 1000;
  const maxMs = retry.maxMs ?? 30000;
  let es: Source | null = null;
  let isOpen = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const handlers = new Map<string, Set<(data: string) => void>>();
  const watchers = new Set<(online: boolean) => void>();
  const wired = new Set<string>();

  const count = () => watchers.size + [...handlers.values()].reduce((n, s) => n + s.size, 0);

  const wire = (type: string) => {
    if (!es || wired.has(type)) return;
    wired.add(type);
    es.addEventListener(type, (e) => {
      const data = (e as MessageEvent<string>).data;
      for (const fn of [...(handlers.get(type) ?? [])]) fn(data);
    });
  };

  const drop = () => {
    es?.close();
    es = null;
    isOpen = false;
    wired.clear();
  };

  const ensure = () => {
    if (es || timer) return;
    const src = open();
    if (!src) return;
    es = src;
    src.onopen = () => {
      if (es !== src) return;
      attempt = 0;
      isOpen = true;
      for (const fn of [...watchers]) fn(true);
    };
    src.onerror = () => {
      if (es !== src) return;
      isOpen = false;
      for (const fn of [...watchers]) fn(false);
      if (src.readyState !== CLOSED) return;
      drop();
      const delay = Math.min(baseMs * 2 ** attempt, maxMs);
      attempt++;
      timer = setTimeout(() => {
        timer = null;
        if (count() > 0) ensure();
      }, delay);
    };
    for (const type of handlers.keys()) wire(type);
  };

  const release = () => {
    if (count() > 0) return;
    if (timer) clearTimeout(timer);
    timer = null;
    attempt = 0;
    drop();
  };

  const subscribe = (type: string, fn: (data: string) => void) => {
    let set = handlers.get(type);
    if (!set) handlers.set(type, (set = new Set()));
    set.add(fn);
    ensure();
    wire(type);
    return () => {
      set.delete(fn);
      if (set.size === 0 && handlers.get(type) === set) handlers.delete(type);
      release();
    };
  };

  return {
    subscribe,
    subscribeJson: <T>(type: string, fn: (event: T) => void) =>
      subscribe(type, (data) => {
        let e: T;
        try {
          e = JSON.parse(data) as T;
        } catch {
          return;
        }
        fn(e);
      }),
    onConnection(fn) {
      watchers.add(fn);
      ensure();
      if (isOpen) fn(true);
      return () => {
        watchers.delete(fn);
        release();
      };
    },
  };
}

/** The app's one client. Without EventSource (old runtime, tests) subscribing does nothing. */
export const events: EventsClient = createEventsClient(() =>
  typeof EventSource === 'undefined' ? null : (new EventSource('/api/events') as unknown as Source),
);
