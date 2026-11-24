// 타임라인 card of the 세션 board (E29, #879; by team, #928): one folding row per team (a lead and the sessions under
// it) for the picked project, the last 30 minutes across (#944). Only busy teams start open; a folded lead row draws the whole
// team's activity merged. States read from the mark's shape, not a legend: work is a solid bar in the one accent colour,
// resting a dotted line, done a thin line, waiting for a person an outlined stretch (warn), stuck a dashed outline, a
// failure a short red tick. The exact state is in the hover title and the row's accessible name. History is state and
// time only (GET /api/timeline). Forced-colors mode drops author backgrounds, so filled marks get a system-colour border.
// Geometry (#936): every row's text sits on one centre line, the name and state columns have fixed widths so every
// track starts at the same x, and marks, ticks and axis labels land on whole pixels measured from the track's width.
// The interval picker (30초 · 1분 · 5분) sets the bucket bars are drawn at and the axis ticks; the stretch shown stays
// 30 minutes (#944). While the page is visible the card polls every 5s; each update blinks a dot once beside
// 최근 업데이트 and slides the marks along 300ms linear. Hidden pages stop polling; reduced motion only changes the text.
// Clicking the title row folds the card down to that row (remembered per viewer), so 세션 above takes the freed height.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import { Card, EmptyState } from '../home/dash';
import { cn } from '../lib/utils';
import { windowSpans, type Entry } from '../../../shared/dispatch/timeline.ts';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import { STATE, stateOf } from './lib/format.ts';
import { rowHistory } from './lib/usage.ts';
import { api, useDispatch } from './store';
import { useScope } from './scope';
import type { Scope } from './lib/folder.ts';
import {
  INTERVALS, REFRESH_MS, WINDOW_MS, agoLabel, axisTicks, bucketSpans, gridTicks, intervalOf, mergeSpans, readFolded, readInterval, spanBox, teamBusy,
  timelineTeams, trackX, writeFolded, writeInterval,
  type IntervalId, type Span, type Team,
} from './lib/timeline.ts';
import type { Session, SessionState } from './types';

type Timeline = { now: number; windowMs: number; sessions: Record<string, Entry[]> };
/** What every track needs to place its marks: the window and the measured track width in whole px (0 before layout). */
type Geo = { now: number; windowMs: number; width: number };
type Spans = { spans: Span[]; fails: number[] };

const known = (st: string): SessionState => (st in STATE ? (st as SessionState) : 'resting');

/**
 * The mark per state. Only `working` uses the accent; warn and bad are kept for waiting and failure. Every mark has an
 * even height inside the 12px track, so flex centring puts all of them on the same whole-pixel centre line; thin lines
 * are a 2px box with a 1px top border for the same reason (#936).
 */
const MARK: Record<SessionState, { className: string; style?: CSSProperties }> = {
  working: { className: 'h-2 rounded-[2px] forced-colors:border forced-colors:border-[CanvasText]', style: { background: 'var(--ok)' } },
  waiting: { className: 'h-2 rounded-[2px] border border-warn' },
  stuck: { className: 'h-2 rounded-[2px] border border-dashed border-muted-foreground' },
  failed: { className: 'h-[2px] border-t border-destructive/70' },
  resting: { className: 'h-[2px] border-t-2 border-dotted border-muted-foreground' },
  done: { className: 'h-[2px] border-t border-muted-foreground/60' },
};
/** The dot next to a row's current state: colour only where it asks for attention. */
const DOT: Record<SessionState, string> = {
  working: 'bg-ok', waiting: 'bg-warn', failed: 'bg-destructive', stuck: 'bg-muted-foreground', resting: 'bg-muted-foreground/60', done: 'bg-muted-foreground/60',
};
const FORCED_FAIL = 'forced-colors:bg-[Highlight]';
/** Each 5s update moves marks along in 300ms linear (#944); reduced motion jumps. */
const SLIDE = 'motion-safe:transition-[left,width] motion-safe:duration-300 motion-safe:ease-linear';

const hhmm = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const mins = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
};
const describe = ({ spans, fails }: Spans) =>
  spans.map(p => `${STATE[known(p.state)].label} ${hhmm(p.from)}–${hhmm(p.to)}`).join(', ') + (fails.length ? `. 실패 ${fails.length}번` : '');

/** Name column (with the fixed state column inside it) and track; the axis uses the same columns and padding. */
const COLS = 'grid-cols-[220px_1fr] gap-3 px-2 @max-[560px]:grid-cols-1';
const ROW = cn('grid w-full items-center rounded-md py-1.5 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @max-[560px]:gap-1.5', COLS);

/** The name column: name and role on the left, the state in a fixed column on the right, all on one centre line. */
const NAME = 'grid min-w-0 grid-cols-[minmax(0,1fr)_76px] items-center gap-2 leading-5';

function StateText({ state }: { state: SessionState }) {
  return (
    <span data-state={state} className="flex min-w-0 items-center gap-1.5 text-xs leading-5 whitespace-nowrap text-muted-foreground">
      <span aria-hidden className={cn('size-1.5 rounded-full forced-colors:bg-[CanvasText]', DOT[state])} />
      {STATE[state].label}
    </span>
  );
}

function Track({ data, geo }: { data: Spans; geo: Geo }) {
  const { now, windowMs, width } = geo;
  return (
    <span aria-hidden className="relative block h-3">
      {width > 0 && data.spans.map(p => {
        const st = known(p.state);
        const box = spanBox(p.from, p.to, now, windowMs, width);
        return (
          <span key={p.from} data-span={st} title={`${STATE[st].label} · ${hhmm(p.from)}–${hhmm(p.to)} (${mins(p.to - p.from)})`}
            className={cn('absolute inset-y-0 flex items-center', SLIDE)} style={{ left: box.left, width: box.width }}>
            <span className={cn('w-full', MARK[st].className)} style={MARK[st].style} />
          </span>
        );
      })}
      {width > 0 && data.fails.map(t => (
        <span key={t} title={`실패 · ${hhmm(t)}`} data-fail className={cn('absolute inset-y-0 w-[2px] rounded-full bg-destructive', FORCED_FAIL, SLIDE)}
          style={{ left: Math.min(width - 2, Math.max(0, trackX(t, now, windowMs, width) - 1)) }} />
      ))}
    </span>
  );
}

function MemberRow({ s, role, data, geo, onOpen, lone, nested }: { s: Session; role: string; data: Spans; geo: Geo; onOpen: () => void; lone?: boolean; nested?: boolean }) {
  const state = stateOf(s);
  return (
    <button type="button" onClick={onOpen} data-row={s.name} aria-label={`${s.name}, ${role}, 지금 ${STATE[state].label}. ${describe(data)}`} className={ROW}>
      {/* Teammates indent inside the name column only, so every track shares one time axis; 6 + 1 + 13px puts their names on the lead's name x. */}
      <span className={cn(NAME, nested && '-my-1.5 ml-[6px] self-stretch border-l py-1.5 pl-[13px]')}>
        <span className="flex min-w-0 items-center gap-2">
          {/* A lead without teammates lines its name up with the leads that have a fold chevron. */}
          {lone && <span aria-hidden className="-mr-0.5 w-3.5 shrink-0" />}
          <span className={cn('truncate text-sm leading-5', lone && 'font-medium')}>{s.name}</span>
          <span className="shrink-0 text-xs leading-5 text-muted-foreground">{role}</span>
        </span>
        <StateText state={state} />
      </span>
      <Track data={data} geo={geo} />
    </button>
  );
}

function TeamRows({ team, open, onToggle, spansOf, roleOf, geo, onOpen }: {
  team: Team<Session>; open: boolean; onToggle: () => void; spansOf: (id: string) => Spans; roleOf: (s: Session) => string;
  geo: Geo; onOpen: (id: string) => void;
}) {
  const { lead, members } = team;
  const all = [lead, ...members];
  const merged = mergeSpans(all.map(s => spansOf(s.id)));
  if (!members.length) return <MemberRow s={lead} role={roleOf(lead)} data={spansOf(lead.id)} geo={geo} onOpen={() => onOpen(lead.id)} lone />;
  // The folded row speaks for the whole team: its state is the strongest any member is in now.
  const states = all.map(stateOf);
  const teamState = (['working', 'waiting', 'stuck', 'failed', 'resting', 'done'] as const).find(st => states.includes(st)) ?? 'resting';
  const panel = `team-${lead.id}`;
  return (
    <div data-team={lead.id}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panel} data-row={lead.name}
        aria-label={`${lead.name} 팀, 팀원 ${members.length}명, 지금 ${STATE[teamState].label}. ${describe(merged)}`} className={ROW}>
        <span className={NAME}>
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-(--ease-out) motion-reduce:transition-none', open && 'rotate-90')} />
            <span className="truncate text-sm leading-5 font-medium">{lead.name}</span>
            <span className="shrink-0 text-xs leading-5 text-muted-foreground tabular-nums">팀원 {members.length}</span>
          </span>
          <StateText state={teamState} />
        </span>
        <Track data={merged} geo={geo} />
      </button>
      <div id={panel} inert={!open} className={cn('grid transition-[grid-template-rows] duration-200 ease-(--ease-out) motion-reduce:transition-none', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          {all.map(s => (
            <MemberRow key={s.id} s={s} role={roleOf(s)} data={spansOf(s.id)} geo={geo} onOpen={() => onOpen(s.id)} nested />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Whole-pixel width of the element given to the returned ref, kept current as the pane resizes (0 until laid out). */
function useWidth() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return setWidth(0);
    const read = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/**
 * The time axis under the tracks: a 1px tick per bucket, a time label every `labelMs` centred on its tick and 지금
 * flush with the track's right end. Its track box is the one the rows measure, so labels and marks share every x.
 */
function Axis({ geo, bucketMs, labelMs, trackRef }: { geo: Geo; bucketMs: number; labelMs: number; trackRef: (el: HTMLDivElement | null) => void }) {
  const { now, windowMs, width } = geo;
  const LABEL = 40; // fixed label box, centred on the tick by an even offset: no half-pixel text
  return (
    <div aria-hidden className={cn('grid', COLS)}>
      <span className="@max-[560px]:hidden" />
      <div ref={trackRef} data-axis className="relative h-5 text-2xs leading-4 text-muted-foreground tabular-nums">
        {width > 0 && gridTicks(now, windowMs, width, bucketMs).map(x => (
          <span key={x} data-tick className="absolute top-0 h-1 w-px bg-border" style={{ left: x }} />
        ))}
        {width > 0 && axisTicks(now, windowMs, width, labelMs).map(({ t, x }) => (
          <span key={t} data-label className="absolute top-1 text-center" style={{ left: x - LABEL / 2, width: LABEL }}>{hhmm(t)}</span>
        ))}
        <span className="absolute top-1 right-0">지금</span>
      </div>
    </div>
  );
}

/**
 * 최근 업데이트 N초 전 under the axis, recounted on every 5s tick. `at` is the last successful load; a new value
 * replays the dot's one blink (keyed remount), only when motion is allowed.
 */
function Updated({ at, now }: { at: number | null; now: number }) {
  if (at === null) return null;
  return (
    <p data-updated className={cn('grid text-2xs leading-4 text-muted-foreground', COLS)}>
      <span className="@max-[560px]:hidden" />
      <span className="flex items-center justify-end gap-1.5 tabular-nums">
        <span key={at} aria-hidden className="size-1.5 rounded-full bg-ok forced-colors:bg-[CanvasText] motion-safe:animate-[timeline-blink_600ms_ease-out_1]" />
        {agoLabel(now - at)}
      </span>
    </p>
  );
}

/**
 * 타임라인 card (#879, #928): the teams of `projectId` (the board's picked project; 전체 = undefined, 미분류 = null)
 * over the last 30 minutes. `focus` (#board=timeline) unfolds the card and scrolls it into view.
 */
export function TimelineCard({ projectId, onOpen, focus }: { projectId: Scope; onOpen: (id: string) => void; focus?: boolean }) {
  const all = useDispatch(s => s.sessions);
  const roles = useDispatch(s => s.roles);
  const { known: knownFolders, pending = false } = useScope();
  const [data, setData] = useState<Timeline | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** When the last load succeeded (null before the first). */
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  /** Teams the person opened or closed; the rest follow whether they are busy. */
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);
  const [axisRef, width] = useWidth();
  const [intervalId, setIntervalId] = useState<IntervalId>(() => readInterval(typeof localStorage === 'undefined' ? undefined : localStorage));
  const interval = intervalOf(intervalId);
  const pickInterval = (id: string) => {
    const next = intervalOf(id).id;
    setIntervalId(next);
    try {
      writeInterval(localStorage, next);
    } catch {
      /* no storage: the pick lasts this visit */
    }
  };

  /** Folded down to the title row; read once from storage, `focus` always opens it. */
  const [folded, setFolded] = useState(() => !focus && readFolded(typeof localStorage === 'undefined' ? undefined : localStorage));
  const fold = (next: boolean) => {
    setFolded(next);
    try {
      writeFolded(localStorage, next);
    } catch {
      /* no storage: the fold lasts this visit */
    }
  };
  const panelId = useId();

  useEffect(() => {
    if (!focus) return;
    setFolded(false);
    ref.current?.scrollIntoView({ block: 'start' });
  }, [focus]);

  // Every 5s while the page is visible (#944): reload the history and move 지금 along. A hidden page stops both and
  // catches up the moment it shows again.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = () => api<Timeline>('GET', '/api/timeline').then(d => {
      if (!alive) return;
      const t = Date.now();
      setData(d);
      setUpdatedAt(t);
      setNow(t);
    }, () => {});
    const step = () => { setNow(Date.now()); load(); };
    const start = () => { if (timer === undefined) { step(); timer = setInterval(step, REFRESH_MS); } };
    const stop = () => { clearInterval(timer); timer = undefined; };
    const onVis = () => (document.hidden ? stop() : start());
    if (document.hidden) load(); else start();
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; stop(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // The server keeps two hours; the card shows the last 30 minutes of it whatever the interval (#944).
  const windowMs = Math.min(WINDOW_MS, data?.windowMs ?? WINDOW_MS);
  const teams = useMemo(() => timelineTeams(all, roles, projectId, knownFolders, pending), [all, roles, projectId, knownFolders, pending]);
  const count = teams.reduce((n, t) => n + 1 + t.members.length, 0);
  const spans = useMemo(() => {
    const m = new Map<string, Spans>();
    for (const s of teams.flatMap(t => [t.lead, ...t.members])) m.set(s.id, bucketSpans(windowSpans(rowHistory(s, data?.sessions[s.id], now), now, windowMs), now, windowMs, interval.bucketMs));
    return m;
  }, [teams, data, now, windowMs, interval.bucketMs]);
  const geo = useMemo<Geo>(() => ({ now, windowMs, width }), [now, windowMs, width]);
  const spansOf = useMemo(() => (id: string) => spans.get(id) ?? { spans: [], fails: [] }, [spans]);
  const roleNames = useMemo(() => new Map(roles.map(r => [r.id, r.name])), [roles]);
  const roleOf = (s: Session) => roleNames.get(s.role) ?? (s.roleName || s.role);

  return (
    // The title button's ::before covers the whole header row, so a click anywhere on it folds; the actions sit above it.
    <div ref={ref} data-folded={folded || undefined} className="scroll-mt-4 [&_header]:relative">
      <Card id="timeline" count={count || undefined} hint={folded ? undefined : interval.hint} flush title={
        <button type="button" aria-expanded={!folded} aria-controls={panelId} onClick={() => fold(!folded)}
          className="inline-flex items-center gap-1 focus-visible:outline-none before:absolute before:inset-0 before:rounded-[inherit] before:transition-colors hover:before:bg-foreground/[0.03] focus-visible:before:ring-2 focus-visible:before:ring-ring focus-visible:before:ring-inset">
          <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-(--ease-out) motion-reduce:transition-none', !folded && 'rotate-90')} />
          타임라인
        </button>
      } actions={folded ? undefined : (
        <div className="relative z-10">
          <ToggleGroup aria-label="간격" variant="segmented" size="sm" value={interval.id} onValueChange={pickInterval}>
            {INTERVALS.map(iv => <ToggleGroupItem key={iv.id} value={iv.id} className="tabular-nums">{iv.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
      )}>
        <div id={panelId} hidden={folded}>
        {folded ? null : !count ? (
          <EmptyState>{projectId === undefined ? '아직 세션이 없어요.' : '이 프로젝트에는 아직 세션이 없어요.'}</EmptyState>
        ) : (
          <div className="@container flex flex-col gap-1 px-2 py-3">
            {teams.map(team => {
              const open = picked[team.lead.id] ?? teamBusy([team.lead, ...team.members].map(stateOf));
              return (
                <TeamRows key={team.lead.id} team={team} open={open} onToggle={() => setPicked(p => ({ ...p, [team.lead.id]: !open }))}
                  spansOf={spansOf} roleOf={roleOf} geo={geo} onOpen={onOpen} />
              );
            })}
            <Axis geo={geo} bucketMs={interval.bucketMs} labelMs={interval.labelMs} trackRef={axisRef} />
            <Updated at={updatedAt} now={now} />
          </div>
        )}
        </div>
      </Card>
    </div>
  );
}
