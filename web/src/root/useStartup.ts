import { useEffect } from 'react';
import { api } from '../api';

/** On first render: the project's name, shown top-left. */
export function useStartup(setProjectName: (name: string | null) => void) {
  useEffect(() => {
    api.info().then((i) => setProjectName(i.project || i.workspace || null)).catch(() => {});
  }, [setProjectName]);
}
