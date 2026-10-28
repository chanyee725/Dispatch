import { useSyncExternalStore } from "react";
import type { Entry, Limits, ProviderStatus, Provider, Session, Settings, Snapshot } from "./types";

export interface AppState extends Snapshot {
  ready: boolean;
  online: boolean;
  transcripts: Record<string, Entry[]>;
}

let state: AppState = {
  ready: false, online: false, transcripts: {},
  project: { name: "", path: "", branch: null }, roles: [], perms: [], models: [],
  providers: {} as Record<Provider, ProviderStatus>,
  limits: { five: null, seven: null, fiveReset: null, sevenReset: null, updatedAt: null },
  settings: { guard: { enabled: true, five: 0.9, seven: 0.85 } },
  sessions: [],
};

const listeners = new Set<() => void>();
function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
export const getState = () => state;

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-dispatch": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export async function loadTranscript(id: string) {
  const res = await api<{ messages: Entry[] }>("GET", `/api/sessions/${id}/messages`);
  set({ transcripts: { ...state.transcripts, [id]: res.messages } });
}

export function connect() {
  const es = new EventSource("/api/events");
  const on = <T,>(ev: string, fn: (d: T) => void) => es.addEventListener(ev, e => fn(JSON.parse((e as MessageEvent).data)));

  on<Snapshot>("snapshot", snap => set({ ...snap, ready: true, online: true }));
  on<Session>("session", s => {
    const i = state.sessions.findIndex(x => x.id === s.id);
    const sessions = i >= 0 ? state.sessions.map(x => (x.id === s.id ? s : x)) : [s, ...state.sessions];
    set({ sessions });
  });
  on<{ id: string }>("removed", ({ id }) => set({ sessions: state.sessions.filter(s => s.id !== id) }));
  on<{ id: string; entry: Entry }>("message", ({ id, entry }) => {
    const cur = state.transcripts[id];
    if (cur) set({ transcripts: { ...state.transcripts, [id]: [...cur, entry] } });
  });
  on<Limits>("limits", limits => set({ limits }));
  on<Settings>("settings", settings => set({ settings }));
  on<Record<Provider, ProviderStatus>>("providers", providers => set({ providers }));
  es.onerror = () => set({ online: false });
  es.onopen = () => set({ online: true });
}
