// The agent live view panel (E559, #728; docs/design/agent-live-view.md §1-3): a non-modal <dialog popover="manual">
// on the right edge (a bottom sheet under 720px). The page stays usable behind it. One panel at a time; opening another
// agent swaps the content. Closes with ✕, Esc while focus is inside, or the same trigger again; focus then goes back
// to the trigger (store.ts). Hidden while a SessionSheet (modal) is open and shown again when it closes.
// Tabs (#905): 진행 (metadata only: tool labels, short targets, shown paths, numbers; the one exception is the redacted
// question a waiting session asks, #886), 작업 보기, and the session's own 대화 · 변경사항 · 정보 · 조직도 (AgentLiveSession, #943), so
// no SessionSheet opens over the panel. Touched files link: a document opens in the editor, a code file in 작업 보기.
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ArrowLeft, Check, Code, Eye, FileText, Pencil, X } from 'lucide-react';
import type { AgentLive, LiveAction, LiveFile } from '../../../shared/dispatch/live.ts';
import type { Session, SessionState } from '../../../shared/dispatch/types.ts';
import { fmtK, fmtUsd, stateOf, totalTok, ago } from '../dispatch/lib/format.ts';
import { useAgents } from '../home/useAgents';
import type { AgentPresence } from '../home/agents';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { clock, hhmm, middle, span, ticking, waitNote } from './format';
import { LiveSummaryView, useNow, type SummaryData } from './AgentLiveSummary';
import { closeAgentLive, useAgentLiveTarget, useAgentLiveTrail, useSheetOpen } from './store';
import { PanelTrail } from './PanelTrail';
import { usePanelExit } from './usePanelExit';
import { trackProps, trackTone } from '../home/trackTone';
import { closeIssueTeam, useIssueTeamTarget } from './issueStore';
import { useAgentLive } from './useAgentLive';
import { AgentWorkView } from './AgentWorkView';
import type { SessionTab } from './AgentLiveSession';
import { actionFileLink, fileLink, type FileLink } from './workView';
import './live.css';

const AgentLiveSession = lazy(() => import('./AgentLiveSession'));
const SessionActions = lazy(() => import('./SessionActions'));

type Tab = 'progress' | 'work' | SessionTab;
const TABS: [Tab, string][] = [['progress', '진행'], ['work', '작업 보기'], ['chat', '대화'], ['diff', '변경사항'], ['info', '정보'], ['org', '조직도']];

/** Mounted once in App.tsx. A SessionSheet opened elsewhere (세션 보드) still hides the panel while it is open. */
export function AgentLiveHost() {
  // Kept mounted for the 160ms slide-out after closing (#942).
  const { shown: sid, closing } = usePanelExit(useAgentLiveTarget());
  const sheetOpen = useSheetOpen();
  return sid ? <AgentLivePanel key="live" sid={sid} hidden={sheetOpen} closing={closing} /> : null;
}

function AgentLivePanel({ sid, hidden, closing }: { sid: string; hidden: boolean; closing: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const teamIssue = useIssueTeamTarget();
  const fromTeam = teamIssue != null;
  const trail = useAgentLiveTrail();
  const { live, session, error, loading, online, reload } = useAgentLive(sid);
  const { agents } = useAgents();
  const presence = Array.isArray(agents) ? (agents.find((a) => a.sid === sid) ?? null) : null;
  const outside = sid.startsWith('outside:');
  const state: SessionState | null = session ? stateOf(session) : ((presence?.state as SessionState | null) ?? null);
  const now = useNow(!!state && ticking(state));
  // Back to 진행 for another agent. `reveal`: the code file a link asked 작업 보기 to unfold.
  const [tab, setTab] = useState<Tab>('progress');
  const [reveal, setReveal] = useState<string | null>(null);
  useEffect(() => {
    setTab('progress');
    setReveal(null);
  }, [sid]);
  const openLink = (l: FileLink) => {
    // Documents are no longer opened in the app; only code files have a view here.
    if (l.kind === 'doc') return;
    setReveal(l.path);
    setTab('work');
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const open = el.matches(':popover-open');
    if (hidden && open) el.hidePopover();
    else if (!hidden && !open) el.showPopover();
  }, [hidden]);

  // Focus the first control when the panel opens or switches to another agent (not on every data change).
  useEffect(() => {
    if (!hidden) closeBtn.current?.focus({ preventScroll: true });
  }, [sid, hidden]);

  const name = session?.name ?? presence?.name ?? '';
  // The working track under the head (#942): the same tone as this session's card.
  const track = trackProps(trackTone(presence?.statusLabel ?? session?.activity?.label, state === 'working' || state === 'waiting' ? state : null));
  const d: SummaryData = {
    sid,
    name: name || '에이전트',
    color: session?.color ?? presence?.color,
    role: session?.roleName ?? presence?.roleName ?? (outside ? '외부 API' : undefined),
    provider: session?.provider ?? presence?.provider,
    modelLabel: session?.modelLabel ?? presence?.modelLabel ?? undefined,
    state,
    stateSince: session?.stateSince ?? null,
    current: live?.current ?? null,
    step: presence?.step,
  };

  return (
    <dialog
      ref={ref}
      popover="manual"
      aria-label={`${name || '에이전트'} 작업 진행상황`}
      className="agent-live"
      data-agent-live={sid}
      data-closing={closing || undefined}
      inert={closing || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          closeAgentLive();
        }
      }}
    >
      <header className="agent-live-head">
        {fromTeam && (
          <button type="button" aria-label="팀 패널로 돌아가기" data-live-back onClick={closeAgentLive} className={cn('agent-live-icon', FOCUS_RING)}>
            <ArrowLeft aria-hidden className="size-4" />
          </button>
        )}
        <div className="grid min-w-0 gap-2">
          {trail.length > 0 && (
            <PanelTrail
              steps={trail}
              current={name || '에이전트'}
              // The step right before the name is the team panel when opened from one: back there only; anything
              // earlier goes back to the dashboard (both panels close, focus lands on the card or row).
              onBack={(i) => {
                closeAgentLive();
                if (!fromTeam || i < trail.length - 1) closeIssueTeam();
              }}
            />
          )}
          <LiveSummaryView d={d} now={now} titleId={titleId} plain />
          <span aria-hidden {...track} />
        </div>
        {tab === 'chat' && !outside && (
          <Suspense fallback={null}><SessionActions sid={sid} onRemoved={closeAgentLive} /></Suspense>
        )}
        <button ref={closeBtn} type="button" aria-label="닫기" onClick={() => { closeAgentLive(); closeIssueTeam(); }} className={cn('agent-live-icon', FOCUS_RING)}>
          <X aria-hidden className="size-4" />
        </button>
      </header>
      {!online && <p className="agent-live-offline">연결이 끊겼어요. 다시 연결하는 중…</p>}
      {/* Reloading after a reconnect failed while older data is still shown: say it is old, offer a retry. */}
      {online && error === 'failed' && live && (
        <p className="agent-live-offline agent-live-stale" role="status" data-live-stale>
          <span>최신 내용을 불러오지 못했어요. 이전 내용이에요.</span>
          <button type="button" onClick={reload} className={cn('agent-live-link', FOCUS_RING)}>다시 시도</button>
        </p>
      )}
      {error === 'missing' ? (
        <div className="agent-live-body"><Gone /></div>
      ) : outside ? (
        <div className="agent-live-body"><OutsideBody presence={presence} onOpenLink={openLink} now={now} /></div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); if (v !== 'work') setReveal(null); }} className="agent-live-tabs">
          <TabsList aria-label="에이전트 보기" className="agent-live-tablist">
            {TABS.map(([v, label]) => (
              <TabsTrigger key={v} value={v} className="agent-live-tab" data-live-tab={v}>{label}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="progress" className="agent-live-body">
            {error === 'failed' && !live ? (
              <section>
                <p className="agent-live-error">진행상황을 불러오지 못했어요</p>
                <button type="button" onClick={reload} className={cn('agent-live-btn', FOCUS_RING)}>다시 시도</button>
              </section>
            ) : (
              <Body live={live} session={session} loading={loading && !live} step={presence?.step} now={now} onOpenLink={openLink} state={state} onChat={() => setTab('chat')} />
            )}
          </TabsContent>
          <TabsContent value="work" className="agent-live-body">
            <AgentWorkView
              sid={sid}
              step={presence?.step}
              statusLabel={presence?.statusLabel}
              files={live?.files ?? []}
              shown={!hidden}
              reveal={reveal}
            />
          </TabsContent>
          {(['chat', 'diff', 'info', 'org'] as const).map((v) => (
            <TabsContent key={v} value={v} className="agent-live-body agent-live-body-session">
              <Suspense fallback={<section><p className="agent-live-muted">불러오는 중이에요…</p></section>}>
                <AgentLiveSession sid={sid} tab={v} />
              </Suspense>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </dialog>
  );
}

function Gone() {
  return (
    <section>
      <p className="agent-live-muted">이 에이전트를 찾을 수 없어요</p>
      <button type="button" onClick={closeAgentLive} className={cn('agent-live-btn', FOCUS_RING)}>닫기</button>
    </section>
  );
}

function Skeleton() {
  return (
    <ul className="agent-live-skeleton" aria-hidden>
      <li /><li /><li />
    </ul>
  );
}

function Body({ live, session, loading, step, now, state, onOpenLink, onChat }: {
  live: AgentLive | null; session: Session | null; loading: boolean; step?: string; now: number; state: SessionState | null;
  onOpenLink: (l: FileLink) => void; onChat: () => void;
}) {
  if (loading) return <section><Skeleton /></section>;
  const cur = live?.current ?? null;
  const ctx = session && session.ctxWindow > 0 ? Math.min(1, session.ctx / session.ctxWindow) : null;
  return (
    <>
      {state === 'waiting' && (
        <section className="agent-live-ask">
          <p className="line-clamp-3 min-w-0 break-words" title={waitNote(session)}>{waitNote(session)}</p>
          <button type="button" onClick={onChat} className={cn('agent-live-btn', FOCUS_RING)}>대화 보기</button>
        </section>
      )}
      <section>
        <dl className="agent-live-now">
          {step && (
            <div>
              <dt>단계</dt>
              <dd className="truncate" title={step}>{step}</dd>
            </div>
          )}
          <div>
            <dt>지금</dt>
            {cur ? (
              <dd className="agent-live-row agent-live-current">
                <span className="shrink-0">{cur.label}</span>
                <Target target={cur.target} link={actionFileLink(cur, live?.files ?? [])} onOpenLink={onOpenLink} />
                <span className="agent-live-time">{clock(now - cur.at)}</span>
              </dd>
            ) : (
              <dd className="agent-live-muted">도구 실행 없음</dd>
            )}
          </div>
        </dl>
      </section>
      {session && (
        <section>
          <dl className="agent-live-stats">
            <div><dt>경과</dt><dd>{span(now - session.startedAt)}</dd></div>
            <div><dt>토큰</dt><dd>{fmtK(totalTok(session.usage))}</dd></div>
            {session.cost != null && <div><dt>비용</dt><dd>{fmtUsd(session.cost)}</dd></div>}
          </dl>
          {ctx != null && (
            <div className="agent-live-ctx">
              <span>컨텍스트</span>
              <meter min={0} max={1} low={0.75} high={0.9} optimum={0} value={ctx} aria-label="컨텍스트 사용량" />
              <span className="tabular-nums">{Math.round(ctx * 100)}%</span>
            </div>
          )}
        </section>
      )}
      <section>
        <h3>최근 행동</h3>
        {live?.recent.length ? (
          <ol className="agent-live-list">
            {live.recent.map((a) => <ActionRow key={a.id} a={a} link={actionFileLink(a, live.files)} onOpenLink={onOpenLink} />)}
          </ol>
        ) : (
          <p className="agent-live-muted">아직 행동이 없어요</p>
        )}
      </section>
      <Files files={live?.files ?? []} now={now} onOpenLink={onOpenLink} />
    </>
  );
}

/** A tool call's target: a button when it is a linkable file (in-panel action, so a button, not a link). */
function Target({ target, link, max, onOpenLink }: { target: string; link: FileLink | null; max?: number; onOpenLink: (l: FileLink) => void }) {
  if (!link) return <span className="agent-live-target" title={target}>{middle(target, max)}</span>;
  return (
    <button
      type="button"
      className={cn('agent-live-link agent-live-target', FOCUS_RING)}
      title={link.kind === 'doc' ? `${link.path} 문서 열기` : `${link.path} 작업 보기에서 보기`}
      data-live-link={link.kind}
      onClick={() => onOpenLink(link)}
    >
      {middle(target, max)}
    </button>
  );
}

function ActionRow({ a, link, onOpenLink }: { a: LiveAction; link: FileLink | null; onOpenLink: (l: FileLink) => void }) {
  return (
    <li className="agent-live-row" data-live-action={a.id}>
      <span className="agent-live-at">{hhmm(a.at)}</span>
      <span className="shrink-0">{a.label}</span>
      <Target target={a.target} link={link} max={60} onOpenLink={onOpenLink} />
      <span className="agent-live-ok">
        {a.ok === true ? (
          <><Check aria-hidden className="size-3.5 text-ok" /><span className="sr-only">성공</span></>
        ) : a.ok === false ? (
          <><X aria-hidden className="size-3.5 text-destructive" /><span className="sr-only">실패</span></>
        ) : (
          <span className="sr-only">실행 중</span>
        )}
      </span>
    </li>
  );
}

function Files({ files, now, onOpenLink }: { files: LiveFile[]; now: number; onOpenLink: (l: FileLink) => void }) {
  return (
    <section>
      <h3>
        건드린 파일
        {files.length > 0 && <> <span className="agent-live-count">{files.length}개</span></>}
      </h3>
      {files.length ? (
        <ul className="agent-live-list">
          {files.map((f) => {
            const link = fileLink(f);
            return (
              <li key={f.path} className="agent-live-row agent-live-file" data-live-file={f.path}>
                {f.edited ? <Pencil aria-hidden className="size-3.5 shrink-0" /> : <Eye aria-hidden className="size-3.5 shrink-0" />}
                <span className="sr-only">{f.edited ? '수정함' : '읽음'}</span>
                {link ? (
                  <button
                    type="button"
                    className={cn('agent-live-link', FOCUS_RING)}
                    title={link.kind === 'doc' ? `${f.path} 문서 열기` : `${f.path} 작업 보기에서 보기`}
                    data-live-link={link.kind}
                    onClick={() => onOpenLink(link)}
                  >
                    <span className="truncate">{middle(f.path)}</span>
                    {link.kind === 'doc' ? <FileText aria-hidden className="size-3.5 shrink-0" /> : <Code aria-hidden className="size-3.5 shrink-0" />}
                  </button>
                ) : (
                  <span className="agent-live-target" title={f.path}>{middle(f.path)}</span>
                )}
                <span className="agent-live-time">{ago(f.at, now)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="agent-live-muted">건드린 파일이 없어요</p>
      )}
    </section>
  );
}

/** Outside API writers: presence only. */
function OutsideBody({ presence, now, onOpenLink }: { presence: AgentPresence | null; now: number; onOpenLink: (l: FileLink) => void }) {
  const files: LiveFile[] = presence?.file ? [{ path: presence.file, edited: true, at: presence.at ?? now, doc: presence.file.endsWith('.dpx.json') }] : [];
  return (
    <>
      <section>
        <p className="agent-live-muted">외부 에이전트라 자세한 진행상황이 없어요</p>
      </section>
      <Files files={files} now={now} onOpenLink={onOpenLink} />
    </>
  );
}
