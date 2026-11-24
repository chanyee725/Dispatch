import { createContext, useContext, useEffect } from 'react';
import type { SettingsLoad } from './model';

/** Window event fired after a model connect, cancel or disconnect, so the sidebar rows reload at once. */
export const MODELS_CHANGED = 'drawing:models-changed';

/**
 * What the 설정 modal knows about the session settings, for the prop-less section components (#624): `load` says
 * whether they are in, off (with the reason) or failed, `retry` reconnects the session stream after a failure, and
 * `markDirty` tells the modal which parts hold unsaved input, so closing it asks first (#638).
 */
export type SettingsCtx = { load: SettingsLoad; retry: () => void; markDirty: (key: string, dirty: boolean) => void };
export const SettingsContext = createContext<SettingsCtx>({ load: { kind: 'loading' }, retry: () => {}, markDirty: () => {} });
export const useSettingsLoad = () => useContext(SettingsContext);

/**
 * Whether this section is the one shown (#639). The modal keeps every section mounted so unsaved edits survive
 * switching; a section that fetches on its own waits until it is shown. Outside the modal it is always shown.
 */
export const SectionShownContext = createContext(true);
export const useSectionShown = () => useContext(SectionShownContext);

/** Report whether this part of the 설정 modal holds unsaved input; cleared when it unmounts. */
export function useDirtyMark(key: string, dirty: boolean) {
  const { markDirty } = useContext(SettingsContext);
  useEffect(() => {
    markDirty(key, dirty);
    return () => markDirty(key, false);
  }, [key, dirty, markDirty]);
}
