import type { Session } from '../../../../shared/dispatch/types.ts';
import { isOpen } from './format.ts';

type Member = Pick<Session, 'id' | 'n' | 'parent' | 'name' | 'role' | 'status'>;
type Group<T> = { lead: T; members: T[]; descendants: T[] };

const isManager = (session: Member) => session.role === 'lead' && isOpen(session);

/** Use the full roster for ancestry, but only render cards from the current project scope. */
export function boardOrganizations<T extends Member>(sessions: readonly T[], all: readonly T[]) {
  const byId = new Map(all.map((session) => [session.id, session]));
  const groups = new Map<string, Group<T>>();
  const unlinked: T[] = [];

  function groupFor(lead: T) {
    let group = groups.get(lead.id);
    if (!group) {
      group = { lead, members: [], descendants: [] };
      groups.set(lead.id, group);
    }
    return group;
  }

  for (const session of sessions) {
    // In All, a manager heads their own group and each other card goes to its closest manager.
    let owner = isManager(session) ? groupFor(session) : undefined;
    const seen = new Set([session.id]);
    let parent = session.parent;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = byId.get(parent);
      if (!ancestor) break;
      if (isManager(ancestor)) {
        const group = groupFor(ancestor);
        group.descendants.push(session);
        owner ??= group;
      }
      parent = ancestor.parent;
    }
    (owner?.members ?? unlinked).push(session);
  }

  const nameCounts = new Map<string, number>();
  for (const { lead } of groups.values()) nameCounts.set(lead.name, (nameCounts.get(lead.name) ?? 0) + 1);
  const managers = [...groups.values()]
    .sort((a, b) => a.lead.name.localeCompare(b.lead.name) || a.lead.n - b.lead.n)
    .map((group) => {
      const { name, n } = group.lead;
      return { ...group, label: nameCounts.get(name) === 1 ? name : `${name} #${n}` };
    });

  return { managers, unlinked };
}
