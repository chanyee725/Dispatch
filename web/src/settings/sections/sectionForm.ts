// The logic of one team-backed 설정 section (관리자와 팀, 작업 폴더, 멈춤 감지; #624), free of React so node --test
// can check it. A section validates and sends only its own fields (SECTION_FIELDS).
import {
  SECTION_FIELDS,
  TEAM_NUMBERS,
  TEAM_TOGGLES,
  pickTexts,
  readTeamNumbers,
  sameNumber,
  sectionNext,
  teamNumberErrors,
  teamPatch,
  type TeamFormState,
  type TeamNumberField,
  type TeamNumberId,
  type TeamToggleId,
  type TeamValues,
} from '../model.ts';

export type TeamSectionId = 'team' | 'folders' | 'stuck';
export type ToggleField = (typeof TEAM_TOGGLES)[number];

/** The section's number fields and switches, in the order they show. */
export function sectionFields(section: TeamSectionId): { numbers: TeamNumberField[]; toggles: ToggleField[] } {
  const f = SECTION_FIELDS[section]!;
  return { numbers: TEAM_NUMBERS.filter((n) => f.numbers.includes(n.id)), toggles: TEAM_TOGGLES.filter((t) => f.toggles.includes(t.id)) };
}

/** Whether this section's fields differ from the saved values (unsaved input, valid or not; #638). */
export function sectionDirty(saved: TeamValues, form: TeamFormState, section: TeamSectionId): boolean {
  const { numbers, toggles } = sectionFields(section);
  return numbers.some((f) => !sameNumber(form.texts[f.id], saved[f.id])) || toggles.some((f) => form.toggles[f.id] !== saved[f.id]);
}

/** The form with this section's fields back at their defaults; other sections' fields stay as they are. */
export function resetSection(form: TeamFormState, section: TeamSectionId): TeamFormState {
  const { numbers, toggles } = sectionFields(section);
  return {
    ...form,
    texts: { ...form.texts, ...(Object.fromEntries(numbers.map((f) => [f.id, String(f.def)])) as Partial<Record<TeamNumberId, string>>) },
    toggles: { ...form.toggles, ...(Object.fromEntries(toggles.map((f) => [f.id, f.def])) as Partial<Record<TeamToggleId, boolean>>) },
  };
}

export type SectionSave =
  /** Some field is out of range: per-field messages, the first one's id to focus, and the line to show. */
  | { kind: 'invalid'; errors: Partial<Record<TeamNumberId, string>>; first: TeamNumberId; message: string }
  | { kind: 'unchanged' }
  /** `patch` goes to POST /api/settings `team`; `next` is what is saved once it succeeds. */
  | { kind: 'save'; patch: Record<string, unknown>; next: TeamValues };

/** What 저장 does for this section: its fields read and checked, only the changed ones sent. */
export function sectionSave(saved: TeamValues, form: TeamFormState, section: TeamSectionId): SectionSave {
  const fields = SECTION_FIELDS[section]!;
  const texts = pickTexts(form.texts, fields.numbers);
  const errors = teamNumberErrors(texts);
  const nums = readTeamNumbers(texts);
  if ('error' in nums) {
    const first = fields.numbers.find((id) => errors[id])!;
    return { kind: 'invalid', errors, first, message: nums.error };
  }
  const next = sectionNext(saved, form, nums, fields);
  const patch = teamPatch(saved, next);
  return patch ? { kind: 'save', patch, next } : { kind: 'unchanged' };
}
