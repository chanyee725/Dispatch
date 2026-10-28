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

export async function diff(cwd) {
  if (!(await hasHead(cwd))) {
    const { stdout } = await git(cwd, "status", "--porcelain").catch(() => ({ stdout: "" }));
    const files = stdout.split("\n").filter(Boolean);
    return { files: files.length, add: 0, del: 0, untracked: files.map(l => l.slice(3)), patch: "" };
  }
  const [num, patch, others] = await Promise.all([
    git(cwd, "diff", "HEAD", "--numstat"),
    git(cwd, "diff", "HEAD"),
    git(cwd, "ls-files", "--others", "--exclude-standard"),
  ].map(p => p.catch(() => ({ stdout: "" }))));
  let add = 0, del = 0, files = 0;
  for (const line of num.stdout.split("\n").filter(Boolean)) {
    const [a, d] = line.split("\t");
    add += +a || 0; del += +d || 0; files++;
  }
  const untracked = others.stdout.split("\n").filter(Boolean);
  const LIMIT = 200_000;
  const p = patch.stdout.length > LIMIT ? patch.stdout.slice(0, LIMIT) + "\n… (잘림)" : patch.stdout;
  return { files: files + untracked.length, add, del, untracked, patch: p };
}
