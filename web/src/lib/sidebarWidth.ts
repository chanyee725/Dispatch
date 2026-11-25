// Desktop sidebar width (#934): dragged, keyed or double-clicked on the sidebar's edge, kept in this browser.
// The phone-width drawer (sheet) keeps its own fixed width and ignores this.
import { readSize, RESIZE_STEP, useResizeSize, writeSize } from './resizeSize.ts';

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 264;
/** Arrow-key step; Shift+arrow moves four steps. */
export const SIDEBAR_STEP = RESIZE_STEP;
export const SIDEBAR_WIDTH_KEY = 'drawing:sidebar-width';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** Rounds and clamps to 200–480; anything that is not a finite number falls back to the default. */
export function clampWidth(n: number): number {
  if (!Number.isFinite(n)) return SIDEBAR_DEFAULT;
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n)));
}

/** The saved width, or the default when none is saved, it is not a number, or storage is blocked. */
export function readWidth(s?: Storage | null): number {
  return readSize(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT, clampWidth, s);
}

/** Saves the width; a full or blocked storage is ignored (the width still applies for this page). */
export function writeWidth(width: number, s?: Storage | null): void {
  writeSize(SIDEBAR_WIDTH_KEY, clampWidth(width), s);
}

/** The width after a key on the edge handle, or null for keys the handle does not use. */
export function keyWidth(width: number, key: string, shift = false): number | null {
  const step = shift ? SIDEBAR_STEP * 4 : SIDEBAR_STEP;
  switch (key) {
    case 'ArrowLeft':
      return clampWidth(width - step);
    case 'ArrowRight':
      return clampWidth(width + step);
    case 'Home':
      return SIDEBAR_DEFAULT;
    default:
      return null;
  }
}

/** `preview` moves the edge while dragging; `commit` also saves it. */
export function useSidebarWidth() {
  const { size: width, preview, commit } = useResizeSize(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT, clampWidth);
  return { width, preview, commit };
}
