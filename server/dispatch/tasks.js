/**
 * Stage history of a board task: `stages` is a list of { stage, at } — metadata only, no
 * transcript text. The UI (TaskBoard) turns it into time per stage (mini bars) and "테스트 단계 12분째".
 */
const MAX_STAGES = 40;

/** Moves `t` to `stage` at `at`, recording the entry. Older tasks without history get a seed entry. */
export function enterStage(t, stage, at = Date.now()) {
  if (!Array.isArray(t.stages)) t.stages = t.stage ? [{ stage: t.stage, at: t.stageAt ?? t.createdAt ?? at }] : [];
  t.stage = stage;
  t.stageAt = at;
  t.stages.push({ stage, at });
  if (t.stages.length > MAX_STAGES) t.stages.splice(0, t.stages.length - MAX_STAGES);
  return t;
}

/** Stages a default ETA is estimated for; done and blocked have no time left to guess. */
const ESTIMATED = new Set(["plan", "impl", "review", "test", "merge"]);
const RECENT = 20;

/**
 * Median minutes the finished tasks in `tasks` spent in `stage` (#1028): each visit lasts from its entry to the
 * next entry in `stages`. Only tasks closed with a confirmed merge count, and a visit under a minute (moved on in
 * the same turn) is left out. Uses the latest RECENT visits; null when there are none or the stage gets no estimate.
 */
export function stageMedianMinutes(tasks, stage) {
  if (!ESTIMATED.has(stage)) return null;
  const visits = [];
  for (const t of tasks || []) {
    if (t?.stage !== "done" || t.mergeCheck?.ok !== true || !Array.isArray(t.stages)) continue;
    for (let i = 0; i < t.stages.length - 1; i++) {
      const a = t.stages[i], b = t.stages[i + 1];
      if (a.stage !== stage || !(b.at - a.at >= 60_000)) continue;
      visits.push({ at: a.at, ms: b.at - a.at });
    }
  }
  if (!visits.length) return null;
  const ms = visits.sort((x, y) => y.at - x.at).slice(0, RECENT).map(v => v.ms).sort((x, y) => x - y);
  const mid = ms.length >> 1;
  const med = ms.length % 2 ? ms[mid] : (ms[mid - 1] + ms[mid]) / 2;
  return Math.max(1, Math.round(med / 60_000));
}

/**
 * After `t` entered a new stage without `eta_minutes` (#1028): an ETA the lead set that is still ahead stays;
 * otherwise etaAt becomes the stage median of finished tasks, flagged `etaEstimated`, or null without history.
 */
export function defaultEta(t, tasks, now = Date.now()) {
  if (t.etaAt && !t.etaEstimated && t.etaAt > now) return t;
  const min = stageMedianMinutes(tasks, t.stage);
  t.etaAt = min == null ? null : now + min * 60_000;
  t.etaSetAt = t.etaAt ? now : null;
  t.etaEstimated = min != null;
  return t;
}
