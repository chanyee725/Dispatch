// 작업 보드: the lead's tasks by stage (plan … blocked) with owner, ETA and the time in the current stage: a
// dashboard card on the 세션 보드 (#879) that opens the full board in a side sheet.
// Reads the live `tasks` slice of the store; shows metadata only (titles, stages, times), never transcripts.
import { useState } from 'react';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Card, CardList, EmptyState } from '../home/dash';
import { cn } from '../lib/utils';
import { AttentionGroup, useAttention, useNow } from './AttentionStrip';
import { StageProgress } from './StageProgress';
import { DONE_LIMIT, STAGES, STAGE_BG, etaCardText, etaLine, groupByStage, span, stageLabel, stageProgress, stageSpans, taskWarn, visibleTasks } from './lib/board.ts';
import { useScoped } from './scope';
import type { BoardTask, TaskStage } from './types';

/** Bar colour per stage: the mix tells at a glance where a task spent its time. */
/** How many open tasks the card lists before 전체 보기. */
const CARD_ROWS = 5;

const BAR = STAGE_BG;

/** "12분째"; "방금" under a minute. */
const inStage = (ms: number) => (ms < 60_000 ? '방금' : `${span(ms)}째`);

function TaskCard({ t, now }: { t: BoardTask; now: number }) {
  const spans = stageSpans(t, now);
  const total = spans.reduce((a, s) => a + s.ms, 0) || 1;
  const eta = etaLine(t, now);
  const owner = t.owner || '맡은 사람 없음';
  return (
    <li data-task={t.title} data-task-id={t.id} className={cn('card-surface flex min-w-0 flex-col gap-2 px-3 py-2.5', t.stuck && 'shadow-[0_0_0_1px_var(--warn)]')}>
      <p className="line-clamp-2 text-sm leading-5 font-medium" title={t.title}>{t.title}</p>
      {t.stuck && (
        <p className="flex items-start gap-1.5 text-xs">
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warn" />
          <span className="line-clamp-2">{t.stuck.label}</span>
        </p>
      )}
      {t.stage === 'blocked' && t.note && <p data-blocked-reason className="line-clamp-2 text-xs text-destructive" title={t.note}>{t.note}</p>}
      <div className="flex min-w-0 items-center gap-2 text-2xs text-muted-foreground tabular-nums">
        <span className="min-w-0 truncate" title={owner}>{owner}</span>
        <span data-in-stage className="ml-auto shrink-0" title="이 단계에 있은 시간">{stageLabel(t.stage)} {inStage(now - t.stageAt)}</span>
      </div>
      <StageProgress stage={t.stage} className="text-2xs" />
      {eta && <p data-eta data-estimated={eta.estimated || undefined} className={cn('text-2xs tabular-nums', eta.late ? 'text-destructive' : 'text-muted-foreground')}>{etaCardText(eta)}</p>}
      <div role="img" aria-label={`단계별 시간: ${spans.map(s => `${stageLabel(s.stage)} ${span(s.ms)}`).join(', ')}`} className="flex h-1.5 gap-px overflow-clip rounded-full bg-sunken">
        {spans.map((s, i) => <span key={i} data-bar={s.stage} style={{ flexGrow: s.ms / total }} className={cn('min-w-px basis-0', BAR[s.stage])} />)}
      </div>
    </li>
  );
}

function Board({ tasks }: { tasks: BoardTask[] }) {
  const now = useNow(20_000);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const groups = groupByStage(tasks);
  return (
    <div data-board className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-(--overlay-x) pb-(--overlay-end)">
      {STAGES.map(s => {
        const { shown, more } = visibleTasks(s.id, groups[s.id], doneExpanded);
        return (
        <section key={s.id} aria-label={s.label} data-stage={s.id} className="flex w-56 shrink-0 flex-col gap-2 rounded-panel bg-sunken p-2">
          <header className="flex items-center gap-2 px-1 text-sm font-semibold">
            {s.label}
            <Badge variant="secondary" className="rounded-md px-1.5 tabular-nums">{groups[s.id].length}</Badge>
          </header>
          <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain">
            {shown.map(t => <TaskCard key={t.id} t={t} now={now} />)}
          </ul>
          {s.id === 'done' && groups.done.length > DONE_LIMIT && (
            <Button variant="ghost" size="sm" aria-expanded={doneExpanded} onClick={() => setDoneExpanded(v => !v)}>
              {doneExpanded ? '접기' : `${more}개 더 보기`}
            </Button>
          )}
          {groups[s.id].length === 0 && tasks.length > 0 && <p className="px-1 py-3 text-xs text-muted-foreground">비어 있어요</p>}
        </section>
        );
      })}
    </div>
  );
}

/** The full board in a wide side sheet; `tasks` are the scoped ones. */
function BoardSheet({ open, onOpenChange, tasks }: { open: boolean; onOpenChange: (v: boolean) => void; tasks: BoardTask[] }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton className="w-[min(1280px,100vw)] bg-background sm:max-w-none">
        <SheetHeader>
          <SheetTitle>작업 보드</SheetTitle>
          <SheetDescription>관리자가 적어 둔 작업을 단계별로 보여줘요.</SheetDescription>
        </SheetHeader>
        {tasks.length === 0 && <p className="px-(--overlay-x) pb-2 text-sm text-muted-foreground">아직 작업이 없어요. 관리자가 작업을 적으면 여기에 나타나요.</p>}
        <Board tasks={tasks} />
      </SheetContent>
    </Sheet>
  );
}

/**
 * 작업 보드 as a dashboard card (#879, #919): the stages that hold tasks as one line of chips, then the open tasks
 * that need a look first (stuck, then blocked, then the longest in their stage). A row is the title, a stage dot and
 * the time in the stage; a warning shows only while a task is blocked or late. Finished tasks fold behind one line.
 * 전체 보기 opens the full board in the sheet. `fill`: the card takes the rest of its column and scrolls inside.
 */
export function TaskBoardCard({ fill = false, onOpen, onUsage }: { fill?: boolean; onOpen?: (id: string) => void; onUsage?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const { tasks } = useScoped();
  const attn = useAttention();
  const now = useNow(20_000);
  const groups = groupByStage(tasks);
  // A task with a 확인 필요 row is shown there only.
  const live = tasks.filter(t => t.stage !== 'done' && !attn.taskIds.has(t.id));
  const rank = (t: BoardTask) => (t.stage === 'blocked' ? 0 : 1);
  const shown = [...live].sort((a, b) => rank(a) - rank(b) || a.stageAt - b.stageAt).slice(0, fill ? undefined : CARD_ROWS);
  const chips = STAGES.filter(s => s.id !== 'done' && groups[s.id].length > 0);
  return (
    <Card
      id="tasks"
      grow={fill ? 1 : undefined}
      scroll={fill}
      title="작업 보드"
      count={tasks.filter(t => t.stage !== 'done').length}
      flush
      actions={
        <Button variant="ghost" size="sm" disabled={!tasks.length} onClick={() => setOpen(true)}>
          전체 보기
        </Button>
      }
    >
      {onOpen && <AttentionGroup items={attn.items} now={attn.now} onOpen={onOpen} onUsage={onUsage} />}
      {tasks.length === 0 ? (
        <EmptyState>아직 작업이 없어요. 관리자가 작업을 적으면 여기에 나타나요.</EmptyState>
      ) : (
        <>
          {chips.length > 0 && (
            <ul aria-label="단계별 작업 수" className="m-0 flex list-none flex-nowrap gap-1.5 overflow-x-auto border-b px-4 py-2">
              {chips.map(s => (
                <li key={s.id} data-stage-count={s.id} className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-foreground/6 px-2 text-xs tabular-nums', s.id === 'blocked' ? 'text-destructive' : 'text-muted-foreground')}>
                  <span aria-hidden className={cn('size-1.5 rounded-full', BAR[s.id])} />
                  {s.label}
                  <span className={cn('font-medium', s.id === 'blocked' ? 'text-destructive' : 'text-foreground')}>{groups[s.id].length}</span>
                </li>
              ))}
            </ul>
          )}
          {shown.length === 0 ? (
            <EmptyState>진행 중인 작업이 없어요.</EmptyState>
          ) : (
            <CardList label="진행 중인 작업">
              {shown.map(t => <TaskRow key={t.id} t={t} now={now} />)}
            </CardList>
          )}
          {groups.done.length > 0 && (
            <div className="border-t">
              <button
                type="button"
                aria-expanded={showDone}
                onClick={() => setShowDone(v => !v)}
                className="flex h-9 w-full items-center gap-1.5 px-4 text-left text-xs text-muted-foreground tabular-nums hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
              >
                <ChevronRight aria-hidden className={cn('size-3.5 transition-transform', showDone && 'rotate-90')} />
                완료 {groups.done.length}개
              </button>
              {showDone && (
                <CardList label="완료한 작업">
                  {groups.done.slice(0, DONE_LIMIT).map(t => <TaskRow key={t.id} t={t} now={now} />)}
                </CardList>
              )}
            </div>
          )}
        </>
      )}
      <BoardSheet open={open} onOpenChange={setOpen} tasks={tasks} />
    </Card>
  );
}

/** One row of the card: stage dot, title, time in the stage; a small warning line only when blocked or late. */
function TaskRow({ t, now }: { t: BoardTask; now: number }) {
  const warn = taskWarn(t, now);
  return (
    <li data-row={t.id} className="flex min-w-0 flex-col gap-0.5 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Open stages show their colour in the progress segments; done and blocked keep the dot. */}
        {!stageProgress(t.stage) && <span role="img" aria-label={stageLabel(t.stage)} title={stageLabel(t.stage)} className={cn('size-2 shrink-0 rounded-full', BAR[t.stage])} />}
        <span className="min-w-0 flex-1 truncate text-sm" title={t.title}>{t.title}</span>
        <StageProgress stage={t.stage} />
        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums" title="이 단계에 있은 시간">{inStage(now - t.stageAt)}</span>
      </div>
      {warn && (
        <p data-warn className={cn('m-0 flex min-w-0 items-center gap-1 text-xs', warn.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>
          <TriangleAlert aria-hidden className={cn('size-3 shrink-0', warn.tone === 'warn' && 'text-warn')} />
          <span className="truncate" title={warn.text}>{warn.text}</span>
        </p>
      )}
    </li>
  );
}
