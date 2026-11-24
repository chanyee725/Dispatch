// Dispatch screen state: one external store fed by the /api/events stream, read with useDispatch(selector).
// Transcripts stay in this tab's memory; nothing here writes to storage.
import { useSyncExternalStore } from 'react';
import { events } from '../lib/events.ts';
import type { DispatchState, BoardTask, Ticket } from './types';
import type { Entry, Limits, Provider, ProviderStatus, Session, Settings, Snapshot } from '../../../shared/dispatch/types.ts';

const initial = (): DispatchState => ({
  ready: false, online: false, unavailable: false, transcripts: {}, tasks: [], tickets: [],
  project: { name: '', path: '', branch: null }, roles: [], perms: [], models: [],
  providers: {} as Record<Provider, ProviderStatus>,
  limits: { five: null, seven: null, fable: null, fiveReset: null, sevenReset: null, fableReset: null, updatedAt: null },
  settings: { guard: { enabled: true, five: 0.9, seven: 0.85 }, team: { rotateLead: 5, rotateOthers: 10, ctxHandoff: 70, handoffMTokens: 15, maxChildren: 8, replyStyle: true, shareDeps: true, dropWorktrees: true, autoRemoveDone: true, autoRotateLong: true, autoRemoveGraceSec: 120, roleModels: {} } },
  sessions: [],
});

let state = initial();
const listeners = new Set<() => void>();

export function setState(patch: Partial<DispatchState>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useDispatch<T>(select: (s: DispatchState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
export const getState = () => state;
/** Tests only: back to the empty state. */
export const resetState = () => { state = initial(); gone.clear(); loading.clear(); pending = null; };

/** JSON request to the Dispatch API. Writes carry x-drawing: 1 (server/app.js rejects them otherwise). */
export async function api<T = unknown>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    signal,
    headers: { 'content-type': 'application/json', ...(method === 'GET' ? {} : { 'x-drawing': '1' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  // `status` lets a caller tell a missing session (404) from a passing failure.
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error || `HTTP ${res.status}`), { status: res.status });
  return data as T;
}

// Live messages that arrived while a session's transcript request was in flight, per session id.
// Only the latest request for an id owns its buffer; an older answer is dropped.
const loading = new Map<string, { buf: Entry[] }>();

/** Loaded history plus the live entries it does not have yet (by id; entries without one by content). */
export function mergeEntries(loaded: Entry[], live: Entry[]): Entry[] {
  const key = (e: Entry) => (e.id !== undefined ? `#${e.id}` : `${e.at}|${e.kind}|${e.name ?? ''}|${e.text}`);
  const seen = new Set(loaded.map(key));
  const out = [...loaded];
  for (const e of live) {
    const k = key(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

export async function loadTranscript(id: string) {
  const mine = { buf: [] as Entry[] };
  loading.set(id, mine);
  try {
    const res = await api<{ messages: Entry[] }>('GET', `/api/sessions/${encodeURIComponent(id)}/messages`);
    if (loading.get(id) !== mine || gone.has(id)) return;
    setState({ transcripts: { ...state.transcripts, [id]: mergeEntries(res.messages, mine.buf) } });
  } finally {
    if (loading.get(id) === mine) loading.delete(id);
  }
}

/** Drops a closed session's transcript from memory. */
export function forgetTranscript(id: string) {
  if (!(id in state.transcripts)) return;
  const { [id]: _, ...rest } = state.transcripts;
  setState({ transcripts: rest });
}

// Ids removed in this page's lifetime: a late update for one of them must not bring it back.
const gone = new Set<string>();

/** The one /api/state fetch whose answer may still be applied, and the stream events seen since it started. */
type Pending = { streamed: boolean; slices: Set<keyof DispatchState>; sessions: Map<string, Session> };
let pending: Pending | null = null;

const SLICE: Record<string, keyof DispatchState> = { tasks: 'tasks', tickets: 'tickets', limits: 'limits', settings: 'settings', providers: 'providers' };

/** Applies one SSE event to the state. Exported so tests can drive it without a server. */
export function apply(ev: string, d: unknown) {
  if (pending) {
    if (ev === 'snapshot') pending.streamed = true;
    else if (ev === 'session') pending.sessions.set((d as Session).id, d as Session);
    else if (SLICE[ev]) pending.slices.add(SLICE[ev]);
  }
  switch (ev) {
    case 'snapshot': {
      const snap = d as Snapshot;
      setState({ ...snap, sessions: snap.sessions.filter(s => !gone.has(s.id)), ready: true, online: true });
      break;
    }
    case 'session': {
      const s = d as Session;
      if (gone.has(s.id)) return;
      const i = state.sessions.findIndex(x => x.id === s.id);
      setState({ sessions: i >= 0 ? state.sessions.map(x => (x.id === s.id ? s : x)) : [s, ...state.sessions] });
      break;
    }
    case 'removed': {
      const { id } = d as { id: string };
      gone.add(id);
      loading.delete(id);
      const { [id]: _, ...transcripts } = state.transcripts;
      setState({ sessions: state.sessions.filter(s => s.id !== id), transcripts });
      break;
    }
    case 'message': {
      const { id, entry } = d as { id: string; entry: Entry };
      loading.get(id)?.buf.push(entry);
      const cur = state.transcripts[id];
      if (cur) setState({ transcripts: { ...state.transcripts, [id]: [...cur, entry] } });
      break;
    }
    case 'tasks': setState({ tasks: d as BoardTask[] }); break;
    case 'tickets': setState({ tickets: d as Ticket[] }); break;
    case 'limits': setState({ limits: d as Limits }); break;
    case 'settings': setState({ settings: d as Settings }); break;
    case 'providers': setState({ providers: d as Record<Provider, ProviderStatus> }); break;
  }
}

/** Events this store listens to. */
export const EVENTS = ['snapshot', 'session', 'removed', 'message', 'tasks', 'tickets', 'limits', 'settings', 'providers'] as const;

/**
 * Applies a fetched /api/state answer without undoing what the stream said while the fetch was in flight:
 * slices updated by an event keep their live value, sessions seen in an event win, removed ids stay out.
 */
function applyFetched(snap: Snapshot, p: Pending) {
  const patch: Partial<DispatchState> = { ...snap, ready: true };
  for (const k of p.slices) delete patch[k];
  const listed = new Set(snap.sessions.map(s => s.id));
  const added = [...p.sessions.values()].filter(s => !listed.has(s.id)).reverse();
  patch.sessions = [...added, ...snap.sessions.map(s => p.sessions.get(s.id) ?? s)].filter(s => !gone.has(s.id));
  setState(patch);
}

/** Opens the event stream; returns a close function. A server without Dispatch marks the screen unavailable. */
export function connect(): () => void {
  // The shared stream may already be open (another listener holds it), and the server only sends a snapshot to a
  // new connection, so every subscribe, and every reconnect after a drop, fetches /api/state. Only the latest fetch
  // of a still-open connect counts, and a stream snapshot that arrives first makes it moot.
  // If Dispatch is off the state route 404s and nothing ever arrives.
  let closed = false;
  let mine: Pending | null = null;
  const refresh = () => {
    const p: Pending = { streamed: false, slices: new Set(), sessions: new Map() };
    pending = mine = p;
    api<Snapshot>('GET', '/api/state').then(
      snap => {
        if (closed || pending !== p) return;
        pending = null;
        if (!p.streamed) applyFetched(snap, p);
      },
      () => {
        if (closed || pending !== p) return;
        pending = null;
        if (!state.ready) setState({ unavailable: true });
      },
    );
  };
  let dropped = false;
  const offs = EVENTS.map(ev => events.subscribeJson<unknown>(ev, d => apply(ev, d)));
  offs.push(events.onConnection(online => {
    setState({ online });
    if (online && dropped) refresh();
    dropped = !online;
  }));
  refresh();
  return () => {
    closed = true;
    if (pending === mine) pending = null;
    offs.forEach(off => off());
  };
}
