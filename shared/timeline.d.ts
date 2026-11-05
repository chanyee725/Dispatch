export type Entry = [at: number, state: string];
export const HISTORY_MAX: number;
export const WINDOW_MS: number;
export function recordState(history: Entry[], state: string, at: number, max?: number): Entry[];
export function trimToWindow(history: Entry[], now: number, windowMs?: number): Entry[];
export function windowSpans(history: Entry[], now: number, windowMs?: number): {
  spans: { state: string; from: number; to: number }[];
  fails: number[];
};
