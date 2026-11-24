// 조직도 tab of the agent live panel (#943): the open session's place in its team, built only from the sessions'
// `parent` and `canSpawn` fields (no extra API). A lead shows itself above its teammates; a teammate shows its lead
// above itself and its siblings. A session with neither parent nor children is a tree of one.

export interface OrgSession { id: string; n: number; parent: string | null; canSpawn: boolean }

export interface OrgNode<S extends OrgSession = OrgSession> { s: S; current: boolean; children: OrgNode<S>[] }

const byN = <S extends OrgSession>(a: S, b: S) => a.n - b.n;

/** The tree around `sid`, or null when the session is not in the list. */
export function orgTree<S extends OrgSession>(sessions: readonly S[], sid: string): OrgNode<S> | null {
  const self = sessions.find(s => s.id === sid);
  if (!self) return null;
  // Each session shows once: a parent cycle (A→B→A) stops at the first repeat instead of recursing forever.
  const seen = new Set<string>();
  const kids = (id: string) => {
    const list = sessions.filter(s => s.parent === id && !seen.has(s.id)).sort(byN);
    list.forEach(s => seen.add(s.id));
    return list;
  };
  const node = (s: S, deep: boolean): OrgNode<S> => ({
    s,
    current: s.id === sid,
    // Children of the open session always show; a sibling's own children only when it can spawn (a sub-lead).
    children: deep || s.canSpawn ? kids(s.id).map(k => node(k, false)) : [],
  });
  const lead = self.parent && self.parent !== sid ? sessions.find(s => s.id === self.parent) : undefined;
  seen.add(sid);
  if (!lead) return node(self, true);
  seen.add(lead.id);
  const team = [self, ...kids(lead.id)].sort(byN);
  return {
    s: lead,
    current: false,
    children: team.map(k => (k.id === sid ? node(k, true) : { s: k, current: false, children: [] })),
  };
}

/** Number of nodes in the tree (for the heading count). */
export const orgSize = (n: OrgNode | null): number => (n ? 1 + n.children.reduce((a, c) => a + orgSize(c), 0) : 0);
