// The chat dock's issue parts (#954). IssueCard is pinned at the top of the window while the person talks about an
// issue: number, title, state, the first lines of the body (GET /api/issues/:n/summary) and GitHub에서 열기.
// IssueStartBar sits under the helper's proposal: the team's models and which lead takes it (issueStart.ts), then
// 시작하기 — pressing it is the approval and the only way the work reaches a lead — and 수정 요청, which puts the
// cursor in the message box. Metadata only: the summary lines stay in memory, nothing is stored.
import { useEffect, useId, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Model, Session } from '../../../shared/dispatch/types.ts';
import { api } from '../dispatch/store';
import { Button } from '../components/ui/button';
import { NativeSelect } from '../components/ui/native-select';
import { DEFAULT_IMPL_MODEL, DEFAULT_REVIEW_MODEL, NEW_LEAD, liveLeads, type TeamPick } from '../home/issueStart';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import type { AskedIssue } from './lib/askIssue';

type Summary = { ok: true; summary: string[] } | { ok: false; reason: string } | null;

export function IssueCard({ issue }: { issue: AskedIssue }) {
  const [summary, setSummary] = useState<Summary>(null);
  useEffect(() => {
    const ctl = new AbortController();
    setSummary(null);
    api<Summary>('GET', `/api/issues/${issue.number}/summary`, undefined, ctl.signal).then(setSummary, () => {});
    return () => ctl.abort();
  }, [issue.number]);
  const lines = summary?.ok ? summary.summary : [];
  return (
    <section aria-label={`이슈 #${issue.number}`} data-chat-issue={issue.number} className="grid gap-1 border-b bg-muted/30 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">#{issue.number}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={issue.title}>{issue.title || '제목 없음'}</span>
        <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-foreground/6 px-2 text-2xs text-muted-foreground">{issue.state}</span>
      </div>
      {lines.length > 0 && <p data-chat-issue-summary className="m-0 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{lines.join(' ')}</p>}
      {issue.url && (
        <a href={issue.url} target="_blank" rel="noreferrer" className={cn('inline-flex h-6 w-fit items-center gap-1 rounded-md -ml-1.5 px-1.5 text-xs text-muted-foreground no-underline hover:bg-accent hover:text-foreground', FOCUS_RING)}>
          GitHub에서 열기
          <ExternalLink aria-hidden className="size-3" />
        </a>
      )}
    </section>
  );
}

export type { StartState } from './lib/askIssue.ts';
import type { StartState } from './lib/askIssue.ts';

type BarProps = {
  sessions: readonly Session[];
  state: StartState;
  onStart: (team: TeamPick, leadId: string) => void;
  onRevise: () => void;
};

export function IssueStartBar({ sessions, state, onStart, onRevise }: BarProps) {
  const uid = useId();
  const [models, setModels] = useState<Model[] | null>(null);
  const [impl, setImpl] = useState(DEFAULT_IMPL_MODEL);
  const [review, setReview] = useState(DEFAULT_REVIEW_MODEL);
  const [lead, setLead] = useState(NEW_LEAD);
  const leads = liveLeads(sessions);
  // A lead that ended while picked falls back to a new one.
  const leadId = lead && leads.some((s) => s.id === lead) ? lead : NEW_LEAD;
  useEffect(() => {
    const ctl = new AbortController();
    api<{ models?: Model[]; providers?: Record<string, { connected?: boolean }> }>('GET', '/api/state', undefined, ctl.signal).then(
      (s) => setModels((s.models ?? []).filter((m) => s.providers?.[m.provider]?.connected !== false)),
      () => !ctl.signal.aborted && setModels([]),
    );
    return () => ctl.abort();
  }, []);
  const locked = state.state === 'busy' || state.state === 'done';
  return (
    <div data-issue-start-bar className="grid gap-2 rounded-[10px] border bg-card p-3">
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
        <label htmlFor={`${uid}-impl`} className="text-muted-foreground">구현 모델</label>
        <ModelSelect id={`${uid}-impl`} value={impl} onChange={setImpl} models={models} disabled={locked} />
        <label htmlFor={`${uid}-review`} className="text-muted-foreground">리뷰 모델</label>
        <ModelSelect id={`${uid}-review`} value={review} onChange={setReview} models={models} disabled={locked} />
        <label htmlFor={`${uid}-lead`} className="text-muted-foreground">맡길 관리자</label>
        <NativeSelect id={`${uid}-lead`} value={leadId} onChange={(e) => setLead(e.target.value)} disabled={locked} className="w-full" data-issue-lead>
          <option value={NEW_LEAD}>새 관리자 만들기</option>
          {leads.map((s) => (
            <option key={s.id} value={s.id}>{`${s.name} · ${s.modelLabel}`}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" disabled={locked} aria-describedby={`${uid}-status`} data-issue-start-button onClick={() => onStart({ impl, review }, leadId)}>
          {state.state === 'busy' ? '시작하는 중…' : state.state === 'done' ? '시작했어요' : '시작하기'}
        </Button>
        <Button size="sm" variant="outline" className="flex-1" disabled={locked} data-issue-revise onClick={onRevise}>
          수정 요청
        </Button>
      </div>
      <p id={`${uid}-status`} role="status" className={cn('m-0 -mt-1 text-xs', state.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
        {state.state === 'done' || state.state === 'error' ? state.text : ''}
      </p>
    </div>
  );
}

/** A model picker: the connected models, else (state not read yet or failed) the chosen id alone. */
function ModelSelect({ id, value, onChange, models, disabled }: { id: string; value: string; onChange: (v: string) => void; models: Model[] | null; disabled: boolean }) {
  const list = models ?? [];
  const has = list.some((m) => m.id === value);
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-full">
      {!has && <option value={value}>{value}</option>}
      {list.map((m) => (
        <option key={m.id} value={m.id}>{m.label}</option>
      ))}
    </NativeSelect>
  );
}
