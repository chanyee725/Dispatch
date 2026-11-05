// State history for the session timeline. Only `[at, state]` pairs are kept — a timestamp and a state
// code from server/state.js STATES — never message text, tokens or account data.
// Pure, so the server (recording, trimming) and the browser (drawing spans) share it.

export const HISTORY_MAX = 200;
export const WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Appends `state` at `at` when it differs from the last entry, dropping the oldest entries past `max`.
 * Mutates and returns `history` (an array of `[at, state]`).
 */
export function recordState(history, state, at, max = HISTORY_MAX) {
  const last = history[history.length - 1];
  if (last && last[1] === state) return history;
  // Clocks can step back (NTP); keep the history ordered so spans never run backwards.
  history.push([last ? Math.max(at, last[0]) : at, state]);
  if (history.length > max) history.splice(0, history.length - max);
  return history;
}

/**
 * The entries that matter for a window ending at `now`: the last one at or before the window start
 * (the state the row opens with) and every one after it.
 */
export function trimToWindow(history, now, windowMs = WINDOW_MS) {
  const start = now - windowMs;
  let i = history.length - 1;
  while (i > 0 && history[i][0] > start) i--;
  return history.slice(Math.max(0, i));
}

/**
 * Spans `{ state, from, to }` covering the window `[now - windowMs, now]`, clipped to it, plus the times
 * a session entered `failed` inside the window (drawn as ticks). Nothing before the first entry: a
 * session that started inside the window has an empty stretch on its left.
 */
export function windowSpans(history, now, windowMs = WINDOW_MS) {
  const start = now - windowMs;
  const spans = [];
  const fails = [];
  for (let i = 0; i < history.length; i++) {
    const [at, state] = history[i];
    const next = i + 1 < history.length ? history[i + 1][0] : now;
    if (state === "failed" && at >= start && at <= now) fails.push(at);
    const from = Math.max(at, start);
    const to = Math.min(next, now);
    if (to <= from) continue;
    const prev = spans[spans.length - 1];
    if (prev && prev.state === state && prev.to === from) prev.to = to;
    else spans.push({ state, from, to });
  }
  return { spans, fails };
}
