// The project scope of the 세션 board, shared by its screens through context: which project the URL picked and which
// folders are projects. Screens read their sessions and tasks through useScoped so they never filter on their own.
import { createContext, useContext, useMemo } from 'react';
import { inScope, type Scope } from './lib/folder.ts';
import { useDispatch } from './store';
import type { BoardTask } from './types';
import type { Session } from '../../../shared/dispatch/types.ts';

/** `names`: display name per project folder path (the folder path is the identity, the name is for labels). */
/** `pending`: 미분류 is picked but the project list has not arrived, so no session can be filed yet (scopePending). */
type Value = { scope: Scope; known: ReadonlySet<string>; names: ReadonlyMap<string, string>; pending?: boolean };
const Ctx = createContext<Value>({ scope: undefined, known: new Set(), names: new Map() });
export const ScopeProvider = Ctx.Provider;
export const useScope = () => useContext(Ctx);

/** Sessions and tasks of the picked project (everything under 전체). A task follows its lead; one with no lead in view stays under 전체. */
export function useScoped(): { sessions: Session[]; tasks: BoardTask[]; scope: Scope; pending: boolean } {
  const all = useDispatch(s => s.sessions);
  const tasks = useDispatch(s => s.tasks);
  const { scope, known, pending = false } = useScope();
  return useMemo(() => {
    if (pending) return { sessions: [], tasks: [], scope, pending };
    const sessions = inScope(all, scope, known);
    if (scope === undefined) return { sessions, tasks, scope, pending };
    const ids = new Set(sessions.map(s => s.id));
    return { sessions, tasks: tasks.filter(t => t.lead != null && ids.has(t.lead)), scope, pending };
  }, [all, tasks, scope, known, pending]);
}
