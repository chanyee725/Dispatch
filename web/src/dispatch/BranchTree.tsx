// Commit tree for 세션 보드 › 브랜치 (#877): the integration branch and every session branch as lanes, like a network
// graph, with merge points. The tip row of each session branch carries its sessions, ahead/behind, PR and worktree
// state; the 브랜치 tab puts it in its 커밋 그래프 card (#889). Lanes come from react-git-log (Apache-2.0, see NOTICE.md); rows and colours are ours. Metadata only.
import { useId, useMemo, type ReactNode } from 'react';
import { GitLog, type Commit } from '@tomplum/react-git-log';
import { GitBranch } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTheme } from '../theme';
import { whenLabel } from '../lib/when';
import { treeEntries, treeSummary, type BranchRow, type BranchTree, type TreeEntry } from './lib/liveBranches.ts';

/** Lane colours: the base lane is quiet, session lanes take the role tokens in turn. */
const LANE_TOKENS = ['--muted-foreground', '--role-impl', '--role-lead', '--role-test', '--role-review', '--role-design', '--role-merge'];
const FALLBACK = ['rgb(140, 140, 140)', 'rgb(84, 134, 230)', 'rgb(140, 96, 220)', 'rgb(70, 170, 130)', 'rgb(215, 150, 60)', 'rgb(220, 90, 120)', 'rgb(50, 160, 175)'];

/** react-git-log mixes colours as `rgb(r, g, b)`, so each token (oklch) is painted once on a 1px canvas and read back. */
function laneColours(): string[] {
  if (typeof document === 'undefined') return FALLBACK;
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return FALLBACK;
  const css = getComputedStyle(document.documentElement);
  return LANE_TOKENS.map((t, i) => {
    const v = css.getPropertyValue(t).trim();
    if (!v) return FALLBACK[i];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = FALLBACK[i];
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  });
}

export function BranchTreeView({
  tree,
  rows,
  now,
  renderTip,
}: {
  tree: BranchTree;
  rows: BranchRow[];
  now: number;
  /** The session/PR/worktree cells for a session branch's tip row. */
  renderTip: (row: BranchRow) => ReactNode;
}) {
  const [theme] = useTheme();
  const label = useId();
  const entries = useMemo(() => treeEntries(tree, rows), [tree, rows]);
  // Recomputed when the theme flips: the tokens differ per theme.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colours = useMemo(laneColours, [theme]);
  const lanes = useMemo(() => new Set(entries.map((e) => e.branch)).size, [entries]);
  if (!entries.length || !tree.base) return <p className="m-0 text-sm text-muted-foreground">보여 줄 커밋이 아직 없어요.</p>;
  return (
    <div
      tabIndex={0}
      role="region"
      aria-labelledby={label}
      data-branch-tree
      className="max-w-full overflow-auto rounded-control focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_*]:font-[inherit]"
    >
      <p id={label} className="sr-only">
        커밋 트리, {treeSummary(entries, tree.base)}
      </p>
      <GitLog<TreeEntry>
        entries={entries}
        currentBranch={tree.base}
        theme={theme === 'dark' ? 'dark' : 'light'}
        colours={colours}
        showHeaders={false}
        showGitIndex={false}
        defaultGraphWidth={Math.min(360, Math.max(64, lanes * 24 + 24))}
        enablePreviewedCommitStyling={false}
        enableSelectedCommitStyling={false}
        classes={{ containerClass: 'min-w-[44rem] py-2 text-sm' }}
      >
        <GitLog.GraphCanvas2D nodeSize={10} nodeTheme="plain" />
        <GitLog.Table row={({ commit }) => <TreeRow commit={commit as Commit<TreeEntry>} base={tree.base} now={now} renderTip={renderTip} />} />
      </GitLog>
    </div>
  );
}

function TreeRow({ commit: c, base, now, renderTip }: { commit: Commit<TreeEntry>; base: string | null; now: number; renderTip: (row: BranchRow) => ReactNode }) {
  const row = c.row ?? null;
  const baseTip = base != null && (c.tips ?? []).includes(base);
  return (
    <div
      data-branch-row={row ? '' : undefined}
      data-merged={row?.merged || undefined}
      // h-10 = the graph's fixed 40px row (react-git-log ROW_HEIGHT); a custom row gets no height from the library.
      className={cn('flex h-10 min-w-0 shrink-0 items-center gap-3 pr-3 text-foreground', row?.merged && 'opacity-50')}
    >
      <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">{c.at ? whenLabel(c.at, now) : '—'}</span>
      {row ? (
        <span className="flex min-w-0 shrink-0 items-center gap-1.5">
          <GitBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="max-w-[16rem] truncate font-mono text-xs font-medium" title={row.branch}>{row.branch}</span>
          {row.issue != null && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">#{row.issue}</span>}
          {row.merged && <span className="shrink-0 text-xs text-muted-foreground">병합됨</span>}
        </span>
      ) : baseTip ? (
        <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
          <GitBranch aria-hidden className="size-3.5 shrink-0" />
          <span className="font-mono text-xs">{base}</span>
        </span>
      ) : null}
      <span className={cn('min-w-0 flex-1 truncate', !row && 'text-muted-foreground')} title={c.message}>{c.message}</span>
      {row && <span className="flex shrink-0 items-center gap-3 text-xs">{renderTip(row)}</span>}
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.hash.slice(0, 7)}</span>
    </div>
  );
}
