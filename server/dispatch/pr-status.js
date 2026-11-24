// PR and CI tracking through `gh` (E23). Metadata only: PR number, PR state, a CI rollup state, review decision,
// conflict flag and the PR link.
// No title, body, author, branch text or check names are kept. `gh` starts only through cli.js.
//
// Per-workspace switch: <workspace>/.drawing/settings.json { "prStatus": false } turns it off. A workspace
// without its own value follows the user's default (`prStatus` in ~/.dispatch/drawing.json), else on. Off, or a missing gh, never throws: the result says why.
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { runCli } from "./cli.js";
import { ensureDirInside } from "../lock.js";

const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "required" };

// minGapMs spaces gh starts and maxConcurrent caps how many run at once, so a dashboard asking for 12 branches
// answers in a few seconds without a burst of gh calls (a 1 s gap made the first load take 12 s+).
export const PR_DEFAULTS = { timeoutMs: 8000, cacheMs: 30000, minGapMs: 100, maxConcurrent: 4 };

const settingsFile = workspaceDir => path.join(workspaceDir, ".drawing", "settings.json");

const isPlainObject = v => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

/**
 * Reads settings.json as a plain object. A missing file is {}. Bad JSON or anything that is not a
 * plain object (array, string, null) throws, so a writer never replaces the user's file with a stub.
 */
async function readSettings(workspaceDir) {
  let text;
  try { text = await readFile(settingsFile(workspaceDir), "utf8"); } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  let value;
  try { value = JSON.parse(text); } catch {
    throw Object.assign(new Error("settings.json is not valid JSON"), { code: "ESETTINGS" });
  }
  if (!isPlainObject(value)) throw Object.assign(new Error("settings.json is not a JSON object"), { code: "ESETTINGS" });
  return value;
}

const pick = (value, fallback) => (typeof value === "boolean" ? value : fallback !== false);

/**
 * Whether PR tracking is on for a workspace folder: its own value, else `fallback` (the user's default), else true.
 * An unreadable file counts as unset.
 */
export async function prTrackingEnabled(workspaceDir, fallback = true) {
  try { return pick((await readSettings(workspaceDir)).prStatus, fallback); } catch { return fallback !== false; }
}

/** Like prTrackingEnabled, but throws (code ESETTINGS) when settings.json is not a valid JSON object. */
export async function readPrTracking(workspaceDir, fallback = true) {
  return pick((await readSettings(workspaceDir)).prStatus, fallback);
}

/**
 * Turns PR tracking on or off for a workspace folder; other settings in the file stay.
 * Refuses (throws, code ESETTINGS) when settings.json is not a valid JSON object, instead of overwriting it.
 */
export async function setPrTracking(workspaceDir, on) {
  const cur = await readSettings(workspaceDir);
  const file = settingsFile(workspaceDir);
  // .drawing must be a real folder inside the workspace; settings.json must not be a symlink.
  await ensureDirInside(workspaceDir, path.dirname(file));
  try {
    if (!(await lstat(file)).isFile()) throw new Error("settings.json is not a regular file");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify({ ...cur, prStatus: !!on }, null, 2) + "\n", { flag: "wx" });
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return !!on;
}

const STATES = new Set(["open", "closed", "merged"]);
const CI = new Set(["success", "failure", "pending"]);

/** Collapses gh's statusCheckRollup (check runs and commit statuses) into success | failure | pending | none. */
export function rollupCi(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return "none";
  let pending = false;
  for (const c of rollup) {
    const raw = String(c?.conclusion || c?.state || c?.status || "").toUpperCase();
    if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"].includes(raw)) return "failure";
    if (!["SUCCESS", "NEUTRAL", "SKIPPED"].includes(raw)) pending = true;
  }
  return pending ? "pending" : "success";
}

export function classify(err) {
  const text = `${err?.stderr ?? ""}\n${err?.message ?? ""}`.toLowerCase();
  if (err?.code === "ENOENT") return "gh-missing";
  if (err?.killed || err?.code === "ETIMEDOUT") return "timeout";
  if (/no pull requests? found|could not resolve to a pullrequest/.test(text)) return "no-pr";
  if (/gh auth login|not logged in|authentication|gh_token|http 401/.test(text)) return "not-logged-in";
  return "error";
}

/** A git branch name only: ref characters, no "..", not starting with "-" or "/", not all digits (gh would read a PR number). */
export function validBranch(branch) {
  return typeof branch === "string" && branch.length > 0 && branch.length <= 255
    && /^[A-Za-z0-9._/-]+$/.test(branch) && !/^[-/]/.test(branch) && !branch.includes("..") && !/^\d+$/.test(branch);
}

/**
 * Makes `prStatus(branch)`. Resolves to one of
 *   { ok: true, pr: { number, state: "open"|"closed"|"merged", ci: "success"|"failure"|"pending"|"none", url?, review?, conflict?, mergeable?, draft? } }
 *   { ok: false, reason: "disabled"|"gh-missing"|"not-logged-in"|"no-pr"|"timeout"|"invalid-branch"|"error" }
 * and never throws. Answers are cached per branch (cacheMs, `force: true` skips the cache) and gh
 * starts at most once per minGapMs with at most maxConcurrent running, so a run watching many steps does not hammer GitHub.
 * `cwd` (required) is the git project folder (gh reads the repo from it); `env` is for tests (fake gh on PATH).
 */
export function createPrStatus({ workspaceDir, cwd, env, prDefault = async () => true, run = runCli, now = Date.now, timeoutMs = PR_DEFAULTS.timeoutMs, cacheMs = PR_DEFAULTS.cacheMs, minGapMs = PR_DEFAULTS.minGapMs, maxConcurrent = PR_DEFAULTS.maxConcurrent } = {}) {
  const cache = new Map(); // branch -> { at, result }
  const inflight = new Map();
  let lastStart = 0;
  let running = 0;
  const waiting = []; // resolvers for calls waiting for a free gh slot

  async function fetchOne(branch) {
    // A finished call hands its slot straight to the next waiter, so `running` never goes over maxConcurrent.
    if (running >= maxConcurrent) await new Promise(r => waiting.push(r));
    else running++;
    try { return await fetchNow(branch); } finally {
      const next = waiting.shift();
      if (next) next(); else running--;
    }
  }

  async function fetchNow(branch) {
    // Reserve this call's start slot before waiting, so overlapping calls queue up minGapMs apart.
    const start = Math.max(now(), lastStart + minGapMs);
    lastStart = start;
    const wait = start - now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      const { stdout } = await run("gh", ["pr", "view", "--json", "number,state,statusCheckRollup,url,reviewDecision,mergeable,isDraft", "--", branch], { cwd, env, timeout: timeoutMs, maxBuffer: 1 << 20 });
      const j = JSON.parse(stdout);
      const state = String(j.state || "").toLowerCase();
      const number = Number(j.number);
      if (!STATES.has(state) || !Number.isInteger(number)) return { ok: false, reason: "error" };
      const ci = rollupCi(j.statusCheckRollup);
      // The PR's web address, only when it is a plain github.com PR link (the dashboard links to it).
      const url = typeof j.url === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(j.url) ? j.url : null;
      // Review decision and merge conflicts, only when gh says so (open PRs): "approved" | "changes" | "required".
      const review = REVIEW[j.reviewDecision] ?? null;
      return { ok: true, pr: { number, state, ci: CI.has(ci) ? ci : "none", ...(url && { url }), ...(review && { review }), ...(j.mergeable === "CONFLICTING" && { conflict: true }), ...(j.mergeable === "MERGEABLE" && { mergeable: true }), ...(j.isDraft === true && { draft: true }) } };
    } catch (e) {
      return { ok: false, reason: classify(e) };
    }
  }

  return async function prStatus(branch, { force = false } = {}) {
    if (workspaceDir && !(await prTrackingEnabled(workspaceDir, await prDefault()))) return { ok: false, reason: "disabled" };
    if (!validBranch(branch)) return { ok: false, reason: "invalid-branch" };
    // gh reads the repo from cwd; without it gh would ask about whatever repo the server runs in.
    if (typeof cwd !== "string" || !cwd) return { ok: false, reason: "error" };
    const hit = cache.get(branch);
    if (!force && hit && now() - hit.at < cacheMs) return hit.result;
    if (inflight.has(branch)) return inflight.get(branch);
    const p = fetchOne(branch).then(result => {
      const at = now();
      for (const [b, e] of cache) if (at - e.at >= cacheMs) cache.delete(b); // drop expired answers
      cache.set(branch, { at, result });
      return result;
    }).finally(() => inflight.delete(branch));
    inflight.set(branch, p);
    return p;
  };
}
