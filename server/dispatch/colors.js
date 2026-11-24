// Agent cursor colours (E56, #249): each session gets one at random when it is created and keeps it, so its cursor
// and name tag look the same for the whole session. The tag has white text: every colour here has a contrast ratio
// of at least 4.5:1 against white (WCAG AA), so one value works on the dark and the light theme. No purple.
// Stored on the session (state.json) as metadata only.
export const AGENT_COLORS = Object.freeze([
  '#1d4ed8', // blue
  '#0369a1', // sky
  '#0f766e', // teal
  '#15803d', // green
  '#4d7c0f', // olive
  '#a16207', // amber
  '#c2410c', // orange
  '#be123c', // red
]);

/** A random palette colour, preferring one no session in `taken` has yet. */
export function pickColor(taken = [], rand = Math.random) {
  const used = new Set(taken);
  const free = AGENT_COLORS.filter((c) => !used.has(c));
  const from = free.length ? free : AGENT_COLORS;
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))];
}
