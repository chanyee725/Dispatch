// Client-side Dispatch types: the shared wire types plus the board and ticket shapes the SSE stream sends.
export type * from '../../../shared/dispatch/types.ts';
import type { MergeCheck, TaskStuck } from '../../../shared/dispatch/attention.ts';
import type { Entry, Snapshot } from '../../../shared/dispatch/types.ts';

export type TaskStage = 'plan' | 'impl' | 'review' | 'test' | 'merge' | 'done' | 'blocked';

/** A lead's task board row (set_task). Stage history is time and stage only. */
export interface BoardTask {
  id: string; lead: string | null; title: string; stage: TaskStage; owner: string | null;
  createdAt: number; stageAt: number; updatedAt: number; etaAt: number | null; note: string;
  stages?: { stage: TaskStage; at: number }[];
  /** etaAt is the server's guess from finished tasks' stage times (#1028), not one the lead set. */
  etaEstimated?: boolean;
  mergeCheck?: MergeCheck | null;
  stuck?: TaskStuck | null;
  /** Why the server's auto close (#930) left this open task as it is. */
  autoCheck?: { reason: string; at: number } | null;
}

/** Work saved when a usage limit was reached; resumed after the reset. */
export interface Ticket {
  id: string; lead: string | null; leadName: string | null; status: 'open' | 'resumed' | 'closed' | 'orphaned';
  reason: string; resetAt: number | null; createdAt: number; updatedAt: number;
  items: { title: string; stage: TaskStage; owner: string | null; note: string }[];
  leadLast: string; team: { name: string; status: string; branch: string | null; last: string }[];
}

export interface DispatchState extends Snapshot {
  tasks: BoardTask[];
  tickets: Ticket[];
  /** The first snapshot arrived. */
  ready: boolean;
  /** The event stream is connected. */
  online: boolean;
  /** Set when the server has no Dispatch module (workspace outside a git project). */
  unavailable: boolean;
  /** Transcripts of opened sessions. Browser memory only, never written anywhere. */
  transcripts: Record<string, Entry[]>;
}
