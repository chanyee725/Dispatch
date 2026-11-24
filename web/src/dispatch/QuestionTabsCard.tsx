// "답할 것" for a set of questions (#1052): one card, tabs 1/2/3/4. A choice settles its question and moves to the next
// unanswered one; once every question has an answer, all answers go out at once (`onSubmit`). Tabs go back to change an
// earlier answer before that. Each question also has "직접 입력", and multiSelect questions take several choices.
import { useState } from 'react';
import { Check, MessageCircleQuestion, PenLine } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { cn } from '../lib/utils';
import { answerValue, type QuestionAnswer, type QuestionItem } from './lib/question.ts';

const EMPTY: QuestionAnswer = { picked: [], other: '' };

/** The next question without an answer after `from` (wrapping), or -1 when all have one. */
function nextOpen(answers: readonly (QuestionAnswer | undefined)[], count: number, from: number): number {
  for (let k = 1; k <= count; k++) {
    const i = (from + k) % count;
    if (!answerValue(answers[i])) return i;
  }
  return -1;
}

export function QuestionTabsCard({ items, onSubmit, onDecline }: {
  items: readonly QuestionItem[];
  /** Sends every answer; resolves false when the send failed (the card stays for another try). */
  onSubmit: (answers: QuestionAnswer[]) => Promise<boolean>;
  /** Claude's prompt can be declined; a text question cannot (the message box is there). */
  onDecline?: () => void;
}) {
  const count = items.length;
  const [tab, setTab] = useState(0);
  const [answers, setAnswers] = useState<QuestionAnswer[]>(() => items.map(() => EMPTY));
  const [typing, setTyping] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // Sent: hidden until the session moves on, so a late state update cannot send the same answers twice.
  const [sent, setSent] = useState(false);

  const done = answers.filter(a => answerValue(a)).length;
  const send = async (all: QuestionAnswer[]) => {
    if (busy) return;
    setBusy(true);
    const ok = await onSubmit(all);
    setBusy(false);
    if (ok) setSent(true);
  };
  /** Stores question `i`'s answer, then moves on: the next open question, or sends when none is left. */
  const settle = (i: number, a: QuestionAnswer, advance: boolean) => {
    const all = answers.map((x, k) => (k === i ? a : x));
    setAnswers(all);
    setTyping(null);
    if (!advance || !answerValue(a)) return;
    const next = nextOpen(all, count, i);
    if (next < 0) void send(all);
    else setTab(next);
  };
  const openTyping = (i: number) => {
    setTyping(i);
    setDraft(answers[i]!.other);
  };

  if (sent) return null;
  return (
    <section aria-label="답할 것" className="mx-(--overlay-x) mt-3 rounded-xl border border-warn/60 bg-warn/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-warn">
        <MessageCircleQuestion aria-hidden className="size-3.5" />
        답할 것
        <span className="ml-auto font-normal text-muted-foreground tabular-nums">{done}/{count} 답함</span>
      </div>
      <Tabs value={String(tab)} onValueChange={v => { setTab(Number(v)); setTyping(null); }} className="mt-2 gap-0">
        {count > 1 && (
          <TabsList aria-label="질문" className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0">
            {items.map((q, i) => {
              const answered = !!answerValue(answers[i]);
              return (
                <TabsTrigger
                  key={i}
                  value={String(i)}
                  title={q.header ?? q.question}
                  className={cn(
                    'relative h-8 flex-none rounded-none border-0 px-3 tabular-nums text-muted-foreground shadow-none',
                    // Selected: an underline drawn with a border, so it survives forced colours (not colour alone).
                    'data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none',
                    'data-[state=active]:after:absolute data-[state=active]:after:inset-x-1 data-[state=active]:after:bottom-[-1px] data-[state=active]:after:border-b-2 data-[state=active]:after:border-warn',
                  )}
                >
                  {i + 1}
                  {q.header && <span className="max-w-24 truncate font-normal">{q.header}</span>}
                  {answered && <Check aria-label="답함" className="size-3.5 text-ok" />}
                </TabsTrigger>
              );
            })}
          </TabsList>
        )}
        {items.map((q, i) => {
          const a = answers[i]!;
          const toggle = (label: string) => {
            if (q.multiSelect) settle(i, { ...a, picked: a.picked.includes(label) ? a.picked.filter(x => x !== label) : [...a.picked, label] }, false);
            else settle(i, { picked: [label], other: '' }, true);
          };
          const confirmTyped = () => {
            const other = draft.trim();
            settle(i, q.multiSelect ? { ...a, other } : { picked: [], other }, !q.multiSelect);
          };
          const last = nextOpen(answers.map((x, k) => (k === i ? { picked: ['x'], other: '' } : x)), count, i) < 0;
          return (
            <TabsContent key={i} value={String(i)} className="pt-2.5">
              <p className="text-sm leading-6">
                {count > 1 && <span className="mr-1.5 text-muted-foreground tabular-nums">질문 {i + 1}/{count}</span>}
                {q.question}
              </p>
              {q.multiSelect && <p className="mt-0.5 text-xs text-muted-foreground">여러 개 골라도 돼요.</p>}
              <div className="mt-2.5 flex flex-col gap-1.5" role="group" aria-label={`질문 ${i + 1}의 선택지`}>
                {q.options.map(o => {
                  const on = a.picked.includes(o.label);
                  return (
                    <button
                      key={o.label}
                      type="button"
                      disabled={busy}
                      {...(q.multiSelect ? { role: 'checkbox', 'aria-checked': on } : { 'aria-pressed': on })}
                      onClick={() => toggle(o.label)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-lg border bg-background px-3 py-2 text-left text-xs leading-5 transition-colors outline-none hover:bg-muted/60',
                        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
                        on && 'border-foreground/60 bg-muted/60',
                      )}
                    >
                      <span aria-hidden className={cn('mt-0.5 grid size-4 shrink-0 place-items-center border', q.multiSelect ? 'rounded-[4px]' : 'rounded-full', on && 'border-foreground bg-foreground text-background')}>
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium">{o.label}</span>
                        {o.recommended && !/추천|recommended/i.test(o.label) && <span className="ml-1.5 text-muted-foreground">(추천)</span>}
                        {o.reason && <span className="block text-muted-foreground">{o.reason}</span>}
                      </span>
                    </button>
                  );
                })}
                {typing === i ? (
                  <form className="flex gap-1.5" onSubmit={e => { e.preventDefault(); confirmTyped(); }}>
                    <Input
                      autoFocus
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setTyping(null); } }}
                      aria-label={`질문 ${i + 1}에 직접 입력`}
                      placeholder="답을 적어 주세요"
                      className="h-8 bg-background text-xs md:text-xs"
                    />
                    <Button type="submit" size="sm" disabled={!draft.trim() || busy}>확인</Button>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={!!a.other}
                    onClick={() => openTyping(i)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-xs leading-5 text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground',
                      'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
                      a.other && 'border-solid border-foreground/60 text-foreground',
                    )}
                  >
                    <PenLine aria-hidden className="size-3.5 shrink-0" />
                    {a.other ? <span className="min-w-0 truncate">직접 입력: {a.other}</span> : '직접 입력'}
                  </button>
                )}
              </div>
              {q.multiSelect && (
                <div className="mt-2.5 flex justify-end">
                  <Button size="sm" disabled={!answerValue(a) || busy} onClick={() => settle(i, a, true)}>{last ? '답 보내기' : '다음'}</Button>
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
      <div className="mt-2.5 flex items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {busy ? '답을 보내는 중이에요…' : count > 1 ? '고르면 다음 질문으로 넘어가요. 마지막 답을 고르면 한 번에 보내요.' : '고르면 바로 보내요.'}
        </p>
        <div className="ml-auto flex gap-1.5">
          {done === count && !busy && <Button size="sm" onClick={() => void send(answers)}>답 보내기</Button>}
          {onDecline && <Button size="sm" variant="ghost" disabled={busy} onClick={onDecline}>답하지 않기</Button>}
        </div>
      </div>
    </section>
  );
}
