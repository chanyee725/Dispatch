// Where a task is on 계획 → 구현 → 리뷰 → 테스트 → 머지 (#1028): five short segments and "리뷰 · 3/5". Shown on the
// dashboard's 진행 중인 이슈 rows (ActiveLine) and on the 세션 보드 작업 보드, from the task stage alone, so it
// shows even when the lead never set an ETA. Quiet on purpose: muted text, the current segment in its stage colour.
import { cn } from '../lib/utils';
import { PROGRESS_STAGES, STAGE_BG, stageProgress } from './lib/board.ts';
import type { TaskStage } from './types';

const PATH = PROGRESS_STAGES.map(s => s.label).join(' → ');

export function StageProgress({ stage, className }: { stage: TaskStage; className?: string }) {
  const p = stageProgress(stage);
  if (!p) return null;
  return (
    <span data-stage-progress={stage} title={PATH} className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums', className)}>
      <span aria-hidden className="flex items-center gap-0.5">
        {PROGRESS_STAGES.map((s, i) => (
          <span key={s.id} className={cn('h-1 w-2 rounded-full', i + 1 < p.step ? 'bg-foreground/30' : i + 1 === p.step ? STAGE_BG[stage] : 'bg-foreground/8')} />
        ))}
      </span>
      <span>{p.text}</span>
    </span>
  );
}
