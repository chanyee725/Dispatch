// Open GitHub issues as the unit of work (#776): for the project dashboard, each open issue with the PRs that work on
// it. Read-only through `gh` (cli.js); the app never creates or closes issues. Follows the same per-workspace switch as
// PR tracking (pr-status.js). Kept in memory only, never written: issue number, title and link; per PR its number,
// state, link and head branch. PR bodies are read only to find `Closes #<n>` / `Refs #<n>` and dropped at once.
import { runCli } from "./cli.js";
import { issueNumber, issueOfBranch } from "./ledger.js";
import { classify, prTrackingEnabled, validBranch } from "./pr-status.js";

export const ISSUE_DEFAULTS = { timeoutMs: 10000, cacheMs: 60000, issueLimit: 50, prLimit: 100 };
const TITLE_MAX = 200;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const PR_STATES = new Set(["open", "closed", "merged"]);
const ISSUE_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/;
const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
// GitHub's closing keywords, same-repo form only (`Closes #12`, `fixes: #12`).
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d{1,7})\b/gi;
// A PR that works on an issue without closing it (`Refs #12`, `ref: #12`, `references #12`).
const REFS = /\b(?:refs?|references?)\s*:?\s+#(\d{1,7})\b/gi;

/** The issue numbers a PR body closes with GitHub's keywords (`Closes #776`, `Fixes #12`). */
export function closedIssues(body) {
  if (typeof body !== "string") return [];
  return [...new Set([...body.matchAll(CLOSES)].map(m => issueNumber(Number(m[1]))).filter(Boolean))];
}

/** The issue numbers a PR body refers to without closing them (`Refs #756`). */
export function referencedIssues(body) {
  if (typeof body !== "string") return [];
  return [...new Set([...body.matchAll(REFS)].map(m => issueNumber(Number(m[1]))).filter(Boolean))];
}

/**
 * The first few lines of an issue body for the start panel (#954): markdown marks, links' targets, code blocks, HTML
 * and blank lines dropped, each line cut to `width`. Kept in memory only, never written.
 */
export function bodySummary(body, { lines = 3, width = 160 } = {}) {
  if (typeof body !== "string") return [];
  const out = [];
  let fence = false;
  for (const raw of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    const t = raw
      .replace(/<[^>]*>/g, " ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
      .replace(/[*_`~]+/g, "")
      .replace(CONTROL, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || /^[-=|:\s]+$/.test(t)) continue;
    out.push(t.length > width ? `${t.slice(0, width - 1)}…` : t);
    if (out.length >= lines) break;
  }
  return out;
}

const cleanTitle = t => (typeof t === "string" ? t.replace(CONTROL, " ").trim().slice(0, TITLE_MAX) : "");

/**
 * gh's PRs, metadata only: `{ pr: { number, state, url?, branch? }, issues, refs }`. `issues` are the ones its branch
 * names or its body closes; `refs` the ones its body only refers to. Open first, then merged, then closed, newest first.
 */
export function parsePrs(rawPrs) {
  const prs = (Array.isArray(rawPrs) ? rawPrs : []).flatMap(p => {
    const number = issueNumber(p?.number);
    const state = String(p?.state || "").toLowerCase();
    if (!number || !PR_STATES.has(state)) return [];
    const branch = validBranch(p.headRefName) ? p.headRefName : null;
    const url = typeof p.url === "string" && PR_URL.test(p.url) ? p.url : null;
    const issues = new Set(closedIssues(p.body));
    const own = issueOfBranch(branch);
    if (own) issues.add(own);
    const refs = new Set(referencedIssues(p.body));
    return [{ pr: { number, state, ...(url && { url }), ...(branch && { branch }) }, issues, refs }];
  });
  const order = { open: 0, merged: 1, closed: 2 };
  return prs.sort((a, b) => order[a.pr.state] - order[b.pr.state] || b.pr.number - a.pr.number);
}

/** The PRs working on issue `n` (branch, Closes or Refs), from parsePrs' list. */
export const prsOfIssue = (prs, n) => prs.filter(p => p.issues.has(n) || p.refs.has(n)).map(p => p.pr);

/**
 * Joins gh's open issues with parsePrs' list: each issue gets the PRs whose head branch names it (`feat/<n>-…`) or
 * whose body closes it. Issues stay in gh's order (newest first).
 */
function joinParsed(rawIssues, prs) {
  return (Array.isArray(rawIssues) ? rawIssues : []).flatMap(i => {
    const number = issueNumber(i?.number);
    if (!number) return [];
    const url = typeof i.url === "string" && ISSUE_URL.test(i.url) ? i.url : null;
    return [{ number, title: cleanTitle(i.title), ...(url && { url }), prs: prs.filter(p => p.issues.has(number)).map(p => p.pr) }];
  });
}

/**
 * Makes `listIssues({ force })`, resolving to `{ ok: true, issues }` or `{ ok: false, reason }` (reasons as in
 * pr-status.js: "disabled", "gh-missing", "not-logged-in", "timeout", "error"); never throws. One answer is cached for
 * cacheMs and concurrent calls share one gh run. `cwd` is the git project (gh reads the repo from it).
 */
export function createIssueList({ workspaceDir, cwd, env, prDefault = async () => true, run = runCli, now = Date.now, timeoutMs = ISSUE_DEFAULTS.timeoutMs, cacheMs = ISSUE_DEFAULTS.cacheMs, issueLimit = ISSUE_DEFAULTS.issueLimit, prLimit = ISSUE_DEFAULTS.prLimit } = {}) {
  let cached = null; // { at, result }
  let inflight = null;
  const gh = async args => JSON.parse((await run("gh", args, { cwd, env, timeout: timeoutMs, maxBuffer: 4 << 20 })).stdout);

  async function fetchNow() {
    try {
      const [issues, prs] = await Promise.all([
        gh(["issue", "list", "--state", "open", "--limit", String(issueLimit), "--json", "number,title,url"]),
        gh(["pr", "list", "--state", "all", "--limit", String(prLimit), "--json", "number,state,url,headRefName,body"]),
      ]);
      const parsed = parsePrs(prs);
      return { ok: true, issues: joinParsed(issues, parsed), prs: parsed };
    } catch (e) {
      const reason = e instanceof SyntaxError ? "error" : classify(e);
      return { ok: false, reason: reason === "no-pr" ? "error" : reason };
    }
  }

  async function load(force) {
    if (workspaceDir && !(await prTrackingEnabled(workspaceDir, await prDefault()))) return { ok: false, reason: "disabled" };
    if (typeof cwd !== "string" || !cwd) return { ok: false, reason: "error" };
    if (!force && cached && now() - cached.at < cacheMs) return cached.result;
    inflight ||= fetchNow().then(result => {
      cached = { at: now(), result };
      return result;
    }).finally(() => { inflight = null; });
    return inflight;
  }

  async function listIssues({ force = false } = {}) {
    const r = await load(force);
    return r.ok ? { ok: true, issues: r.issues } : r;
  }
  /**
   * `{ ok: true, prs }`: the PRs on issue `n` (any state, by branch, Closes or Refs) from the same cached gh answer,
   * so the accounts endpoint needs no gh call of its own. Only the last prLimit PRs are seen.
   */
  listIssues.prsOf = async (n, { force = false } = {}) => {
    const r = await load(force);
    return r.ok ? { ok: true, prs: prsOfIssue(r.prs, n) } : r;
  };
  /** `{ ok: true, prs }`: every parsed PR (parsePrs) from the same cached gh answer, for the board's auto close (#930). */
  listIssues.allPrs = async ({ force = false } = {}) => {
    const r = await load(force);
    return r.ok ? { ok: true, prs: r.prs } : r;
  };
  // Issue states for the board's auto close (#930): "open", "closed" or null (unknown), one gh run per issue per
  // cacheMs. Only the state is kept; a closed issue stays closed in the cache.
  const states = new Map(); // n -> { at, state }
  listIssues.issueState = async n => {
    const num = issueNumber(n);
    if (!num || typeof cwd !== "string" || !cwd) return null;
    const hit = states.get(num);
    if (hit && (hit.state === "closed" || now() - hit.at < cacheMs)) return hit.state;
    if (workspaceDir && !(await prTrackingEnabled(workspaceDir, await prDefault()))) return null;
    let state = null;
    try {
      const s = String((await gh(["issue", "view", "--json", "number,state", "--", String(num)]))?.state || "").toLowerCase();
      state = s === "open" || s === "closed" ? s : null;
    } catch { state = null; }
    states.set(num, { at: now(), state });
    return state;
  };
  // The start panel's body summary (#954): `{ ok: true, summary }` (bodySummary's lines) or `{ ok: false, reason }`,
  // one `gh issue view` per issue per cacheMs. Only the summary lines are kept, in memory.
  const summaries = new Map(); // n -> { at, result }
  listIssues.summary = async n => {
    const num = issueNumber(n);
    if (!num || typeof cwd !== "string" || !cwd) return { ok: false, reason: "error" };
    const hit = summaries.get(num);
    if (hit && now() - hit.at < cacheMs) return hit.result;
    if (workspaceDir && !(await prTrackingEnabled(workspaceDir, await prDefault()))) return { ok: false, reason: "disabled" };
    let result;
    try {
      result = { ok: true, summary: bodySummary((await gh(["issue", "view", "--json", "number,body", "--", String(num)]))?.body) };
    } catch (e) {
      const reason = e instanceof SyntaxError ? "error" : classify(e);
      result = { ok: false, reason: reason === "no-pr" ? "error" : reason };
    }
    summaries.set(num, { at: now(), result });
    return result;
  };
  return listIssues;
}
