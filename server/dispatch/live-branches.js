// Live branch view (#792): one row per session branch with its commits ahead/behind the integration branch, the
// tip's time and subject, the PR phase and whether the worktree holds uncommitted work. Read-only: git and gh run
// only through cli.js (git.js, pr-status.js). Metadata only — no diff text, PR title or author is kept.
import { branchStatus, commitGraph, currentBranch, integrationBranch, tipSubject, worktreeDirty } from "./git.js";
import { issueOfBranch } from "./ledger.js";

/** Rows answered per call; the PR lookup covers only the first PR_ROWS of them (open sessions first). */
export const MAX_ROWS = 30;
export const PR_ROWS = 12;

const open = s => s.status !== "done" && s.status !== "error";

/**
 * The one word a row shows for its PR: draft | review | mergeable | conflict | merged | closed, or null without a PR.
 * An open PR is "mergeable" when GitHub can merge it, no review asks for changes and CI is not failing or running.
 */
export function prPhase(pr) {
  if (!pr) return null;
  if (pr.state === "merged") return "merged";
  if (pr.state === "closed") return "closed";
  if (pr.draft) return "draft";
  if (pr.conflict) return "conflict";
  const reviewOk = pr.review === "approved" || pr.review == null;
  const ciOk = pr.ci === "success" || pr.ci === "none";
  return pr.mergeable && reviewOk && ciOk ? "mergeable" : "review";
}

/** The branch a session is on now: a worktree session may have switched off its dispatch/<slug> branch. */
async function sessionBranch(s) {
  if (s.worktree && s.cwd) {
    const now = await currentBranch(s.cwd);
    if (now && now !== "HEAD") return now;
  }
  return typeof s.branch === "string" && s.branch && s.branch !== "HEAD" ? s.branch : null;
}

/**
 * Makes `liveBranches()`, answering { base, pr: "on" | <reason>, rows: [...] }. Each row:
 *   { branch, sessions: [{ id, name, role, roleName, color, folder, open }], issue, ahead, behind, lastAt, subject,
 *     dirty: true|false|null, merged, pr: { number, phase, url? } | null }
 * `sessions()` lists the hub's sessions; `prStatus` is pr-status.js's lookup (null when absent). Answers are kept
 * `cacheMs`, and calls that overlap share one run, so several open boards do not multiply git calls.
 */
export function createLiveBranches({ root, sessions, prStatus = null, now = Date.now, cacheMs = 3000 }) {
  let last = null; // { at, value }
  let inflight = null;

  async function collect() {
    const base = await integrationBranch(root);
    const list = [...sessions()].filter(s => s && (s.branch || s.worktree))
      .sort((a, b) => Number(open(b)) - Number(open(a)) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const byBranch = new Map(); // branch -> { sessions, cwds }
    for (const s of list) {
      const branch = await sessionBranch(s);
      if (!branch || branch === base) continue;
      const row = byBranch.get(branch) ?? { sessions: [], cwds: [], issue: null };
      row.sessions.push({ id: s.id, name: s.name, role: s.role, roleName: s.roleName, color: s.color ?? null, folder: s.folder ?? null, open: open(s) });
      if (s.worktree && s.cwd && open(s)) row.cwds.push(s.cwd);
      row.issue ??= Number.isInteger(s.issue) && s.issue > 0 ? s.issue : null;
      byBranch.set(branch, row);
      if (byBranch.size >= MAX_ROWS) break;
    }
    const rows = (await Promise.all([...byBranch].map(async ([branch, r]) => {
      const [st, subject, dirty] = await Promise.all([
        branchStatus(root, branch, base),
        tipSubject(root, branch),
        r.cwds.length ? Promise.all(r.cwds.map(worktreeDirty)).then(d => (d.some(x => x === true) ? true : d.every(x => x === null) ? null : false)) : null,
      ]);
      if (subject == null) return null; // the branch is gone
      return { branch, sessions: r.sessions, issue: r.issue ?? issueOfBranch(branch), ahead: st.ahead, behind: st.behind, lastAt: st.lastAt, subject, dirty, merged: st.state === "merged", pr: null };
    }))).filter(Boolean);

    let pr = "disabled";
    if (prStatus) {
      const answers = await Promise.all(rows.slice(0, PR_ROWS).map(r => prStatus(r.branch)));
      pr = "on";
      answers.forEach((a, i) => {
        if (a?.ok) rows[i].pr = { number: a.pr.number, phase: prPhase(a.pr), ...(a.pr.url && { url: a.pr.url }) };
        else if (a && ["disabled", "gh-missing", "not-logged-in"].includes(a.reason)) pr = a.reason;
      });
      if (pr !== "on") for (const r of rows) r.pr = null;
    }
    for (const r of rows) if (r.pr?.phase === "merged") r.merged = true;
    return { base, pr, rows };
  }

  return async function liveBranches({ force = false } = {}) {
    if (!force && last && now() - last.at < cacheMs) return last.value;
    if (inflight) return inflight;
    inflight = collect().then(value => {
      last = { at: now(), value };
      return value;
    }).finally(() => { inflight = null; });
    return inflight;
  };
}

/**
 * Makes `branchTree()` (#877): the commit tree of the integration branch and the session branches `liveBranches()`
 * lists, answering { base, commits: [{ hash, parents, branch, at, subject }], tips: [{ branch, hash }] }. Same cache
 * and overlap sharing as liveBranches. Metadata only.
 */
export function createBranchTree({ root, liveBranches, now = Date.now, cacheMs = 3000, limit = 150 }) {
  let last = null;
  let inflight = null;
  return async function branchTree({ force = false } = {}) {
    if (!force && last && now() - last.at < cacheMs) return last.value;
    if (inflight) return inflight;
    inflight = (async () => {
      const live = await liveBranches();
      return commitGraph(root, { base: live.base, branches: live.rows.map(r => r.branch), limit });
    })().then(value => {
      last = { at: now(), value };
      return value;
    }).finally(() => { inflight = null; });
    return inflight;
  };
}
