import { useEffect, useState } from 'react';
import { projectsApi, type ProjectInfo } from '../api';

export type ListState = 'loading' | 'ready' | 'failed';

/** Project folders of the workspace, with whether the first answer is in. A failed refresh keeps the last list. */
export function useProjectList(): [ProjectInfo[], ListState] {
  const [list, setList] = useState<ProjectInfo[]>([]);
  const [state, setState] = useState<ListState>('loading');
  useEffect(() => {
    let live = true;
    const load = () =>
      void projectsApi.projects().then(
        (d) => {
          if (live) {
            setList(d.projects);
            setState('ready');
          }
        },
        () => live && setState((s) => (s === 'ready' ? s : 'failed')),
      );
    load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return [list, state];
}
