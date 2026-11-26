import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '../../shared/dispatch/types.ts';
import { boardOrganizations } from '../../web/src/dispatch/lib/boardOrganizations.ts';

const member = (id: string, parent: string | null = null, role = 'impl', status: Session['status'] = 'running') =>
  ({ id, n: 1, name: id, parent, role, status });

test('all shows each card once, while manager filters include transitive descendants', () => {
  const lead = member('A', null, 'lead');
  const nestedLead = member('B', lead.id, 'lead');
  const otherLead = member('C', null, 'lead');
  const child = member('child', nestedLead.id);
  const otherChild = member('other', otherLead.id);
  const independent = member('independent');
  const sessions = [child, otherChild, independent, nestedLead, lead, otherLead];
  const { managers, unlinked } = boardOrganizations(sessions, sessions);

  assert.deepEqual(managers, [
    { lead, label: 'A', members: [lead], descendants: [child, nestedLead] },
    { lead: nestedLead, label: 'B', members: [child, nestedLead], descendants: [child] },
    { lead: otherLead, label: 'C', members: [otherChild, otherLead], descendants: [otherChild] },
  ]);
  assert.deepEqual(unlinked, [independent]);
});

test('the full roster supplies ancestry while the groups contain only scoped cards', () => {
  const lead = member('A', null, 'lead');
  const intermediate = { ...member('B', lead.id, 'review'), canSpawn: true };
  const child = member('child', intermediate.id);
  const { managers, unlinked } = boardOrganizations([child], [child, intermediate, lead]);

  assert.deepEqual(managers, [{ lead, label: 'A', members: [child], descendants: [child] }]);
  assert.deepEqual(unlinked, []);
});

test('finished and missing managers drop out, and replacement follows the new parent ID', () => {
  const lead = member('A', null, 'lead');
  const finished = member('B', lead.id, 'lead', 'done');
  const child = member('child', finished.id);
  const emptyLead = member('C', null, 'lead');
  const roster = [lead, finished, child, emptyLead];
  const before = boardOrganizations(roster, roster);

  assert.deepEqual(before.managers, [
    { lead, label: 'A', members: [lead, finished, child], descendants: [finished, child] },
    { lead: emptyLead, label: 'C', members: [emptyLead], descendants: [] },
  ]);

  const removed = boardOrganizations([child, emptyLead], [child, emptyLead]);
  assert.deepEqual(removed.managers.map(({ lead }) => lead.id), [emptyLead.id]);
  assert.deepEqual(removed.unlinked, [child]);

  const replacement = { ...lead, id: 'replacement', n: 2, rotatedFrom: { id: lead.id } };
  const moved = { ...child, parent: replacement.id };
  const reconnected = boardOrganizations([moved, replacement], [moved, replacement]);
  assert.deepEqual(reconnected.managers, [
    { lead: replacement, label: 'A', members: [moved, replacement], descendants: [moved] },
  ]);
  assert.deepEqual(reconnected.unlinked, []);
});

test('duplicate manager names have distinct labels and independent membership', () => {
  const first = { ...member('A', null, 'lead'), name: '팀', canSpawn: false };
  const second = { ...member('B', null, 'lead'), name: first.name, n: 2, canSpawn: true };
  const one = { ...member('one', first.id), canSpawn: false };
  const two = { ...member('two', second.id), canSpawn: false };
  const roster = [second, two, first, one];
  const { managers } = boardOrganizations(roster, roster);

  assert.deepEqual(managers.map(({ lead, label, descendants }) => [lead.id, label, descendants]), [
    [first.id, '팀 #1', [one]],
    [second.id, '팀 #2', [two]],
  ]);
});

test('a parent cycle terminates and never includes a manager in its own descendants', () => {
  const lead = member('A', 'child', 'lead');
  const child = member('child', lead.id);
  const { managers, unlinked } = boardOrganizations([lead, child], [lead, child]);

  assert.deepEqual(managers, [{ lead, label: 'A', members: [lead, child], descendants: [child] }]);
  assert.deepEqual(unlinked, []);
});
