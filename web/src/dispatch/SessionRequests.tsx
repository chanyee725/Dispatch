import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { QuestionTabsCard } from './QuestionTabsCard';
import { askUserQuestionItems, isQuestionTool } from '../activity/sessionRequests.ts';
import { answerQuestion, answerQuestions, answersMessage, answerValue, questionSetKey, type QuestionAnswer, type QuestionItem } from './lib/question.ts';
import { canRun } from './lib/runnable.ts';
import { awaitsAnswer } from './lib/turn.ts';
import { api, loadTranscript, useDispatch } from './store';
import type { Pending, Session } from './types';

type Report = (p: Promise<unknown>) => Promise<boolean>;

export function SessionRequests({ s }: { s: Session }) {
  const [error, setError] = useState<string | null>(null);
  const waitingForAnswer = canRun(s) && awaitsAnswer(s);
  const report: Report = (p) => p.then(
    () => { setError(null); return true; },
    (e: Error) => { setError(e.message); return false; },
  );

  // Text question sets can exceed the short question summary in the session snapshot.
  useEffect(() => {
    if (waitingForAnswer) void loadTranscript(s.id).catch(() => {});
  }, [s.id, s.turns, waitingForAnswer]);

  return (
    <>
      {error && <Alert variant="destructive">{error}</Alert>}
      <AnswerCard s={s} report={report} />
      {s.pending.filter(p => !(isQuestionTool(p.tool) && askUserQuestionItems(p.input))).map(p => (
        <PermissionCard key={p.requestId} s={s} p={p} report={report} />
      ))}
    </>
  );
}

function PermissionCard({ s, p, report }: { s: Session; p: Pending; report: Report }) {
  const respond = (behavior: 'allow' | 'deny', always = false) =>
    void report(api('POST', `/api/sessions/${encodeURIComponent(s.id)}/permission`, { requestId: p.requestId, behavior, always }));
  return (
    <section aria-label="권한 요청" className="rounded-xl border border-warn/60 bg-warn/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldAlert aria-hidden className="size-4 text-warn" />
        {p.tool} 실행을 허용할까요?
      </div>
      {p.description && <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>}
      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-background p-2.5 font-mono text-xs whitespace-pre-wrap">{JSON.stringify(p.input, null, 2)}</pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => respond('allow')}>허용</Button>
        {p.suggestions.length > 0 && <Button size="sm" variant="outline" onClick={() => respond('allow', true)}>이 세션에서 항상 허용</Button>}
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => respond('deny')}>거부</Button>
      </div>
    </section>
  );
}

/** Claude's open AskUserQuestion prompt with questions the card can show (#1052), if any. */
function questionPrompt(s: Session): { p: Pending; items: QuestionItem[] } | null {
  for (const p of s.pending) {
    if (!isQuestionTool(p.tool)) continue;
    const items = askUserQuestionItems(p.input);
    if (items) return { p, items };
  }
  return null;
}

/**
 * "답할 것": the question the last turn ended with, from the transcript in this tab, else the server's `ask` (#886).
 * Never hidden while the session waits: without any question it says so instead of showing nothing.
 * The free-form answer stays attached to the current request.
 */
function AnswerCard({ s, report }: { s: Session; report: Report }) {
  const entries = useDispatch(st => st.transcripts[s.id]);
  const sid = encodeURIComponent(s.id);
  // Claude's AskUserQuestion: the answers go back as the permission response (#1052).
  const asked = questionPrompt(s);
  if (asked) {
    const { p, items } = asked;
    const submit = (answers: QuestionAnswer[]) => report(api('POST', `/api/sessions/${sid}/permission`, {
      requestId: p.requestId,
      behavior: 'allow',
      answers: Object.fromEntries(items.map((q, i) => [q.question, answerValue(answers[i])])),
    }));
    const decline = () => void report(api('POST', `/api/sessions/${sid}/permission`, { requestId: p.requestId, behavior: 'deny' }));
    return <QuestionTabsCard key={p.requestId} items={items} onSubmit={submit} onDecline={decline} />;
  }
  if (!canRun(s) || !awaitsAnswer(s)) return null;
  // Codex and Gemini: "질문 1/4: …" text; the answers go back as one message.
  const set = answerQuestions(s, entries);
  if (set) {
    const submit = (answers: QuestionAnswer[]) => report(api('POST', `/api/sessions/${sid}/message`, { text: answersMessage(set, answers) }));
    return <QuestionTabsCard key={questionSetKey(s, set)} items={set} onSubmit={submit} />;
  }
  const q = answerQuestion(s, entries);
  return <SingleAnswer key={s.turns} question={q} submit={text => report(api('POST', `/api/sessions/${sid}/message`, { text }))} />;
}

function SingleAnswer({ question: q, submit }: { question: ReturnType<typeof answerQuestion>; submit: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'ready' | 'sending' | 'sent'>('ready');
  const inputId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  if (status === 'sent') return null;
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending.current) return;
    sending.current = true;
    setStatus('sending');
    const ok = await submit(text);
    sending.current = ok;
    setStatus(ok ? 'sent' : 'ready');
  };
  return (
    <section aria-label="답할 것" className="mx-(--overlay-x) mt-3 rounded-xl border border-warn/60 bg-warn/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-warn">
        <MessageCircleQuestion aria-hidden className="size-3.5" />
        답할 것
      </div>
      <p className="mt-1 line-clamp-3 text-sm leading-6" title={q.summary}>{q.summary}</p>
      {q.options.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {q.options.map(o => (
            <Button key={o} size="sm" variant="outline" className="h-auto max-w-full py-1.5 text-left whitespace-normal" disabled={status === 'sending'} onClick={() => { setDraft(o); input.current?.focus(); }}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <form className="mt-3 grid gap-2" onSubmit={send}>
        <label htmlFor={inputId} className="text-xs font-medium">답변</label>
        <Textarea id={inputId} ref={input} rows={2} value={draft} onChange={e => setDraft(e.target.value)} disabled={status === 'sending'} />
        <Button size="sm" className="justify-self-start" type="submit" disabled={!draft.trim() || status === 'sending'}>답변 보내기</Button>
      </form>
    </section>
  );
}
