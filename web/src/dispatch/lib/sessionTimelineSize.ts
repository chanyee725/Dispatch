import { RESIZE_STEP } from '../../lib/resizeSize.ts';

export const SESSIONS_MIN = 144;
export const TIMELINE_MIN = 136;
export const HANDLE_HEIGHT = 24;
export const DEFAULT_HEIGHT = 320;
export const STORAGE_KEY = 'drawing:board-sessions-height';

export function preferredHeight(height: number) {
  return Number.isFinite(height) ? Math.max(SESSIONS_MIN, Math.round(height)) : DEFAULT_HEIGHT;
}

export function maxSessionHeight(totalHeight: number) {
  return Math.max(SESSIONS_MIN, totalHeight - HANDLE_HEIGHT - TIMELINE_MIN);
}

export function heightForKey(height: number, max: number, key: string, shift = false) {
  const step = shift ? RESIZE_STEP * 4 : RESIZE_STEP;
  switch (key) {
    case 'ArrowUp': return Math.max(SESSIONS_MIN, height - step);
    case 'ArrowDown': return Math.min(max, height + step);
    case 'Home': return SESSIONS_MIN;
    case 'End': return max;
    default: return null;
  }
}
