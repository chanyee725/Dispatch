import type { Session } from '../../../../shared/dispatch/types.ts';
import { isOpen } from './format.ts';

type Member = Pick<Session, 'id' | 'parent' | 'name' | 'canSpawn' | 'status'>;

/** Follow the full roster, even when an intermediate parent is outside the project scope. */
export function boardOrganizations<T extends Member>(sessions: readonly T[], all: readonly T[]) {
  const byId = new Map(all.map((session) => [session.id, session]));
  const leads = new Map<string, T>();
  const descendants = new Map<string, T[]>();

  for (const session of sessions) {
    if (session.canSpawn && isOpen(session)) leads.set(session.id, session);

    const seen = new Set([session.id]);
    let parent = session.parent;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = byId.get(parent);
      if (!ancestor) break;
      if (ancestor.canSpawn && isOpen(ancestor)) {
        leads.set(parent, ancestor);
        const team = descendants.get(parent);
        if (team) team.push(session);
        else descendants.set(parent, [session]);
      }
      parent = ancestor.parent;
    }
  }

  return {
    leads: [...leads.values()].sort((a, b) => a.name.localeCompare(b.name)),
    descendants,
  };
}
