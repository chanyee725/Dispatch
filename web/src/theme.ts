import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
/**
 * What the user picked: a fixed theme, follow the system (stored as no entry), or 모니터링 — Dispatch's dark-first
 * theme: it renders as dark (data-theme="dark", so canvas and dark: variants follow) plus html.monitor for its tokens.
 */
export type ThemePref = Theme | 'system' | 'monitor';
const KEY = 'drawing.theme';
const QUERY = '(prefers-color-scheme: dark)';

// 모니터링 is no longer offered (user, 2026-11-16): a stored 'monitor' choice falls back to 시스템.
const parsePref = (s: string | null): ThemePref => (s === 'light' || s === 'dark' ? s : 'system');

type Snapshot = { theme: Theme; pref: ThemePref; system: Theme };

// One module-level store, so every useTheme() caller (App, DispatchApp, …) reads and writes the same state. Only the
// store touches html[data-theme], html.monitor and localStorage, so no caller can reapply a stale choice (#612).
let snap: Snapshot | null = null;
const listeners = new Set<() => void>();
let detach: (() => void) | null = null;

const readSystem = (): Theme => (matchMedia(QUERY).matches ? 'dark' : 'light');
const readPref = (): ThemePref => {
  try {
    return parsePref(localStorage.getItem(KEY));
  } catch {
    return 'system'; // storage blocked
  }
};
const make = (pref: ThemePref, system: Theme): Snapshot => ({ pref, system, theme: pref === 'system' ? system : pref === 'monitor' ? 'dark' : pref });

const applyDom = (s: Snapshot) => {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.classList.toggle('monitor', s.pref === 'monitor');
};

const current = (): Snapshot => {
  if (!snap) {
    snap = make(readPref(), readSystem());
    applyDom(snap);
  }
  return snap;
};

const update = (pref: ThemePref, system: Theme) => {
  const prev = current();
  if (prev.pref === pref && prev.system === system) return;
  snap = make(pref, system);
  applyDom(snap);
  for (const l of [...listeners]) l();
};

/** Picks a theme for every caller and stores it ('system' stores nothing). */
export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
  update(pref, current().system);
}

/** Flips light/dark; when the target is what the system shows, it follows the system instead of storing a fixed theme. */
export function toggleTheme() {
  const { theme, system } = current();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  setThemePref(next === system ? 'system' : next);
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!detach) {
    const mq = matchMedia(QUERY);
    const onScheme = () => update(current().pref, mq.matches ? 'dark' : 'light');
    // Another tab changed the choice: follow it (the event never fires in the tab that wrote it).
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) update(parsePref(e.newValue), current().system);
    };
    mq.addEventListener('change', onScheme);
    addEventListener('storage', onStorage);
    detach = () => {
      mq.removeEventListener('change', onScheme);
      removeEventListener('storage', onStorage);
    };
    onScheme(); // the scheme may have changed while nobody listened
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && detach) {
      detach();
      detach = null;
    }
  };
}

/** Test only: forget the store so the next read starts from storage and the media query again. */
export function resetThemeStore() {
  detach?.();
  detach = null;
  listeners.clear();
  snap = null;
}

export const themeStore = { subscribe, getSnapshot: current };

/** [theme in effect, toggle light/dark, preference, set preference, system scheme]. 'system' follows prefers-color-scheme live. */
export function useTheme() {
  const { theme, pref, system } = useSyncExternalStore(subscribe, current);
  return [theme, toggleTheme, pref, setThemePref, system] as const;
}
