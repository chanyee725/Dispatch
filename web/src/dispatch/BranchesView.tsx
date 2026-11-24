// Live branch view (#792): every session branch with its owner sessions, issue, commits ahead/behind the integration
// branch, last commit, PR phase and uncommitted-work flag. BranchesPage is the 세션 보드 › 브랜치 tab, drawn as a commit
// tree (#877) and a table (#889); BranchesWidget is the compact list a dashboard can place (it loads its own data). Merged branches fade.
// Read-only, metadata only.
import { useId, useMemo, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { roleColor } from './lib/roles';
import { initials } from '../home/issueBoard';
import { boardHash } from '../projectNav';
import { ago, TONE_TEXT } from './lib/format.ts';
import { whenLabel } from '../lib/when';
import {
  aheadBehindText,
  BRANCH_STATE,
  branchState,
  branchSummary,
  LEGEND_STATES,
  PR_PHASE,
  prOffText,
  shownRows,
  type BranchRow,
  type BranchSession,
  type BranchState,
} from './lib/liveBranches.ts';
import { useScoped } from './scope';
import { useNow } from './AttentionStrip';
import { useBranchTree, useLiveBranches } from './useLiveBranches';
import { BranchTreeView } from './BranchTree';

function Owners({ sessions }: { sessions: BranchSession[] }) {
  if (!sessions.length) return <span className="text-muted-foreground">—</span>;
  const names = sessions.map((s) => `${s.name} (${s.roleName}${s.open ? '' : ', 끝남'})`).join(', ');
  return (
    <span className="inline-flex items-center" title={names}>
      <span className="sr-only">{names}</span>
      {sessions.slice(0, 3).map((s) => (
        <span
          key={s.id}
          aria-hidden
          className={cn('-ml-1 grid size-5 place-items-center rounded-full text-2xs font-semibold text-background ring-2 ring-background first:ml-0', !s.open && 'opacity-60')}
          style={{ background: roleColor(s.role) }}
        >
          {initials(s.name)}
        </span>
      ))}
      {sessions.length > 3 && <span aria-hidden className="ml-1 text-2xs text-muted-foreground tabular-nums">+{sessions.length - 3}</span>}
    </span>
  );
}

function AheadBehind({ row, base }: { row: BranchRow; base: string | null }) {
  return (
    <span className="tabular-nums whitespace-nowrap" title={aheadBehindText(row, base)}>
      <span className="sr-only">{aheadBehindText(row, base)}</span>
      <span aria-hidden className={row.ahead ? 'text-foreground' : 'text-muted-foreground'}>↑{row.ahead}</span>{' '}
      <span aria-hidden className={row.behind ? 'text-warn' : 'text-muted-foreground'}>↓{row.behind}</span>
    </span>
  );
}

function PrChip({ pr }: { pr: BranchRow['pr'] }) {
  if (!pr) return <span className="text-muted-foreground">—</span>;
  const p = PR_PHASE[pr.phase];
  const body = (
    <>
      <span className="tabular-nums">#{pr.number}</span> <span className={pr.phase === 'merged' ? 'text-merged' : TONE_TEXT[p.tone]}>{p.label}</span>
    </>
  );
  return pr.url ? (
    <a href={pr.url} target="_blank" rel="noreferrer" className="whitespace-nowrap rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {body}
    </a>
  ) : (
    <span className="whitespace-nowrap">{body}</span>
  );
}

/** Dot colour per state: the app's own state colours; 작업 중 takes the ink colour (the app's emphasis). */
const STATE_DOT: Record<BranchState, string> = {
  working: 'bg-foreground',
  review: 'bg-warn',
  passed: 'bg-ok',
  merged: 'bg-merged',
  conflict: 'bg-destructive',
  closed: 'bg-muted-foreground',
};

/** State chip (refresh rule): neutral ground, a small coloured dot carries the state, the label says it in words. */
function StateChip({ state, title, children }: { state: BranchState; title?: string; children: ReactNode }) {
  return (
    <span title={title} className="inline-flex h-5 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 text-xs font-medium whitespace-nowrap tabular-nums text-foreground">
      <span aria-hidden className={cn('size-[5px] shrink-0 rounded-full', STATE_DOT[state])} />
      {children}
    </span>
  );
}

/** 실시간 chip: the data refreshes on its own. The dot breathes only when motion is welcome. */
function LiveChip() {
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 text-xs font-medium text-ok">
      <span aria-hidden className="size-1.5 rounded-full bg-ok motion-safe:animate-[run-pulse_1.3s_ease-in-out_infinite_alternate]" />
      실시간
    </span>
  );
}

/**
 * 세션 보드 › 브랜치 (Branches.dc.html, #889): a live line (실시간, counts, last commit), the commit tree of the board's
 * project scope (#877) with the state legend, and the branch table. The tab's title comes from SessionBoard.
 */
export function BranchesPage() {
  const data = useLiveBranches();
  const tree = useBranchTree();
  const { sessions, scope } = useScoped();
  const now = useNow();
  const graphTitle = useId();
  const ids = useMemo(() => (scope === undefined ? null : new Set(sessions.map((s) => s.id))), [sessions, scope]);
  const rows = useMemo(() => (data && data !== 'failed' ? shownRows(data.rows, ids ? (s) => ids.has(s.id) : null) : []), [data, ids]);

  if (data === null || tree === null) return <p role="status" className="m-0 px-6 py-6 text-sm text-muted-foreground max-md:px-4">브랜치를 불러오는 중이에요.</p>;
  if (data === 'failed' || tree === 'failed') return <p role="alert" className="m-0 px-6 py-6 text-sm text-destructive max-md:px-4">브랜치를 불러오지 못했어요. 잠시 뒤 다시 시도해요.</p>;
  const off = prOffText(data.pr);
  const sum = branchSummary(rows);
  return (
    <section data-branches-page className="flex min-w-0 flex-col gap-4 px-5 pt-1 pb-5 max-md:px-4 lg:min-h-0 lg:flex-1">
      <div className="flex flex-wrap items-center gap-3">
        <LiveChip />
        <span className="flex-1" />
        <span data-branch-summary className="text-xs text-muted-foreground tabular-nums">
          브랜치 {sum.branches} · 열린 PR {sum.openPrs} · 마지막 커밋 {sum.lastAt ? whenLabel(sum.lastAt, now) : '—'}
        </span>
      </div>
      {off && <p className="m-0 text-xs text-muted-foreground">{off}</p>}
      {!rows.length ? (
        <p className="m-0 text-sm text-muted-foreground">세션 브랜치가 아직 없어요. worktree로 세션을 만들면 여기에 떠요.</p>
      ) : (
        // Graph 70%, branch list 30% (user, 2026-11-20): both fit the screen and scroll inside, so nothing hides below.
        <div data-branches-split className="grid min-w-0 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,7fr)_minmax(16rem,3fr)] lg:grid-rows-[minmax(0,1fr)]">
          <section aria-labelledby={graphTitle} className="card-surface flex min-w-0 flex-col gap-1.5 px-4 pt-3.5 pb-2 lg:min-h-0 lg:overflow-auto">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id={graphTitle} className="m-0 text-sm font-semibold">커밋 그래프</h2>
              <span className="text-xs text-muted-foreground">{data.base ?? '기준 브랜치'}에서 갈라진 순서대로 보여요</span>
              <span className="flex-1" />
              <ul aria-label="상태 범례" data-branch-legend className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {LEGEND_STATES.map((s) => (
                  <li key={s}><StateChip state={s}>{BRANCH_STATE[s]}</StateChip></li>
                ))}
              </ul>
            </div>
            <BranchTreeView
              tree={tree}
              rows={rows}
              now={now}
              renderTip={(r) => (
                <>
                  <Owners sessions={r.sessions} />
                  <StateChip state={branchState(r)}>{BRANCH_STATE[branchState(r)]}</StateChip>
                  {r.dirty && <span className="whitespace-nowrap text-warn" title="커밋하지 않은 변경이 있어요">● 변경 있음</span>}
                </>
              )}
            />
          </section>
          <BranchList rows={rows} base={data.base} now={now} />
        </div>
      )}
    </section>
  );
}

/** The 브랜치 tab's right column: every branch as a compact row (owners, name, last commit, ahead/behind, PR). */
function BranchList({ rows, base, now }: { rows: BranchRow[]; base: string | null; now: number }) {
  const title = useId();
  return (
    <section aria-labelledby={title} data-branch-list className="card-surface flex min-w-0 flex-col lg:min-h-0">
      <h2 id={title} className="m-0 border-b px-4 pt-3.5 pb-2 text-sm font-semibold">
        브랜치 <span className="font-normal text-muted-foreground tabular-nums">{rows.length}</span>
      </h2>
      <ul className="m-0 flex min-h-0 list-none flex-col overflow-auto p-0">
        {rows.map((r) => (
          <li key={r.branch} data-branch-row data-merged={r.merged || undefined} className={cn('flex min-w-0 flex-col gap-1 border-b px-4 py-2 text-xs last:border-b-0', r.merged && 'opacity-50')}>
            <span className="flex min-w-0 items-center gap-2">
              <Owners sessions={r.sessions} />
              <span className="min-w-0 flex-1 truncate font-mono text-2xs text-foreground" title={r.branch}>{r.branch}</span>
              {r.dirty && <span className="shrink-0 text-warn" title="커밋하지 않은 변경이 있어요">●<span className="sr-only">커밋하지 않은 변경 있음</span></span>}
            </span>
            <span className="block truncate text-muted-foreground" title={r.subject}>{r.lastAt ? whenLabel(r.lastAt, now) : '—'} · {r.subject}</span>
            <span className="flex min-w-0 items-center gap-2">
              <AheadBehind row={r} base={base} />
              <span className="ml-auto"><PrChip pr={r.pr} /></span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Compact branch list for a dashboard: the `limit` liveliest session branches of `folder` ('' or omitted = every
 * session of this server), with a link to the 세션 보드 › 브랜치 tab. Loads and refreshes its own data.
 */
export function BranchesWidget({ folder = '', limit = 5, className }: { folder?: string; limit?: number; className?: string }) {
  const data = useLiveBranches();
  const now = useNow();
  const all = useMemo(() => (data && data !== 'failed' ? shownRows(data.rows, folder ? (s) => s.folder === folder : null) : []), [data, folder]);
  const rows = all.slice(0, limit);
  const title = useId();
  return (
    <section data-branches-widget aria-labelledby={title} className={cn('flex min-w-0 flex-col gap-2', className)}>
      <header className="flex items-center justify-between gap-2">
        <h2 id={title} className="m-0 text-sm font-medium">브랜치</h2>
        <a
          href={boardHash({ tab: 'branches', folder: folder || undefined })}
          className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          전체 보기 <ArrowRight aria-hidden className="size-3" />
        </a>
      </header>
      {data === null ? (
        <p role="status" className="m-0 text-xs text-muted-foreground">불러오는 중이에요.</p>
      ) : data === 'failed' ? (
        <p role="alert" className="m-0 text-xs text-destructive">브랜치를 불러오지 못했어요.</p>
      ) : !rows.length ? (
        <p className="m-0 text-xs text-muted-foreground">세션 브랜치가 없어요.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.branch} data-branch-row data-merged={r.merged || undefined} className={cn('flex min-w-0 items-center gap-2 border-b py-1.5 text-sm last:border-b-0', r.merged && 'opacity-50')}>
              <Owners sessions={r.sessions} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs" title={r.branch}>{r.branch}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {r.lastAt ? ago(r.lastAt, now) : '—'} · {r.subject}
                </span>
              </span>
              {r.dirty && <span className="shrink-0 text-xs text-warn" title="커밋하지 않은 변경이 있어요">●<span className="sr-only">커밋하지 않은 변경 있음</span></span>}
              <span className="shrink-0 text-xs"><AheadBehind row={r} base={data.base} /></span>
              <span className="shrink-0 text-xs"><PrChip pr={r.pr} /></span>
            </li>
          ))}
        </ul>
      )}
      {data && data !== 'failed' && all.length > limit && <p className="m-0 text-xs text-muted-foreground tabular-nums">외 {all.length - limit}개</p>}
    </section>
  );
}
