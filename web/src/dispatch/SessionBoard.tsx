// 세션 보드 inside the Atelier shell (#731), as a card dashboard on the home's dash primitives (#879): no header or tab
// row and no 프로젝트 card (one project per server, #778; the scope still comes from the address). Left 60%: 세션;
// right 40%: 작업 보드, with 확인 필요 as its top group (#924); 사용량 lives in the sidebar and the 대시보드 (#919). Left, under the
// session cards: the 타임라인 card. `#board=usage` and `#board=branches` open their full screen in one card; the old
// `#board=timeline` opens this same screen and scrolls to the 타임라인 card.
// Rendered by App.tsx for `section.kind === 'board'` (the /dispatch address redirects there).
// Loaded lazily so the editor bundle does not carry it. Numbers and names only: no transcript text is read here.
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, MoreHorizontal, Plus } from 'lucide-react';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/PageHeader';
import { useProjectList } from './useProjectList';
import { boardHash, plainClick, type BoardExtra, type BoardTab } from '../projectNav';
import { Card, DashColumn, DashGrid, EmptyState } from '../home/dash';
import { OffNote, useDispatchStatus } from '../settings/DispatchOff';
import type { SectionId } from '../settings/model';
import { AlertWatcher } from './AlertWatcher';
import { AlwaysOnView } from './AlwaysOnView';
import { BranchesPage } from './BranchesView';
import { SummaryLine } from './AttentionStrip';
import { CreateSessionDialog } from './CreateSessionDialog';
import { boardGroups, type BoardGroup } from './lib/boardGroups.ts';
import { presenceOf } from './lib/presence.ts';
import { SessionCard, SessionGrid } from '../home/SessionCard';
import { TRAIL } from '../live/origin';
import { knownFolders, scopePending, type Scope } from './lib/folder.ts';
import { isOpen, stateOf } from './lib/format.ts';
import { ScopeProvider, useScope, useScoped } from './scope';
import { openAgentLive, useAgentLiveTarget } from '../live/store';
import { TimelineCard } from './TimelineCard';
import { TaskBoardCard } from './TaskBoard';
import { UsagePage } from './UsagePage';
import { api, connect, useDispatch } from './store';
import { usePrTracking, useStatusLine } from './usePrTracking';
import type { Session } from './types';
import { askConfirm } from '../appDialog';
import { useIssues, usePrTracking as usePrTrackingOn } from '../home/projectFeeds';
import { issueTitles, taskSummary, type TaskSummary } from '../home/taskSummary';

const SettingsDialog = lazy(() => import('../settings/SettingsDialog'));

export type BoardProps = {
  tab: BoardTab;
  /** undefined = 전체 프로젝트, null = 미분류, else a project folder path. */
  folder?: string | null;
  onRoute: (tab: BoardTab, folder: string | null | undefined) => void;
  /** A session to open, from a toast outside the board; `n` makes each request new. */
  openRequest?: { id: string; n: number } | null;
  /** 상시 화면 or 설정 asked for by the address (old /dispatch#tv, #settings); handled once, then `onExtraDone`. */
  extra?: BoardExtra | null;
  onExtraDone?: () => void;
  /** Narrow window: the header shows the sidebar trigger. */
  narrow?: boolean;
};

export default function SessionBoard(p: BoardProps) {
  const ready = useDispatch((s) => s.ready);
  const online = useDispatch((s) => s.online);
  const unavailable = useDispatch((s) => s.unavailable);
  const offStatus = useDispatchStatus();
  const [projects, listState] = useProjectList();
  const scope: Scope = p.folder;
  const known = useMemo(() => knownFolders(projects.map((x) => x.path), scope, listState === 'ready'), [projects, scope, listState]);
  const names = useMemo(() => new Map(projects.map((x) => [x.path, x.name])), [projects]);
  const pending = scopePending(scope, listState);
  const ctx = useMemo(() => ({ scope, known, names, pending }), [scope, known, names, pending]);
  useEffect(() => connect(), []);

  // The one place a session opens (design §4): its live progress view (#728). The sheet (chat, stop) is reached from there.
  const openSession = (id: string, from?: HTMLElement | null) => openAgentLive(id, { trigger: from ?? undefined, from: 'board' });
  const open = useAgentLiveTarget();
  const liveRef = useRef(open);
  liveRef.current = open;
  const openRef = useRef(openSession);
  openRef.current = openSession;
  useEffect(() => {
    if (p.openRequest && liveRef.current !== p.openRequest.id) openRef.current(p.openRequest.id, null);
  }, [p.openRequest]);

  const [tv, setTv] = useState(false);
  const [settings, setSettings] = useState<SectionId | null>(null);
  const [creating, setCreating] = useState(false);
  const done = useRef(p.onExtraDone);
  done.current = p.onExtraDone;
  useEffect(() => {
    if (!p.extra) return;
    if (p.extra === 'tv') setTv(true);
    else setSettings('general');
    done.current?.();
  }, [p.extra]);

  if (tv && ready && !unavailable) {
    return (
      <div className="fixed inset-0 z-40 overflow-auto bg-background">
        {/* Opening a tile leaves the always-on screen, so Esc in the sheet never also closes the wall view. */}
        <AlwaysOnView onExit={() => setTv(false)} onOpen={(id) => { setTv(false); openSession(id, null); }} />
      </div>
    );
  }

  const offline = ready && !online && !unavailable;
  const disabled = !ready || unavailable;
  const detail = p.tab === 'usage' || p.tab === 'branches' ? p.tab : null;
  return (
    <ScopeProvider value={ctx}>
      <div data-session-board className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {offline && <Alert variant="destructive">서버와 연결이 끊겼어요. 다시 연결하는 중이에요.</Alert>}
        {/* Same header as 대시보드 (2026-11-20); the 브랜치/사용량 views name themselves. */}
        {!detail && (
          <PageHeader
            title="세션 보드"
            narrow={p.narrow}
            actions={
              <>
                <BoardMenu onCreate={() => setCreating(true)} disabled={disabled} />
              </>
            }
          />
        )}
        <main className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto', offline && 'opacity-60')}>
          {/* The live region stays mounted so the notice is read when it appears. */}
          <div role="status">
            {listState === 'failed' && !unavailable && ready && (
              <p className="m-0 border-b px-4 py-2 text-sm text-muted-foreground">프로젝트 목록을 불러오지 못했어요. 작업 폴더 이름으로 묶어서 보여 줘요.</p>
            )}
          </div>
          {unavailable ? (
            <OffNote status={offStatus} className="m-4" />
          ) : !ready ? (
            <Skeleton />
          ) : detail ? (
            <DetailView tab={detail} scope={scope} onRoute={p.onRoute} narrow={p.narrow} />
          ) : (
            <DashGrid ratio="3fr 2fr" fill>
              {/* No 프로젝트 card: this server holds one project (#778). Left 60%: 세션; right 40%: 작업 보드, whose card
                  takes the spare height so neither column leaves an empty band (#879). */}
              <DashColumn label="세션" fill>
                <SessionsCard
                  onCreate={() => setCreating(true)}
                  byCwd={listState === 'failed'}
                />
                <TimelineCard projectId={scope} onOpen={(id) => openSession(id)} focus={p.tab === 'timeline'} />
              </DashColumn>
              {/* Sticky on a wide pane: 작업 보드 stays in view while 세션 scrolls. */}
              <DashColumn label="현황" fill>
                <TaskBoardCard fill onOpen={(id) => openSession(id)} onUsage={() => p.onRoute('usage', scope)} />
              </DashColumn>
            </DashGrid>
          )}
        </main>
        {creating && <CreateSessionDialog folder={typeof scope === 'string' ? scope : undefined} onClose={() => setCreating(false)} />}
        {settings && (
          <Suspense fallback={null}>
            <SettingsDialog section={settings} onClose={() => setSettings(null)} />
          </Suspense>
        )}
        <AlertWatcher onOpen={(id) => openSession(id, null)} />
      </div>
    </ScopeProvider>
  );
}

/** A link to a board address that routes in place on a plain click (a new tab still gets the address). */
function BoardLink({ tab, folder, onRoute, className, children, ...rest }: { tab: BoardTab; folder: Scope; onRoute: BoardProps['onRoute']; className?: string; children: ReactNode } & Omit<React.ComponentProps<'a'>, 'href' | 'onClick'>) {
  return (
    <a
      {...rest}
      href={boardHash({ tab, folder })}
      onClick={(e) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        onRoute(tab, folder);
      }}
      className={className}
    >
      {children}
    </a>
  );
}

/** `#board=usage` / `#board=branches`: that screen in one full-width card, with the way back to the dashboard. */
function DetailView({ tab, scope, onRoute, narrow }: { tab: 'usage' | 'branches'; scope: Scope; onRoute: BoardProps['onRoute']; narrow?: boolean }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        title={tab === 'usage' ? '사용량' : '브랜치'}
        narrow={narrow}
        actions={
          <Button size="sm" variant="ghost" asChild>
            <BoardLink tab="sessions" folder={scope} onRoute={onRoute}>
              <ArrowLeft aria-hidden />
              세션 보드
            </BoardLink>
          </Button>
        }
      />
      {/* 브랜치 fills the pane below the header (its two columns scroll inside), so the page itself never scrolls. */}
      <div data-card={tab} className={cn('min-w-0', tab === 'branches' && 'flex min-h-0 flex-1 flex-col')}>{tab === 'usage' ? <UsagePage /> : <BranchesPage />}</div>
    </div>
  );
}

/** ⋯ menu: 새 세션, 끝난 세션 정리, 모든 세션 정리 (asks first), PR·CI 추적. 브랜치 and 설정 are in the sidebar; 상시 화면 still opens from #board=tv. */
function BoardMenu({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  const sessions = useDispatch((s) => s.sessions);
  const doneCount = sessions.filter((s) => !isOpen(s)).length;
  const { note, status } = useStatusLine();
  const { pr, toggle, broken } = usePrTracking(status, '');
  const [said, setSaid] = useState('');
  const clear = async (all: boolean) => {
    if (all && !(await askConfirm({ title: `세션 ${sessions.length}개를 모두 정리할까요?`, body: '실행 중인 세션도 멈춰요.', ok: '모두 정리', danger: true }))) return;
    try {
      const r = await api<{ removed?: number }>('POST', all ? '/api/sessions/clear' : '/api/sessions/clear-done');
      setSaid(`세션 ${r?.removed ?? 0}개를 정리했어요.`);
    } catch {
      setSaid('정리하지 못했어요. 잠시 뒤에 다시 해 주세요.');
    }
  };
  const prNote = [broken, note].filter(Boolean).join(' ');
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="더 보기" title="더 보기" disabled={disabled}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {/* 새 세션 lives here since the header button went away (2026-11-20). */}
          <DropdownMenuItem onSelect={onCreate}>
            <Plus aria-hidden /> 새 세션
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!doneCount} onSelect={() => void clear(false)}>
            끝난 세션 정리{doneCount ? ` (${doneCount})` : ''}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!sessions.length} className="text-destructive focus:text-destructive" onSelect={() => void clear(true)}>
            모든 세션 정리
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={pr === true}
            disabled={pr === null || pr === 'unsupported'}
            title={pr === 'unsupported' ? '이 서버에선 바꿀 수 없어요' : prNote || '이 워크스페이스에서 gh로 PR과 CI 상태를 확인해요.'}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={toggle}
          >
            PR·CI 추적
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="sr-only">
        {said || prNote}
      </span>
    </>
  );
}

function Skeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="불러오는 중이에요" className="flex flex-col gap-6 p-4">
      {[0, 1].map((g) => (
        <div key={g} className="flex flex-col gap-2">
          <div className="h-4 w-32 rounded bg-muted motion-safe:animate-pulse" />
          {[0, 1, 2].map((r) => (
            <div key={r} className="h-11 rounded-lg bg-muted/60 motion-safe:animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 세션 card: the summary line, then the picked project's sessions as the dashboard's session cards,
 *  under a small title per project (#919). Finished sessions fold behind one link per group. */
function SessionsCard({
  onCreate,
  byCwd,
  actions,
}: {
  onCreate: () => void;
  byCwd: boolean;
  actions?: ReactNode;
}) {
  const { sessions, scope, pending } = useScoped();
  const { known, names } = useScope();
  // What each session works on (#912): issue title (the issue feed, while PR tracking is on), board task, branch, or the
  // lead's own summary.
  const tasks = useDispatch((s) => s.tasks);
  const issues = useIssues(usePrTrackingOn());
  const summaries = useMemo(() => {
    const titleOf = issueTitles(issues && issues !== 'failed' && issues.ok ? issues.issues : null);
    return new Map(sessions.map((s) => [s.id, taskSummary(s, titleOf, tasks)]));
  }, [sessions, tasks, issues]);
  const groups = useMemo(() => boardGroups(sessions, { known, names, stateOf, byCwd }), [sessions, known, names, byCwd]);
  return (
    <Card id="sessions" fill={1} title="세션" count={pending ? undefined : sessions.filter(isOpen).length} actions={actions}>
      <div className="flex min-w-0 flex-col gap-4">
        <SummaryLine />
        {pending ? null : sessions.length === 0 ? (
          <EmptyState
            className="px-0 py-2"
            action={
              <Button size="sm" variant="outline" onClick={onCreate}>
                <Plus aria-hidden />새 세션
              </Button>
            }
          >
            실행 중인 세션이 없어요. 새 세션을 만들면 여기에 보여요.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <Group key={g.key ?? '\0'} g={g} scoped={scope !== undefined} summaries={summaries} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function Group({ g, scoped, summaries }: { g: BoardGroup<Session>; scoped: boolean; summaries: Map<string, TaskSummary | null> }) {
  const head = useId();
  const [showDone, setShowDone] = useState(false);
  const shown = [...g.live, ...(showDone ? g.done : [])];
  return (
    <section aria-labelledby={head} className="flex min-w-0 flex-col">
      {/* One project: no title needed. Several: a small title with the live count. */}
      <h3 id={head} className={cn('m-0 truncate px-0.5 text-xs font-medium text-muted-foreground', scoped && 'sr-only')}>
        {g.label}
        <span className="ml-1.5 tabular-nums">{g.live.length}</span>
      </h3>
      {shown.length > 0 && (
        <div className="-mx-2">
          <SessionGrid label={`${g.label} 세션`}>
            {shown.map((s) => (
              <SessionCard key={s.id} agent={presenceOf(s, stateOf)} summary={summaries.get(s.id) ?? null} title={null} onOpen={() => undefined} trail={TRAIL.board} />
            ))}
          </SessionGrid>
        </div>
      )}
      {g.done.length > 0 && (
        <button
          type="button"
          aria-expanded={showDone}
          onClick={() => setShowDone((v) => !v)}
          className="h-8 self-start rounded-md px-2 text-left text-xs text-muted-foreground tabular-nums hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {showDone ? '끝난 세션 숨기기' : `끝난 세션 ${g.done.length}개 보기`}
        </button>
      )}
    </section>
  );
}
