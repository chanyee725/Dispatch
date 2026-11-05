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

