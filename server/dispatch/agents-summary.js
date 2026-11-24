// GET /api/agents/summary (#755): a small JSON for the Claude Code mod pane (/agents), which polls it every few
// seconds because the mod's fetch reads a whole body (no SSE). Metadata only: names, roles, models, states, task
// stages and times, issue/PR numbers. No transcript text (`last`, prompts, task notes), account labels, ids of
// provider sessions, paths or tokens.
import { issueOfBranch } from "./ledger.js";

const MAX_LEADS = 20;
const MAX_TEAM = 20;
const MAX_TASKS = 30;
const MAX_TITLE = 120;

/** Lead/teammate status for the pane, from the session state of state.js `sessionState`. */
export function paneStatus(state) {
  if (state === "working" || state === "stuck") return "running";
  if (state === "waiting") return "asking";
  if (state === "done" || state === "failed") return state;
  return "idle";
}

const pct = v => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);
const num = v => (Number.isInteger(v) && v > 0 && v < 1e7 ? v : null);
const time = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

function member(s) {
  return {
    name: text(s.name, 40), role: text(s.role, 40), model: text(s.modelLabel || s.model, 60),
    status: paneStatus(s.state), stuck: !!s.stuck, issue: num(s.issue) ?? issueOfBranch(s.branch),
  };
}

function task(t, names, now) {
  return {
    title: text(t.title, MAX_TITLE), stage: text(t.stage, 20),
    owner: names.get(t.owner) ?? null,
    etaAt: time(t.etaAt), late: !!(t.etaAt && !t.etaEstimated && t.etaAt < now && t.stage !== "done"),
    stuck: t.stuck ? text(t.stuck.label || t.stuck.reason, MAX_TITLE) : null,
    updatedAt: time(t.stageAt ?? t.createdAt),
  };
}

/**
 * Builds the summary. `sessions` are hub.publicSession() copies (they carry `state`); `tasks` hub.tasks; `limits`
 * hub.currentLimits(); `issues` the cached /api/issues answer or null. Leads are sessions without a parent; done
 * tasks are left out.
 */
export function agentsSummary({ project, limits = {}, sessions = [], tasks = [], issues = null, now = Date.now() }) {
  const names = new Map(sessions.map(s => [s.id, text(s.name, 40)]));
  const prsByIssue = new Map();
  if (issues?.ok) for (const i of issues.issues || []) prsByIssue.set(i.number, (i.prs || []).map(p => ({ number: p.number, state: p.state })).filter(p => num(p.number)));
  const leads = sessions.filter(s => !s.parent).slice(0, MAX_LEADS).map(lead => {
    const team = sessions.filter(s => s.parent === lead.id).slice(0, MAX_TEAM).map(member);
    const own = member(lead);
    const issueNums = [...new Set([own.issue, ...team.map(m => m.issue)].filter(Boolean))].sort((a, b) => a - b);
    return {
      ...own,
      issues: issueNums.map(n => ({ number: n, prs: prsByIssue.get(n) ?? [] })),
      tasks: tasks.filter(t => t.lead === lead.id && t.stage !== "done").slice(0, MAX_TASKS).map(t => task(t, names, now)),
      team,
    };
  });
  return {
    v: 1, at: now,
    project: { name: text(project?.name, 80) },
    usage: {
      fiveHour: { used: pct(limits.five), reset: time(limits.fiveReset) },
      weekly: { used: pct(limits.seven), reset: time(limits.sevenReset) },
    },
    leads,
  };
}
