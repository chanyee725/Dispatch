// Work lanes (issue #768): how much ceremony a piece of work gets.
//   quickfix  1-3 files. No issue, no plan gate, no reviewer. One implementer, the lead merges.
//   normal    one feature. Implementer + one fresh reviewer, the lead merges.
//   risky     auth, data, delete, structure. Two reviewers; the main session confirms before the merge.
// Metadata only: a lane id rides on sessions and board tasks, nothing else.

export const LANES = ["quickfix", "normal", "risky"];
export const DEFAULT_LANE = "normal";
/** The only roles a quickfix may create: one maker, no lead, reviewer or tester. */
const QUICKFIX_ROLES = new Set(["impl", "design", "docs"]);

const bad = msg => Object.assign(new Error(msg), { status: 400 });

/** A lane id from user input: undefined stays undefined, a known id passes, anything else is a 400. */
export function checkLane(lane) {
  if (lane === undefined || lane === null || lane === "") return undefined;
  if (!LANES.includes(lane)) throw bad(`lane은 ${LANES.join(", ")} 중 하나예요`);
  return lane;
}

/**
 * create_sessions items under a lane. Quickfix is exactly one session (impl, design or docs) and defaults to the
 * quickfix mode; the other lanes leave items as they are. Returns new items, each carrying its lane.
 */
export function laneItems(items, lane, mode) {
  lane = checkLane(lane);
  if (!lane) return items;
  if (lane === "quickfix") {
    const total = items.reduce((a, it) => a + (it.n || 1), 0);
    if (total !== 1) throw bad(`quickfix는 세션 하나예요(지금 ${total}개). 더 필요하면 lane: normal로 만드세요`);
    if (!QUICKFIX_ROLES.has(items[0].role)) throw bad(`quickfix 세션은 구현자·디자이너·문서화 중 하나예요(${String(items[0].role).slice(0, 30)}). 리뷰가 필요하면 lane: normal로 만드세요`);
  }
  return items.map(it => ({ ...it, lane, ...(lane === "quickfix" && !it.mode && !mode && { mode: "quickfix" }) }));
}

/** How many past runs per lane are kept for ETA hints. */
export const RUN_TIMES_MAX = 60;

/** Appends one finished run ({ lane, minutes, at }) to `list`, oldest dropped past RUN_TIMES_MAX. */
export function recordRunTime(list, { lane, minutes, at = Date.now() }) {
  const out = Array.isArray(list) ? list.slice() : [];
  if (!Number.isFinite(minutes) || minutes < 0) return out;
  out.push({ lane: LANES.includes(lane) ? lane : DEFAULT_LANE, minutes: Math.round(minutes * 10) / 10, at });
  return out.length > RUN_TIMES_MAX ? out.slice(-RUN_TIMES_MAX) : out;
}

/**
 * ETA hint from past runs of the same lane: median and slowest of the last 10, in whole minutes, or
 * null when there are none yet.
 */
export function etaHint(list, lane = DEFAULT_LANE) {
  const mins = (Array.isArray(list) ? list : []).filter(r => r.lane === lane).slice(-10).map(r => r.minutes).sort((a, b) => a - b);
  if (!mins.length) return null;
  const mid = mins.length >> 1;
  const median = mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2;
  return { lane, runs: mins.length, median: Math.round(median), max: Math.round(mins.at(-1)) };
}
