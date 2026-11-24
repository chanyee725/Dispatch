import { ownGitEnv, runCli } from "./cli.js";
import { appendFile, copyFile, link, mkdir, readFile, readdir, readlink, symlink } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { STATE_DIR, stateLayout } from "./paths.js";

const git = (cwd, ...args) => runCli("git", ["-C", cwd, ...args], { maxBuffer: 32 << 20, env: ownGitEnv() });

export async function projectRoot(dir) {
  try { return (await git(dir, "rev-parse", "--show-toplevel")).stdout.trim(); } catch { return dir; }
}

export async function currentBranch(dir) {
  try { return (await git(dir, "branch", "--show-current")).stdout.trim() || "HEAD"; } catch { return null; }
}

async function hasHead(dir) {
  try { await git(dir, "rev-parse", "--verify", "HEAD"); return true; } catch { return false; }
}

// Keep the session worktrees and the team state out of `git status` without touching the tracked
// .gitignore. Only Atelier's own entries: the rest of .atelier/ (documents) is the user's to track.
// `worktrees` is the folder new worktrees go in; a not-yet-moved .dispatch/ is excluded whole, as before.
/** Atelier's own run files in the state folder (kept out of git, and out of the 작업 보기 diff, #906). */
/** The chat history folder inside .atelier/ (chat-store.js). */
export const CHAT_DIR = "chat";
const STATE_FILES = ["state.json", "drawing.lock*", "server.port", "server.pid", "server.log"];

export async function ensureExcluded(root, worktrees) {
  const rel = path.relative(root, worktrees).split(path.sep).join("/");
  const lines = [
    ...(rel.startsWith(STATE_DIR + "/") ? [`/${rel}/`, ...STATE_FILES.map(f => `/${STATE_DIR}/${f}`)] : [`${rel.split("/")[0]}/`]),
    // Saved chat history (#968) is never tracked, whichever state folder the store uses.
    `/${STATE_DIR}/${CHAT_DIR}/`,
  ];
  const file = path.join(root, ".git", "info", "exclude");
  try {
    const cur = await readFile(file, "utf8").catch(() => "");
    const have = new Set(cur.split("\n"));
    const add = lines.filter(l => !have.has(l));
    if (add.length) {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, (cur.endsWith("\n") || !cur ? "" : "\n") + add.join("\n") + "\n");
    }
  } catch { /* not a git repo */ }
}

// Returns { cwd, branch, worktree, warning }. Falls back to the project dir when a worktree can't be made.
// `worktrees` is the folder the worktree goes in: <project>/.atelier/worktrees unless the store still uses .dispatch/.
export async function prepareWorkdir(root, slug, useWorktree, { shareDeps: share = true, worktrees = stateLayout(root).worktrees } = {}) {
  if (!useWorktree) return { cwd: root, branch: await currentBranch(root), worktree: false };
  if (!(await hasHead(root))) {
    return { cwd: root, branch: await currentBranch(root), worktree: false,
      warning: "커밋이 없는 레포라 worktree를 만들 수 없어 프로젝트 폴더에서 실행해요." };
  }
  await ensureExcluded(root, worktrees);
  const dir = path.join(worktrees, slug);
  const branch = `dispatch/${slug}`;
  try {
    await git(root, "worktree", "add", dir, "-b", branch);
  } catch (e) {
    return { cwd: root, branch: await currentBranch(root), worktree: false,
      warning: `worktree 생성 실패: ${String(e.stderr || e.message).trim().slice(0, 200)}` };
  }
  const warning = share ? await shareDeps(root, dir) : null;
  return { cwd: dir, branch, worktree: true, ...(warning && { warning }) };
}

/**
 * A fresh worktree has no node_modules, and sessions burned 10+ minutes on it: a symlink breaks
 * bundlers that refuse files outside the project root (Next/Turbopack font imports), so e2e servers
 * timed out. Hard links give real files inside the worktree at no disk cost. Done in-process: child
 * processes are limited to the agent CLIs, git and gh (CLAUDE.md), so no `cp -al`.
 */
async function shareDeps(root, dir) {
  const src = path.join(root, "node_modules"), dst = path.join(dir, "node_modules");
  if (!existsSync(src) || existsSync(dst)) return null;
  try { await linkTree(src, dst); return null; }
  catch (e) { return `node_modules를 작업 폴더에 연결하지 못했어요: ${String(e.code || e.message).trim().slice(0, 160)}`; }
}

/** Mirrors a tree with hard links (copies when linking fails, e.g. across devices); symlinks stay symlinks. */
async function linkTree(src, dst) {
  await mkdir(dst, { recursive: true });
  for (const e of await readdir(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), to = path.join(dst, e.name);
    if (e.isDirectory()) await linkTree(from, to);
    else if (e.isSymbolicLink()) await symlink(await readlink(from), to);
    else if (e.isFile()) await link(from, to).catch(() => copyFile(from, to));
  }
}

/**
 * Drops a removed session's worktree when nothing would be lost: no uncommitted or untracked
 * files outside build noise. The branch and its commits stay. Worktrees of removed sessions
 * otherwise piled up (37 GB across ~100 of them).
 */
export async function dropWorktree(root, dir, { strict = false, info = {} } = {}) {
  if (!dir || path.resolve(dir) === path.resolve(root) || !existsSync(dir)) return false;
  let st;
  if (strict) {
    // Removal nobody clicked (auto-remove): a failed status counts as dirty, and ignored files
    // (.env, local data, …) count too unless they are known build noise. `matching` lists each ignored
    // path itself, so a folder holding only web/dist is not folded into an ignored "web/".
    try { st = (await git(dir, "status", "--porcelain", "--ignored=matching")).stdout; } catch { return false; }
    // Commits made on a detached HEAD live only in this worktree's own reflog, which `worktree remove`
    // deletes with it. Keep it when HEAD is detached or on no branch; a failed check keeps it too.
    if (await detachedOrOrphan(dir, info)) return false;
  } else st = await out(git(dir, "status", "--porcelain"));
  if (st.split("\n").filter(Boolean).some(l => !noiseLine(l))) return false;
  try { await git(root, "worktree", "remove", "--force", dir); return true; } catch { return false; }
}

async function detachedOrOrphan(dir, info) {
  try {
    const sha = (await git(dir, "rev-parse", "--short", "HEAD")).stdout.trim();
    if (sha) info.sha = sha;
    try { await git(dir, "symbolic-ref", "-q", "HEAD"); } catch { info.detached = true; return true; }
    const on = (await git(dir, "branch", "--contains", "HEAD", "--format=%(refname:short)")).stdout.trim();
    if (!on) { info.detached = true; return true; }
    return false;
  } catch { info.unknown = true; return true; }
}

const NOISE = new Set(["node_modules", ".next", ".next-prod", "dist", ".playwright-mcp", "test-results", "playwright-report"]);
const IGNORED_NOISE = new Set([...NOISE, "coverage"]);
// Untracked files count as work unless they sit in a top-level noise folder (a linked node_modules).
const keep = f => !NOISE.has(f.split("/")[0]);
// The 작업 보기 diff also skips Atelier's own run files and worktrees in the state folder (#906): a lock or state.json
// is not the session's work. Documents in that folder still show, since they are work.
const isRunFile = f => {
  if (!f.startsWith(STATE_DIR + "/")) return false;
  const rest = f.slice(STATE_DIR.length + 1);
  return rest.startsWith("worktrees/") || rest.startsWith(CHAT_DIR + "/") || STATE_FILES.some(p => (p.endsWith("*") ? rest.startsWith(p.slice(0, -1)) : rest === p));
};
const keepInDiff = f => keep(f) && !isRunFile(f);
// Changed tracked files are always work. Only files git ignores may be noise at any depth
// (web/node_modules, web/dist, coverage): `?? src/dist/new.js` or ` M docs/dist/x.md` is real work.
const noiseLine = l => {
  const f = l.slice(3).replace(/\/$/, "");
  if (l.startsWith("!! ")) return f.split("/").some(seg => IGNORED_NOISE.has(seg));
  return l.startsWith("?? ") && !keep(f);
};
const out = p => p.then(r => r.stdout, () => "");

/**
 * What a session changed. In a worktree: everything on its branch since it left the project's
 * branch (commits + uncommitted edits), so committed work stays visible. Once the branch is merged
 * back, its own commits' patches. In the project folder: uncommitted changes against HEAD.
 */
export async function diff(cwd, root = cwd) {
  if (!(await hasHead(cwd))) {
    const files = (await out(git(cwd, "status", "--porcelain", "-uall"))).split("\n").filter(Boolean).map(l => l.slice(3)).filter(keepInDiff);
    return { files: files.length, add: 0, del: 0, untracked: files, patch: "", commits: [], base: null, merged: false };
  }
  let base = "HEAD", baseName = null, commits = [], merged = false;
  if (path.resolve(cwd) !== path.resolve(root)) {
    baseName = await currentBranch(root);
    const mb = (await out(git(cwd, "merge-base", "HEAD", baseName || "HEAD"))).trim();
    const head = (await out(git(cwd, "rev-parse", "HEAD"))).trim();
    // Where this branch was created (first reflog entry), to list only its own commits.
    const branch = (await out(git(cwd, "branch", "--show-current"))).trim();
    const born = branch ? (await out(git(cwd, "reflog", "show", "--format=%H", branch))).trim().split("\n").filter(Boolean).at(-1) : "";
    const from = born || mb;
    if (from) {
      commits = (await out(git(cwd, "log", "--no-merges", "--format=%h%x09%s", `${from}..HEAD`, "-n", "50")))
        .split("\n").filter(Boolean).map(l => { const [hash, ...rest] = l.split("\t"); return { hash, subject: rest.join("\t") }; });
    }
    if (mb && mb !== head) base = mb;
    else if (mb === head && commits.length) { merged = true; base = null; }
  }
  const own = commits.map(c => c.hash).reverse(); // merged branch: show each own commit, oldest first
  const [num, patch, others] = await Promise.all([
    base ? out(git(cwd, "diff", base, "--numstat")) : out(git(cwd, "show", "--numstat", "--format=", ...own)),
    base ? out(git(cwd, "diff", base)) : out(git(cwd, "show", "-p", "--format=commit %h %s", ...own)),
    out(git(cwd, "ls-files", "--others", "--exclude-standard")),
  ]);
  let add = 0, del = 0;
  const changed = new Set();
  for (const line of num.split("\n").filter(Boolean)) {
    const [a, d, f] = line.split("\t");
    add += +a || 0; del += +d || 0; if (f) changed.add(f);
  }
  const untracked = others.split("\n").filter(Boolean).filter(keepInDiff);
  const LIMIT = 200_000;
  const p = patch.length > LIMIT ? patch.slice(0, LIMIT) + "\n… (잘림)" : patch;
  return { files: changed.size + untracked.length, add, del, untracked, patch: p, commits, base: baseName, merged };
}

/**
 * Commit graph of the project's main branch plus every dispatch/* branch, for the UI to draw who
 * branched off what and what merged back. Returns commits newest-first with parent links, the
 * branch tips, and which branch each session HEAD sits on (by matching session.branch).
 */
/** Local branch names of the repo at `root`. */
async function localBranches(root) {
  try {
    return (await git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads")).stdout.split("\n").map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}

/** The branch work merges into: develop, else main/master, else whatever the project folder is on. */
export async function integrationBranch(root, base = "develop") {
  const branches = await localBranches(root);
  return [base, "main", "master"].find(b => branches.includes(b)) ?? (await currentBranch(root)) ?? "HEAD";
}

/**
 * Whether `commit` (a hash or branch name) is already part of the integration branch in the
 * project folder — `git merge-base --is-ancestor`. Leads closed tasks as merged that were not on
 * develop; this is the check behind closing one. Returns { ok, commit, base, reason }.
 */
export async function verifyMerged(root, commit) {
  const ref = String(commit || "").trim();
  const base = await integrationBranch(root);
  // A leading "-" would read as an option to git.
  if (!ref || ref.startsWith("-")) return { ok: false, commit: ref, base, reason: "커밋을 알 수 없어요" };
  let sha;
  try { sha = (await git(root, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`)).stdout.trim(); }
  catch { return { ok: false, commit: ref, base, reason: `${ref} 커밋을 프로젝트 폴더에서 찾을 수 없어요` }; }
  try {
    await git(root, "merge-base", "--is-ancestor", sha, base);
    return { ok: true, commit: sha, base, reason: null };
  } catch (e) {
    // Exit 1 means "not an ancestor"; anything else is git failing.
    if (e.code === 1) return { ok: false, commit: sha, base, reason: `${sha.slice(0, 7)} 커밋이 아직 ${base}에 없어요. 병합하고 프로젝트 폴더의 ${base} 브랜치를 최신으로 맞춘 뒤 다시 닫으세요` };
    return { ok: false, commit: sha, base, reason: `병합 확인에 실패했어요: ${String(e.stderr || e.message).trim().slice(0, 120)}` };
  }
}

/**
 * One table row per branch against the integration branch: commits ahead (`ahead`) and behind
 * (`behind`), the tip's commit time (`lastAt`, ms) and `state`:
 * - "merged": the tip is on `base` and the branch made commits of its own (first reflog entry
 *   differs from the tip), so the work went in;
 * - "empty": the tip is on `base` and nothing was committed — a fresh worktree branch;
 * - "open": commits not on `base` yet.
 */
export async function branchStatus(root, branch, base) {
  const sh = async (...a) => { try { return (await git(root, ...a)).stdout.trim(); } catch { return ""; } };
  const [counts, ct, tip, born] = await Promise.all([
    sh("rev-list", "--left-right", "--count", `${base}...${branch}`),
    sh("log", "-1", "--format=%ct", branch),
    sh("rev-parse", branch),
    sh("reflog", "show", "--format=%H", branch).then(r => r.split("\n").filter(Boolean).at(-1) || ""),
  ]);
  const [behind, ahead] = counts.split(/\s+/).map(n => +n || 0);
  const state = ahead > 0 ? "open" : born && born !== tip ? "merged" : "empty";
  return { ahead, behind: behind ?? 0, lastAt: ct ? +ct * 1000 : null, state };
}

/** The subject line of `branch`'s tip commit, or null when the branch is gone. */
export async function tipSubject(root, branch) {
  if (typeof branch !== "string" || !branch || branch.startsWith("-")) return null;
  try { return (await git(root, "log", "-1", "--format=%s", branch, "--")).stdout.trim(); } catch { return null; }
}

/**
 * Whether a worktree holds uncommitted work: changed tracked files, or untracked files outside build noise
 * (the same rule dropWorktree uses). null when git cannot tell (folder gone, not a repo).
 */
export async function worktreeDirty(dir) {
  if (!dir || !existsSync(dir)) return null;
  try {
    const st = (await git(dir, "--no-optional-locks", "status", "--porcelain")).stdout;
    return st.split("\n").filter(Boolean).some(l => !noiseLine(l));
  } catch { return null; }
}

export async function branchGraph(root, { base = "develop", limit = 80, active = [] } = {}) {
  const activeSet = new Set(active);
  const sh = async (...a) => { try { return (await git(root, ...a)).stdout; } catch { return ""; } };
  const branches = await localBranches(root);
  const mainB = await integrationBranch(root, base);
  // Which dispatch/* branches are worth showing: a live session's branch, or work not yet merged.
  const dispatchB = branches.filter(b => b.startsWith("dispatch/"));
  // Only branches a live session is on (what the team is working on right now). If none are
  // active, fall back to the few most-ahead so the graph is not empty.
  const keep = [];
  for (const b of dispatchB) {
    const ahead = +((await sh("rev-list", "--count", `${mainB}..${b}`)).trim() || 0);
    keep.push({ b, ahead, active: activeSet.has(b) });
  }
  let chosen = keep.filter(k => k.active);
  if (!chosen.length) chosen = keep.filter(k => k.ahead > 0).sort((x, y) => y.ahead - x.ahead).slice(0, 8);
  const refs = [mainB, ...chosen.map(k => k.b)];
  if (!refs.length) return { base: mainB, commits: [], tips: [] };

  // Graph commits reachable from these refs (bounded).
  const log = await sh("log", "--date-order", `--max-count=${limit}`, "--pretty=%H%x1f%h%x1f%P%x1f%an%x1f%ct%x1f%s", ...refs);
  const commits = log.split("\n").filter(Boolean).map(line => {
    const [hash, short, parents, author, ct, subject] = line.split("\x1f");
    return { hash, short, parents: parents ? parents.split(" ") : [], author, at: +ct * 1000, subject, merge: (parents ? parents.split(" ").length : 0) > 1 };
  });
  const inGraph = new Set(commits.map(c => c.hash));
  for (const c of commits) c.parents = c.parents.filter(p => inGraph.has(p)); // trim parents outside the window

  // Branch tips: name → tip hash, and how far ahead of base.
  const aheadOf = new Map(keep.map(k => [k.b, k.ahead]));
  const tips = [];
  for (const b of refs) {
    const tip = (await sh("rev-parse", b)).trim();
    const row = b === mainB ? { ahead: 0, behind: 0, lastAt: null, state: null } : await branchStatus(root, b, mainB);
    if (b === mainB) row.lastAt = +((await sh("log", "-1", "--format=%ct", b)).trim() || 0) * 1000 || null;
    tips.push({ branch: b, hash: tip, short: tip.slice(0, 7), ...row, ahead: b === mainB ? 0 : (aheadOf.get(b) ?? row.ahead), base: b === mainB, active: activeSet.has(b) });
  }
  return { base: mainB, commits, tips };
}

/**
 * Commit tree for the 브랜치 tab (#877): the newest `limit` commits reachable from `base` and `branches`, newest
 * first, each { hash, parents, branch, at, subject }. Metadata only (no author, email or diff). A commit on `base`
 * belongs to `base`; any other to the first branch (in the order given) that reaches it. Parents outside the window
 * are dropped, so the oldest shown commit is a root. `tips` maps each branch that still exists to its tip hash.
 */
export async function commitGraph(root, { base, branches = [], limit = 150 } = {}) {
  const ok = b => typeof b === "string" && b && !b.startsWith("-");
  const sh = async (...a) => { try { return (await git(root, ...a)).stdout; } catch { return null; } };
  if (!ok(base)) return { base: base ?? null, commits: [], tips: [] };
  const tips = [];
  for (const b of [base, ...new Set(branches)].filter(ok)) {
    const tip = (await sh("rev-parse", "--verify", "--quiet", `${b}^{commit}`))?.trim();
    if (tip && !tips.some(t => t.branch === b)) tips.push({ branch: b, hash: tip });
  }
  if (!tips.length) return { base, commits: [], tips: [] };
  const n = Math.max(1, Math.min(500, limit | 0));
  const log = await sh("log", "--date-order", `--max-count=${n}`, "--format=%H%x1f%P%x1f%ct%x1f%s", ...tips.map(t => t.hash), "--");
  const commits = (log ?? "").split("\n").filter(Boolean).map(line => {
    const [hash, parents, ct, subject] = line.split("\x1f");
    return { hash, parents: parents ? parents.split(" ") : [], branch: null, at: +ct * 1000 || null, subject: subject ?? "" };
  });
  const shown = new Set(commits.map(c => c.hash));
  for (const c of commits) c.parents = c.parents.filter(p => shown.has(p));
  // Owner per commit: base first, then each branch's own commits (base..branch), bounded by the same window.
  const owner = new Map();
  const claim = (list, b) => { for (const h of (list ?? "").split("\n")) if (h && shown.has(h) && !owner.has(h)) owner.set(h, b); };
  const baseTip = tips[0].branch === base ? tips[0].hash : null;
  if (baseTip) claim(await sh("rev-list", `--max-count=${n}`, baseTip, "--"), base);
  for (const t of tips) if (t.branch !== base) claim(await sh("rev-list", `--max-count=${n}`, t.hash, ...(baseTip ? [`^${baseTip}`] : []), "--"), t.branch);
  for (const c of commits) c.branch = owner.get(c.hash) ?? base;
  return { base, commits, tips };
}
