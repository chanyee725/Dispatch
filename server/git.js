import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

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
  return { cwd: dir, branch, worktree: true };
}

const NOISE = ["node_modules", ".next", ".next-prod", "dist", ".playwright-mcp"];
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
