import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals: a controllable prefers-color-scheme query, localStorage and <html>.
const mqListeners = new Set<() => void>();
const mq = { matches: false, addEventListener: (_: string, l: () => void) => mqListeners.add(l), removeEventListener: (_: string, l: () => void) => mqListeners.delete(l) };
const flipScheme = (dark: boolean) => { mq.matches = dark; for (const l of [...mqListeners]) l(); };
const store = new Map<string, string>();
const classes = new Set<string>();
const root = { dataset: {} as Record<string, string>, classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)), contains: (c: string) => classes.has(c) } };
Object.assign(globalThis, {
  matchMedia: () => mq,
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  document: { documentElement: root },
  addEventListener: () => {},
  removeEventListener: () => {},
});

const { themeStore, setThemePref, toggleTheme, resetThemeStore } = await import('../../web/src/theme.ts');

beforeEach(() => {
  resetThemeStore();
  store.clear();
  classes.clear();
  mq.matches = false;
  mqListeners.clear();
});

test('two callers share one state: a sidebar change survives a scheme flip with the Dispatch view mounted (#612)', () => {
  // App and DispatchApp each subscribe, as two useTheme() calls do.
  let appRenders = 0;
  let dispatchRenders = 0;
  const offApp = themeStore.subscribe(() => appRenders++);
  const offDispatch = themeStore.subscribe(() => dispatchRenders++);
  setThemePref('monitor'); // picked in the sidebar
  assert.equal(dispatchRenders, 1, 'the Dispatch caller hears the change in the same tab');
  flipScheme(true);
  flipScheme(false);
  assert.equal(themeStore.getSnapshot().pref, 'monitor');
  assert.equal(root.dataset.theme, 'dark');
  assert.ok(classes.has('monitor'), 'html.monitor stays');
  assert.equal(store.get('drawing.theme'), 'monitor', 'drawing.theme stays');
  assert.ok(appRenders >= 1);
  offApp();
  offDispatch();
  assert.equal(mqListeners.size, 0, 'the last caller leaving detaches the media query');
});

test("system follows the scheme live and stores nothing", () => {
  const off = themeStore.subscribe(() => {});
  setThemePref('light');
  setThemePref('system');
  assert.equal(store.has('drawing.theme'), false);
  flipScheme(true);
  assert.equal(themeStore.getSnapshot().theme, 'dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(classes.has('monitor'), false);
  off();
});

test('toggle stores nothing when the target is the system theme', () => {
  const off = themeStore.subscribe(() => {});
  // System light, showing light: toggling to dark stores dark.
  toggleTheme();
  assert.equal(store.get('drawing.theme'), 'dark');
  // Back to light, which the system shows: follow the system again.
  toggleTheme();
  assert.equal(store.has('drawing.theme'), false);
  assert.equal(themeStore.getSnapshot().pref, 'system');
  assert.equal(root.dataset.theme, 'light');
  off();
});

test('starts from the stored choice', () => {
  store.set('drawing.theme', 'dark');
  const s = themeStore.getSnapshot();
  assert.deepEqual([s.pref, s.theme], ['dark', 'dark']);
});
