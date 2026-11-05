import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

const run = promisify(execFile);
const git = (cwd, ...args) => run("git", ["-C", cwd, ...args], { maxBuffer: 32 << 20 });

export async function projectRoot(dir) {
  try { return (await git(dir, "rev-parse", "--show-toplevel")).stdout.trim(); } catch { return dir; }
}

export async function currentBranch(dir) {
  try { return (await git(dir, "branch", "--show-current")).stdout.trim() || "HEAD"; } catch { return null; }
}

async function hasHead(dir) {
  try { await git(dir, "rev-parse", "--verify", "HEAD"); return true; } catch { return false; }
}

// Keep .dispatch/ (worktrees, state) out of `git status` without touching the tracked .gitignore.
async function ensureExcluded(root) {
  const file = path.join(root, ".git", "info", "exclude");
  try {
    const cur = await readFile(file, "utf8").catch(() => "");
    if (!cur.split("\n").includes(".dispatch/")) {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, (cur.endsWith("\n") || !cur ? "" : "\n") + ".dispatch/\n");
    }
  } catch { /* not a git repo */ }
}

// Returns { cwd, branch, worktree, warning }. Falls back to the project dir when a worktree can't be made.
export async function prepareWorkdir(root, slug, useWorktree) {
  if (!useWorktree) return { cwd: root, branch: await currentBranch(root), worktree: false };
  if (!(await hasHead(root))) {
    return { cwd: root, branch: await currentBranch(root), worktree: false,
      warning: "커밋이 없는 레포라 worktree를 만들 수 없어 프로젝트 폴더에서 실행해요." };
  }
  await ensureExcluded(root);
  const dir = path.join(root, ".dispatch", "wt", slug);
  const branch = `dispatch/${slug}`;
  try {
    await git(root, "worktree", "add", dir, "-b", branch);
  } catch (e) {
    return { cwd: root, branch: await currentBranch(root), worktree: false,
      warning: `worktree 생성 실패: ${String(e.stderr || e.message).trim().slice(0, 200)}` };
  }
  const warning = await shareDeps(root, dir);
  return { cwd: dir, branch, worktree: true, ...(warning && { warning }) };
}

/**
 * A fresh worktree has no node_modules, and sessions burned 10+ minutes on it: a symlink breaks
 * bundlers that refuse files outside the project root (Next/Turbopack font imports), so e2e servers
 * timed out. Hard links give real files inside the worktree at no disk cost (~0.4 s for 46k files);
 * macOS clones with APFS copy-on-write. Other platforms keep the old behaviour.
 */
async function shareDeps(root, dir) {
  const src = path.join(root, "node_modules"), dst = path.join(dir, "node_modules");
  if (!existsSync(src) || existsSync(dst)) return null;
  const args = process.platform === "linux" ? ["-al", src, dst] : process.platform === "darwin" ? ["-Rc", src, dst] : null;
  if (!args) return null;
  try { await run("cp", args); return null; }
  catch (e) { return `node_modules를 작업 폴더에 연결하지 못했어요: ${String(e.stderr || e.message).trim().slice(0, 160)}`; }
}

/**
 * Drops a removed session's worktree when nothing would be lost: no uncommitted or untracked
 * files outside build noise. The branch and its commits stay. Worktrees of removed sessions
 * otherwise piled up (37 GB across ~100 of them).
 */
export async function dropWorktree(root, dir) {
  if (!dir || path.resolve(dir) === path.resolve(root) || !existsSync(dir)) return false;
  const st = await out(git(dir, "status", "--porcelain"));
  if (st.split("\n").filter(Boolean).map(l => l.slice(3)).some(f => keep(f.replace(/\/$/, "")))) return false;
  try { await git(root, "worktree", "remove", "--force", dir); return true; } catch { return false; }
}

const NOISE = ["node_modules", ".next", ".next-prod", "dist", ".playwright-mcp", "test-results", "playwright-report"];
const keep = f => !NOISE.some(n => f === n || f.startsWith(`${n}/`));
const out = p => p.then(r => r.stdout, () => "");

/**
 * What a session changed. In a worktree: everything on its branch since it left the project's
 * branch (commits + uncommitted edits), so committed work stays visible. Once the branch is merged
 * back, its own commits' patches. In the project folder: uncommitted changes against HEAD.
 */
export async function diff(cwd, root = cwd) {
  if (!(await hasHead(cwd))) {
    const files = (await out(git(cwd, "status", "--porcelain"))).split("\n").filter(Boolean).map(l => l.slice(3)).filter(keep);
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
  const untracked = others.split("\n").filter(Boolean).filter(keep);
  const LIMIT = 200_000;
  const p = patch.length > LIMIT ? patch.slice(0, LIMIT) + "\n… (잘림)" : patch;
  return { files: changed.size + untracked.length, add, del, untracked, patch: p, commits, base: baseName, merged };
}

/**
 * Commit graph of the project's main branch plus every dispatch/* branch, for the UI to draw who
 * branched off what and what merged back. Returns commits newest-first with parent links, the
 * branch tips, and which branch each session HEAD sits on (by matching session.branch).
 */
export async function branchGraph(root, { base = "develop", limit = 80, active = [] } = {}) {
  const activeSet = new Set(active);
  const sh = async (...a) => { try { return (await git(root, ...a)).stdout; } catch { return ""; } };
  // Pick the base branch: prefer develop, else main/master, else current.
  const branches = (await sh("for-each-ref", "--format=%(refname:short)", "refs/heads")).split("\n").map(s => s.trim()).filter(Boolean);
  const mainB = [base, "main", "master"].find(b => branches.includes(b)) ?? (await currentBranch(root)) ?? "HEAD";
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
    tips.push({ branch: b, hash: tip, short: tip.slice(0, 7), ahead: b === mainB ? 0 : (aheadOf.get(b) ?? 0), base: b === mainB, active: activeSet.has(b) });
  }
  return { base: mainB, commits, tips };
}
