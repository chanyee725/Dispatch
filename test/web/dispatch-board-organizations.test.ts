import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '../../shared/dispatch/types.ts';
import { boardOrganizations } from '../../web/src/dispatch/lib/boardOrganizations.ts';

const member = (id: string, parent: string | null = null, canSpawn = false, status: Session['status'] = 'running') =>
  ({ id, name: id, parent, canSpawn, status });

test('each manager has only their own descendants, including nested sessions in project scope', () => {
  const lead = member('A', null, true);
  const nestedLead = member('B', lead.id, true);
  const otherLead = member('C', null, true);
  const child = member('child', nestedLead.id);
  const otherChild = member('other', otherLead.id);
  const independent = member('independent');
  const scoped = [child, otherChild, independent, otherLead];
  const { leads, descendants } = boardOrganizations(scoped, [...scoped, nestedLead, lead]);

  assert.deepEqual(leads, [lead, nestedLead, otherLead]);
  assert.deepEqual(descendants.get(lead.id), [child]);
  assert.deepEqual(descendants.get(nestedLead.id), [child]);
  assert.deepEqual(descendants.get(otherLead.id), [otherChild]);
});

test('finished and missing managers are dropped and descendants follow the next snapshot', () => {
  const lead = member('A', null, true);
  const finished = member('B', lead.id, true, 'done');
  const child = member('child', finished.id);
  const emptyLead = member('C', null, true);
  const before = boardOrganizations([lead, finished, child, emptyLead], [lead, finished, child, emptyLead]);

  assert.deepEqual(before.leads, [lead, emptyLead]);
  assert.deepEqual(before.descendants.get(lead.id), [finished, child]);
  assert.equal(before.descendants.has(emptyLead.id), false);

  const removed = boardOrganizations([child, emptyLead], [child, emptyLead]);
  assert.deepEqual(removed.leads, [emptyLead]);
  assert.equal(removed.descendants.size, 0);

  const moved = { ...child, parent: emptyLead.id };
  const reconnected = boardOrganizations([moved, emptyLead], [moved, emptyLead]);
  assert.deepEqual(reconnected.descendants.get(emptyLead.id), [moved]);
});

test('a parent cycle terminates and never includes a manager in its own results', () => {
  const lead = member('A', 'child', true);
  const child = member('child', lead.id);
  const { descendants } = boardOrganizations([lead, child], [lead, child]);

  assert.deepEqual(descendants.get(lead.id), [child]);
});
