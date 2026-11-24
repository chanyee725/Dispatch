// Live agent list (E528, issue #592): the agent sessions working in the workspace right now, for the project view.
// Memory only: nothing about it is written to disk.
//   GET /api/workspace/agents[?project=<top folder>] -> { agents } (shape: shared/dispatch/agent-presence.ts)
//   SSE `agents` -> { agents } for the whole workspace, once on connect and again on every change.
// Sessions and their state come from the Dispatch hub (off outside a git project: the list is then empty).

/** Hub session statuses of a live session: working now, waiting for a person, or idle between turns (#785). */
export const LIVE_STATUSES = new Set(['running', 'starting', 'waiting', 'idle']);

/**
 * The agent list (see shared/dispatch/agent-presence.ts), newest activity first.
 * - sessions: hub sessions (stored objects); only live ones are listed
 * - project: optional filter (top folder, the session's `folder`)
 * - activity: Map sid -> tool activity label of its current turn (from the hub's `session` events; memory only)
 */
export function buildAgents({ sessions = [], project = null, activity = new Map() } = {}) {
  const out = [];
  for (const s of sessions) {
    if (!s?.id || !LIVE_STATUSES.has(s.status)) continue;
    out.push({
      sid: s.id,
      name: typeof s.name === 'string' ? s.name : '',
      role: typeof s.role === 'string' ? s.role : '',
      // Creation number and lead, for a fixed team order on the home list (#785).
      ...(Number.isInteger(s.n) && { n: s.n }),
      ...(typeof s.parent === 'string' && s.parent && { parent: s.parent }),
      ...(typeof s.roleName === 'string' && { roleName: s.roleName }),
      ...(typeof s.color === 'string' && { color: s.color }),
      model: typeof s.model === 'string' ? s.model : null,
      ...(typeof s.modelLabel === 'string' && { modelLabel: s.modelLabel }),
      ...(typeof s.provider === 'string' && s.provider && { provider: s.provider }),
      ...(typeof activity.get(s.id) === 'string' && { activity: activity.get(s.id) }),
      status: s.status,
      state: typeof s.state === 'string' ? s.state : null,
      project: (typeof s.folder === 'string' && s.folder) || null,
      file: null,
      at: s.updatedAt ?? null,
    });
  }
  const mine = project == null ? out : out.filter((a) => a.project === project);
  return mine.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

export async function setup(ctx) {
  const hub = ctx.modules.dispatch?.hub ?? null;
  const activity = new Map(); // session id -> tool activity label of its current turn (from `session` events)
  let last = '';

  const sessions = () => {
    const all = hub?.sessions ?? [];
    return Array.isArray(all) ? all : Object.values(all);
  };
  const list = (project = null) => buildAgents({ sessions: sessions(), project, activity });
  // Sent only when the list really changed, so a session's other updates (tokens, cost) do not repeat it.
  const update = () => {
    const agents = list();
    const json = JSON.stringify(agents);
    if (json === last) return;
    last = json;
    ctx.hub.broadcast('agents', { agents });
  };

  // The hub's public session carries `activity` ({ label, since } while a turn runs a tool, else null); the stored
  // session does not, so the label is kept here.
  const onSession = (s) => {
    if (s?.id) {
      const label = typeof s.activity?.label === 'string' && s.activity.label ? s.activity.label : null;
      if (label) activity.set(s.id, label);
      else activity.delete(s.id);
    }
    update();
  };
  const onTasks = () => update();
  const onRemoved = ({ id } = {}) => {
    activity.delete(id);
    update();
  };
  hub?.on('session', onSession);
  hub?.on('removed', onRemoved);
  hub?.on('tasks', onTasks);
  ctx.hub.onAttach?.((sendTo) => sendTo('agents', { agents: list() }));

  return {
    list,
    routes: [
      {
        method: 'GET',
        path: '/api/workspace/agents',
        handler(_req, res, _ctx, _m, url) {
          const project = url.searchParams.get('project') || null;
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ agents: list(project) }));
        },
      },
    ],
    close() {
      hub?.off('session', onSession);
      hub?.off('removed', onRemoved);
      hub?.off('tasks', onTasks);
    },
  };
}
