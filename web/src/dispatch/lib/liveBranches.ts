// Live branch view (#792): the wire shape of GET /api/branches/live and pure helpers for the 브랜치 tab and the
// dashboard widget. No browser APIs here, so tests run under node.

export type PrPhase = 'draft' | 'review' | 'mergeable' | 'conflict' | 'merged' | 'closed';
export type BranchSession = { id: string; name: string; role: string; roleName: string; color: string | null; folder: string | null; open: boolean };
export type BranchRow = {
  branch: string;
  sessions: BranchSession[];
  issue: number | null;
  ahead: number;
  behind: number;
  /** Tip commit time (ms), null when git did not say. */
  lastAt: number | null;
  subject: string;
  /** Uncommitted work in an open session's worktree; null when no open worktree or git could not tell. */
  dirty: boolean | null;
  merged: boolean;
  pr: { number: number; phase: PrPhase; url?: string } | null;
};
/** `pr`: "on", or why PRs are missing ("disabled", "gh-missing", "not-logged-in"). */
export type LiveBranches = { base: string | null; pr: string; rows: BranchRow[] };

export const PR_PHASE: Record<PrPhase, { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' }> = {
  draft: { label: '초안', tone: 'idle' },
  review: { label: '리뷰 중', tone: 'warn' },
  mergeable: { label: '병합 가능', tone: 'ok' },
  conflict: { label: '충돌', tone: 'bad' },
  merged: { label: '병합됨', tone: 'idle' },
  closed: { label: '닫힘', tone: 'idle' },
};

/** Why the PR column is empty, in a short line; null when PRs are tracked. */
export function prOffText(reason: string): string | null {
  if (reason === 'on') return null;
  if (reason === 'disabled') return 'PR 추적이 꺼져 있어서 PR 상태는 보이지 않아요.';
  if (reason === 'gh-missing') return 'gh를 찾지 못해서 PR 상태는 보이지 않아요.';
  if (reason === 'not-logged-in') return 'gh에 로그인하지 않아서 PR 상태는 보이지 않아요.';
  return null;
}

/**
 * Rows to show: those with a session in `keep` (null keeps all), live work first (open session, not merged), then by
 * last commit, newest first. Merged rows stay, last, so the UI can fade them.
 */
export function shownRows(rows: readonly BranchRow[], keep: ((s: BranchSession) => boolean) | null = null): BranchRow[] {
  const live = (r: BranchRow) => Number(!r.merged) * 2 + Number(r.sessions.some((s) => s.open));
  return rows
    .filter((r) => !keep || r.sessions.some(keep))
    .sort((a, b) => live(b) - live(a) || (b.lastAt ?? 0) - (a.lastAt ?? 0));
}

/** "3↑ 1↓" text for screen readers and titles. */
export const aheadBehindText = (r: Pick<BranchRow, 'ahead' | 'behind'>, base: string | null) =>
  `${base ?? '기준 브랜치'}보다 ${r.ahead}개 앞서고 ${r.behind}개 뒤처져 있어요`;

/** GET /api/branches/tree (#877): commits newest first, metadata only. */
export type TreeCommit = { hash: string; parents: string[]; branch: string; at: number | null; subject: string };
export type BranchTree = { base: string | null; commits: TreeCommit[]; tips: { branch: string; hash: string }[] };

/** One graph row: the commit plus, at a branch tip, that branch's live row (null on the base or a plain commit). */
export type TreeEntry = {
  hash: string;
  parents: string[];
  branch: string;
  message: string;
  committerDate: string;
  at: number | null;
  tips: string[];
  row: BranchRow | null;
};

/**
 * Graph rows for the 브랜치 tab: the base branch's commits and those of `rows` (already scoped and sorted), newest
 * first. Commits of other branches go, and so do parents that are not shown, so lanes never point at nothing.
 */
export function treeEntries(tree: BranchTree, rows: readonly BranchRow[]): TreeEntry[] {
  const byBranch = new Map(rows.map((r) => [r.branch, r]));
  const keep = (b: string) => b === tree.base || byBranch.has(b);
  const commits = tree.commits.filter((c) => keep(c.branch));
  const shown = new Set(commits.map((c) => c.hash));
  const tipsAt = new Map<string, string[]>();
  for (const t of tree.tips) if (keep(t.branch) && shown.has(t.hash)) tipsAt.set(t.hash, [...(tipsAt.get(t.hash) ?? []), t.branch]);
  return commits.map((c) => {
    const tips = tipsAt.get(c.hash) ?? [];
    const own = tips.find((b) => b !== tree.base);
    return {
      hash: c.hash,
      parents: c.parents.filter((p) => shown.has(p)),
      branch: c.branch,
      message: c.subject,
      committerDate: new Date(c.at ?? 0).toISOString(),
      at: c.at,
      tips,
      row: own ? byBranch.get(own) ?? null : null,
    };
  });
}

/** Screen-reader summary of the tree: how many branches and commits, against which base. */
export const treeSummary = (entries: readonly TreeEntry[], base: string | null) => {
  const branches = new Set(entries.map((e) => e.branch));
  return `${base ?? '기준 브랜치'} 기준, 세션 브랜치 ${Math.max(0, branches.size - (base && branches.has(base) ? 1 : 0))}개, 커밋 ${entries.length}개`;
};

/**
 * A branch's state for the 브랜치 tab's chips and legend (#889, Branches.dc.html): 작업 중 (no PR or a draft), PR 리뷰,
 * 체크 통과 (mergeable), 머지됨; 충돌 and 닫힘 sit outside the legend. `label` is the table chip text.
 */
export type BranchState = 'working' | 'review' | 'passed' | 'merged' | 'conflict' | 'closed';
export const BRANCH_STATE: Record<BranchState, string> = {
  working: '작업 중',
  review: 'PR 리뷰',
  passed: '체크 통과',
  merged: '머지됨',
  conflict: '충돌',
  closed: '닫힘',
};
/** The four legend states, in the design's order. */
export const LEGEND_STATES: readonly BranchState[] = ['working', 'review', 'passed', 'merged'];

export function branchState(r: Pick<BranchRow, 'merged' | 'pr'>): BranchState {
  if (r.merged || r.pr?.phase === 'merged') return 'merged';
  switch (r.pr?.phase) {
    case 'review':
      return 'review';
    case 'mergeable':
      return 'passed';
    case 'conflict':
      return 'conflict';
    case 'closed':
      return 'closed';
    default:
      return 'working';
  }
}

/** Header line numbers: shown branches, open PRs among them, and the newest commit time (null when none). */
export function branchSummary(rows: readonly BranchRow[]): { branches: number; openPrs: number; lastAt: number | null } {
  let openPrs = 0;
  let lastAt: number | null = null;
  for (const r of rows) {
    if (r.pr && !r.merged && r.pr.phase !== 'merged' && r.pr.phase !== 'closed') openPrs++;
    if (r.lastAt != null && (lastAt == null || r.lastAt > lastAt)) lastAt = r.lastAt;
  }
  return { branches: rows.length, openPrs, lastAt };
}
