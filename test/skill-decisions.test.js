// #1056 / #1061: usage rules the user set, kept in the remaining skills and the team rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skill = (name) => readFileSync(new URL(`../plugin/skills/${name}/SKILL.md`, import.meta.url), 'utf8');

// #1061: usage rules the user set, kept in the skills and team rules.
test('atelier-session: perm left to the auto default; handoff to a lead names URL and the API guide', () => {
  const s = skill('atelier-session');
  assert.match(s, /Leave out `perm`: the role default is `auto`/);
  assert.match(s, /the main session writes no code or analysis for it/);
  assert.match(s, /the API guide `plugin\/skills\/atelier-setup\/reference\/api\.md`/);
});

test('team rules: a lead settles should-fixes, nits and follow-ups and reports the outcome', () => {
  const rules = readFileSync(new URL('../plugin/skills/atelier-team/reference/rules.md', import.meta.url), 'utf8');
  assert.match(rules, /A lead settles review should-fixes, nits and whether a follow-up issue is needed on its own, and reports only the outcome/);
});

test('#1061 rule 9: a change fixes every place with the same fact, checked by a whole-document search', () => {
  const rules = readFileSync(new URL('../plugin/skills/atelier-team/reference/rules.md', import.meta.url), 'utf8');
  assert.match(rules, /fix every other place stating the same fact in the same turn, and search the whole document/);
});

test('#1061 rule 10: only the docs session edits documents; the lead manages sessions', async () => {
  const rules = readFileSync(new URL('../plugin/skills/atelier-team/reference/rules.md', import.meta.url), 'utf8');
  assert.match(rules, /edit no code and no documents yourself\. Documents are written and changed only by a `docs` session/);
  const { ROLES } = await import('../server/dispatch/roles.js');
  const role = (id) => ROLES.find((r) => r.id === id);
  assert.match(role('lead').prompt, /코드와 문서는 직접 고치지 않고/);
  assert.match(role("docs").prompt, /README와 CHANGELOG/);
});
