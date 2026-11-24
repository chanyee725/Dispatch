// Keeps the theme in ~/.dispatch/drawing.json (E555, #724). The browser's own copy (theme.ts, localStorage) still paints
// the first frame; the file then wins once it answers, and a theme picked here is written back to it.
import { api } from './api';
import { themeStore, setThemePref, type ThemePref } from './theme';

type Client = Pick<typeof api, 'userDefaults' | 'setUserDefaults'>;

const FILE_THEMES = new Set<ThemePref>(['system', 'light', 'dark']);

/** Starts the sync once per page; returns a stop function (tests). Fails quietly: an older server has no such route. */
export function startThemeSync(client: Client = api) {
  let last: ThemePref | null = null;
  let stopped = false;
  let unsub: (() => void) | null = null;
  void client
    .userDefaults()
    .then((r) => {
      if (stopped || r.error) return; // a broken file: keep the browser's choice; 설정 shows the error
      const saved = r.values.theme;
      if (saved && FILE_THEMES.has(saved)) setThemePref(saved);
    })
    .catch(() => {})
    .finally(() => {
      if (stopped) return;
      last = themeStore.getSnapshot().pref;
      unsub = themeStore.subscribe(() => {
        const pref = themeStore.getSnapshot().pref;
        if (pref === last || !FILE_THEMES.has(pref)) return;
        last = pref;
        void client.setUserDefaults({ theme: pref as 'system' | 'light' | 'dark' }).catch(() => {});
      });
    });
  return () => {
    stopped = true;
    unsub?.();
  };
}
