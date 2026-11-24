// Feature modules, set up in order. Each owns its own directory under server/. A new feature adds one line here.
import * as userDefaults from './user-defaults.js';
import * as workspace from './workspace/index.js';
import * as dispatch from './dispatch/index.js';
import * as agents from './cursor/agents.js';
import * as activity from './cursor/activity.js';

export const modules = [
  // The user's defaults, ~/.atelier/drawing.json (E555): read first by the modules below, written by the 설정 UI.
  { name: 'userDefaults', setup: userDefaults.setup },
  // The workspace's project folders (names only), the folder picker and the PR/CI switch.
  { name: 'workspace', setup: workspace.setup },
  // Agent sessions for the git project holding the workspace; off outside a git project.
  { name: 'dispatch', setup: dispatch.setup },
  // Live agent list (E528): who works in which project, GET + `agents` SSE (memory only).
  { name: 'agents', setup: agents.setup },
  // Agent activity log (E537): GET /api/activity + `activity` SSE, .drawing/activity.json.
  { name: 'activity', setup: activity.setup },
];
