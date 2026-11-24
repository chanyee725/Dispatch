import { useEffect } from 'react';
import { events } from '../lib/events';

// The server now runs in another folder: everything on screen belongs to the old one, so start over.
const reloadForWorkspace = () => window.location.assign('/');

/** Another tab switched the server to another folder (E554): reload. */
export function useWorkspaceEvents() {
  useEffect(() => events.subscribeJson('workspace-switch', reloadForWorkspace), []);
}
