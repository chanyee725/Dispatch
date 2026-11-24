// The one-line work summary under a session's name (#912): the type quiet, the work in the card's text colour, cut
// with an ellipsis by CSS only (the whole line stays in the DOM, so screen readers and find-in-page get all of it).
import { cn } from '../lib/utils';
import { kindLabel, summaryLine, type TaskSummary } from './taskSummary';

export function TaskSummaryLine({ summary, className }: { summary: TaskSummary; className?: string }) {
  return (
    <span data-task-summary={summary.from} title={summaryLine(summary)} className={cn('block min-w-0 truncate', className)}>
      {summary.kind ? <span className="text-muted-foreground">{kindLabel(summary.kind)} · </span> : null}
      <span className="text-foreground">{summary.text}</span>
    </span>
  );
}
