// One session in a side sheet: 대화 / 변경사항 / 정보 tabs, permission and answer cards, message box. The agent live
// panel (#905) reuses Chat, Info, Composer and AnswerCard as its own tabs instead of opening this sheet.
// Transcripts come from the in-memory store (never stored). Errors show inline as a destructive Alert.
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Activity, ChevronRight, GitBranch, MessageCircleQuestion, Power, SendHorizontal, ShieldAlert, Square, Trash2 } from 'lucide-react';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Markdown } from './Markdown';
import { Textarea } from '../components/ui/textarea';
import { cn } from '../lib/utils';
import { DiffView } from './DiffView';
import { ModelTag, StatusBadge } from './parts';
import { fmtK, fmtUsd, pct, permLabel, stateOf } from './lib/format.ts';
import { answerQuestion, answerQuestions, answersMessage, answerValue, questionSetKey, type QuestionAnswer, type QuestionItem } from './lib/question.ts';
import { askUserQuestionItems, isQuestionTool } from '../activity/sessionRequests.ts';
import { QuestionTabsCard } from './QuestionTabsCard';
import { awaitsAnswer, turn } from './lib/turn.ts';
import { api, loadTranscript, useDispatch } from './store';
import type { Entry, Pending, Session } from './types';
import { canRun, READ_ONLY_NOTICE } from './lib/runnable.ts';
import { PROMPT_CLEARED, shownPrompt } from './lib/rolePrompt.ts';
import { holdForSheet, openAgentLive } from '../live/store';

export type Report = (p: Promise<unknown>) => Promise<boolean>;

/** One-line title for a tool call (its description, command, path or pattern) plus the full input. */
function toolSummary(text: string): { title: string; detail: string } {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const pick = ['description', 'command', 'file_path', 'path', 'pattern', 'url', 'query', 'prompt'].map(k => o[k]).find(v => typeof v === 'string') as string | undefined;
    const title = (pick ?? '').split('\n')[0] ?? '';
    const minus = (v: unknown) => String(v).split('\n').map(l => `-${l}`).join('\n');
    const plus = (v: unknown) => String(v).split('\n').map(l => `+${l}`).join('\n');
    if (typeof o.old_string === 'string' || typeof o.new_string === 'string')
      return { title, detail: [`@@ ${o.file_path ?? ''}`, o.old_string ? minus(o.old_string) : '', o.new_string ? plus(o.new_string) : ''].filter(Boolean).join('\n') };
    if (Array.isArray(o.edits))
      return { title, detail: [`@@ ${o.file_path ?? ''}`, ...(o.edits as { old_string?: string; new_string?: string }[]).flatMap(e => [e.old_string ? minus(e.old_string) : '', e.new_string ? plus(e.new_string) : '']).filter(Boolean)].join('\n') };
    if (typeof o.content === 'string' && typeof o.file_path === 'string')
      return { title, detail: `@@ ${o.file_path} (새 파일)\n${plus(o.content)}` };
    const detail = Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
    return { title: title || (detail.split('\n')[0] ?? ''), detail };
  } catch {
    return { title: text.split('\n')[0] ?? '', detail: text.includes('\n') || text.length > 120 ? text : '' };
  }
}

const DIFF_HINT = /^(diff --git |@@ |\+\+\+ |--- a\/)/m;

/** Tool text; diffs read with + lines green and - lines in the destructive colour. */
function ShellText({ text }: { text: string }) {
  const isDiff = DIFF_HINT.test(text);
  return (
    <>
      {text.split('\n').map((l, i) => {
        if (isDiff) {
          if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff --git') || l.startsWith('index '))
            return <div key={i} className="font-semibold text-foreground/70">{l || ' '}</div>;
          if (l.startsWith('@@')) return <div key={i} className="text-muted-foreground">{l}</div>;
          if (l.startsWith('+')) return <div key={i} className="-mx-1 bg-ok/10 px-1 text-ok">{l}</div>;
          if (l.startsWith('-')) return <div key={i} className="-mx-1 bg-destructive/10 px-1 text-destructive">{l}</div>;
        }
        return <div key={i}>{l || ' '}</div>;
      })}
    </>
  );
}

function EntryView({ m, agent }: { m: Entry; agent: string }) {
  switch (m.kind) {
    case 'user':
      return (
        <div className="ml-auto max-w-[85%] rounded-[10px] bg-muted px-3 py-2 text-foreground">
          {m.label && <div className="mb-1 text-xs text-muted-foreground">{m.label}</div>}
          <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="max-w-[92%]">
          <div className="mb-1 truncate text-xs text-muted-foreground">{agent}</div>
          <Markdown text={m.text} />
        </div>
      );
    case 'tool': {
      const { title, detail } = toolSummary(m.text);
      return (
        <details className="group rounded-[10px] border bg-muted/40 text-xs text-muted-foreground open:bg-muted/60">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 [&::-webkit-details-marker]:hidden">
            <span className="shrink-0 font-semibold text-foreground">{m.name}</span>
            <span className="min-w-0 truncate">{title}</span>
            <ChevronRight aria-hidden className="ml-auto size-3.5 shrink-0 transition-transform group-open:rotate-90" />
          </summary>
          {detail && (
            <pre className="max-h-64 overflow-auto border-t px-3 py-2 font-mono text-2xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]"><ShellText text={detail} /></pre>
          )}
        </details>
      );
    }
    case 'tool_result':
      return m.text ? (
        <pre className={cn('-mt-2 max-h-40 overflow-y-auto border-l-2 py-0.5 pl-3 font-mono text-2xs leading-5 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]', m.error ? 'border-destructive' : 'border-border')}><ShellText text={m.text} /></pre>
      ) : null;
    case 'perm':
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldAlert aria-hidden className="size-3.5 text-warn" />
          {m.tool} 권한을 요청했어요
        </div>
      );
    case 'error':
      return <div className="rounded-[10px] border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive">{m.text}</div>;
    default:
      return <div className="border-t pt-2 text-xs text-muted-foreground">{m.text}</div>;
  }
}

type Indexed = { e: Entry; i: number };

/** Splits the transcript into single messages and runs of tool calls (tool + tool_result back to back). */
function groupTools(entries: Entry[]): Indexed[][] {
  const out: Indexed[][] = [];
  let cur: Indexed[] | null = null;
  entries.forEach((e, i) => {
    const isTool = e.kind === 'tool' || e.kind === 'tool_result';
    if (isTool && cur) cur.push({ e, i });
    else { cur = isTool ? [{ e, i }] : null; out.push(cur ?? [{ e, i }]); }
  });
  return out;
}

/** A run of 2+ tool calls folds into one counted line; inputs and outputs show only when opened. */
function ToolRun({ items, agent }: { items: Indexed[]; agent: string }) {
  const calls = items.filter(x => x.e.kind === 'tool');
  if (calls.length < 2) return <>{items.map(x => <EntryView key={x.i} m={x.e} agent={agent} />)}</>;
  const names = new Map<string, number>();
  for (const c of calls) { const n = c.e.name ?? '도구'; names.set(n, (names.get(n) ?? 0) + 1); }
  const failed = items.some(x => x.e.kind === 'tool_result' && x.e.error);
  return (
    <details className="group rounded-[10px] border bg-muted/30 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 font-semibold text-foreground tabular-nums">도구 호출 {calls.length}개</span>
        <span className="min-w-0 truncate">{[...names].map(([n, c]) => (c > 1 ? `${n} ${c}` : n)).join(', ')}</span>
        {failed && <span className="shrink-0 text-destructive">오류 있음</span>}
        <ChevronRight aria-hidden className="ml-auto size-3.5 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="flex flex-col gap-2 border-t p-2">
        {items.map(x => <EntryView key={x.i} m={x.e} agent={agent} />)}
      </div>
    </details>
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
 * A choice fills the message box so the person can check it before sending.
 */
export function AnswerCard({ s, onPick, report }: { s: Session; onPick: (text: string) => void; report: Report }) {
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
  if (!awaitsAnswer(s)) return null;
  // Codex and Gemini: "질문 1/4: …" text; the answers go back as one message.
  const set = answerQuestions(s, entries);
  if (set) {
    const submit = (answers: QuestionAnswer[]) => report(api('POST', `/api/sessions/${sid}/message`, { text: answersMessage(set, answers) }));
    return <QuestionTabsCard key={questionSetKey(s, set)} items={set} onSubmit={submit} />;
  }
  const q = answerQuestion(s, entries);
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
            <Button key={o} size="sm" variant="outline" className="h-auto max-w-full py-1.5 text-left whitespace-normal" onClick={() => onPick(o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {q.options.length > 0 ? '고르면 입력창에 들어가요. 고쳐서 보내도 돼요.' : '아래 입력창에 답을 적어 보내요.'}
      </p>
    </section>
  );
}

const fmtElapsed = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
};

/** "응답하는 중…" with the turn's elapsed time and tokens, while the session runs. */
function ThinkingLine({ s }: { s: Session }) {
  const live = s.status === 'running' || s.status === 'starting';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (!live) return null;
  const t = turn(s);
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">응답하는 중…</span>
      <span className="truncate tabular-nums">
        ({fmtElapsed(now - (t.at ?? now))}{t.tokens ? ` · 토큰 ${fmtK(t.tokens)}` : ''})
      </span>
    </div>
  );
}

/**
 * `thinking: false`: the host shows its own waiting line (the chat dock's 생각 중…, #937).
 * `after`: shown under the last entry (the chat dock's 시작하기 bar under the helper's proposal, #954).
 */
export function Chat({ s, report, thinking = true, after }: { s: Session; report: Report; thinking?: boolean; after?: ReactNode }) {
  const entries = useDispatch(st => st.transcripts[s.id]);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries, s.pending.length, !!after]);
  const agent = s.name;
  const runnable = canRun(s);
  return (
    <div
      ref={box}
      onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      className="flex h-full flex-col gap-4 overflow-y-auto overlay-body-mid text-xs leading-[1.55] [&>*]:shrink-0"
    >
      {!entries && <p className="text-muted-foreground">대화를 불러오는 중이에요…</p>}
      {entries?.length === 0 && (
        <p className="text-muted-foreground">이번 서버 실행 중에 주고받은 대화가 없어요.{runnable && ' 메시지를 보내면 이전 세션을 이어서 실행해요.'}</p>
      )}
      {entries && groupTools(entries).map(g => (g.length === 1 && g[0]!.e.kind !== 'tool'
        ? <EntryView key={g[0]!.i} m={g[0]!.e} agent={agent} />
        : <ToolRun key={g[0]!.i} items={g} agent={agent} />))}
      {s.pending.filter(p => !(isQuestionTool(p.tool) && askUserQuestionItems(p.input))).map(p => <PermissionCard key={p.requestId} s={s} p={p} report={report} />)}
      {thinking && <ThinkingLine s={s} />}
      {after}
    </div>
  );
}

export function Info({ s }: { s: Session }) {
  const roles = useDispatch(st => st.roles);
  const prompt = shownPrompt(s, roles);
  // Same plain sections as the 진행 tab (2026-11-20): no grey boxes, a hairline between sections, a bold heading each.
  const rows: [string, string][] = [
    ['모델', `${s.modelLabel || s.model}${s.effort ? ` · effort ${s.effort}` : ''}`],
    ['역할', `${s.roleName}${s.canSpawn ? ' · 팀원을 만들 수 있어요' : ''}`],
    ['권한 모드', permLabel(s.perm)],
    ['세션 ID', s.id],
    ['CLI 세션', s.providerSessionId ?? '—'],
  ];
  const ratio = s.ctxWindow ? s.ctx / s.ctxWindow : null;
  const usage: [string, number][] = [['입력', s.usage.input], ['출력', s.usage.output], ['캐시 읽기', s.usage.cacheRead], ['캐시 쓰기', s.usage.cacheWrite]];
  const section = 'border-t border-border/70 py-4 first:border-t-0 first:pt-1';
  const heading = 'm-0 mb-2.5 text-xs font-semibold text-foreground';
  return (
    <div className="flex h-full flex-col overflow-y-auto overlay-body font-sans text-xs leading-[1.55]">
      <section aria-label="세션" className={section}>
        <h3 className={heading}>세션</h3>
        <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="m-0 min-w-0 break-all text-foreground tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="컨텍스트" className={section}>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="m-0 text-xs font-semibold text-foreground">컨텍스트</h3>
          <span className="tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{pct(ratio)}</span> · {fmtK(s.ctx)} / {fmtK(s.ctxWindow)}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={cn('h-full rounded-full', (ratio ?? 0) >= 0.85 ? 'bg-bad' : (ratio ?? 0) >= 0.6 ? 'bg-warn' : 'bg-ok')} style={{ width: `${Math.min(100, Math.round((ratio ?? 0) * 100))}%` }} />
        </div>
      </section>

      <section aria-label="토큰과 비용" className={section}>
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <h3 className="m-0 text-xs font-semibold text-foreground">토큰</h3>
          <span className="text-muted-foreground">
            비용 <span className="text-base font-semibold tracking-[-0.01em] text-foreground tabular-nums">{fmtUsd(s.cost)}</span>
          </span>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {usage.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="m-0 text-base font-semibold tracking-[-0.01em] tabular-nums">{fmtK(v)}</dd>
            </div>
          ))}
        </dl>
        {s.cost == null && <p className="m-0 mt-2 text-xs text-muted-foreground">이 CLI는 비용을 알려주지 않아요.</p>}
      </section>

      <details className={cn(section, 'group')}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-semibold marker:hidden">
          역할 프롬프트
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">펼치기</span>
          <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">접기</span>
          {/* Visible while folded too: says why the role default shows instead of the session's own task (#943). */}
          {prompt.fallback && <span data-prompt-cleared className="order-last basis-full text-xs font-normal text-muted-foreground">{PROMPT_CLEARED}</span>}
        </summary>
        {prompt.text && (
          <p className="m-0 mt-2.5 max-h-72 overflow-y-auto whitespace-pre-wrap text-muted-foreground" data-prompt-fallback={prompt.fallback || undefined}>
            {prompt.fallback && <span className="mb-1 block text-xs font-medium text-foreground/80">{s.roleName} 기본 프롬프트</span>}
            {prompt.text}
          </p>
        )}
      </details>
    </div>
  );
}

export function Composer({ s, text, setText, inputRef, report }: { s: Session; text: string; setText: (v: string) => void; inputRef: Ref<HTMLTextAreaElement>; report: Report }) {
  const [busy, setBusy] = useState(false);
  // One send at a time, checked synchronously: a Korean IME can deliver the committing Enter twice before React
  // re-renders `busy`, which sent the same message twice (2026-11-20). The box clears at once; a failed send puts it back.
  const sending = useRef(false);
  const send = async () => {
    const v = text.trim();
    if (!v || sending.current) return;
    sending.current = true;
    setBusy(true);
    setText('');
    const ok = await report(api('POST', `/api/sessions/${encodeURIComponent(s.id)}/message`, { text: v }));
    if (!ok) setText(v);
    sending.current = false;
    setBusy(false);
  };
  if (!canRun(s)) return <p role="note" className="overlay-foot border-t text-xs leading-[1.55] text-muted-foreground">{READ_ONLY_NOTICE}</p>;
  return (
    <div className="overlay-foot flex items-end gap-2 border-t">
      <Textarea
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && !e.repeat) { e.preventDefault(); void send(); } }}
        placeholder={`${s.name}에게 메시지 보내기`}
        aria-label="메시지"
        className="max-h-40 min-h-10 resize-none rounded-[10px] px-3 py-2 text-xs leading-[1.55] md:text-xs"
        rows={1}
      />
      <Button size="icon" onClick={() => void send()} disabled={!text.trim() || busy} aria-label="보내기"><SendHorizontal /></Button>
    </div>
  );
}

export function SessionSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const s = useDispatch(st => st.sessions.find(x => x.id === id));
  const [tab, setTab] = useState('chat');
  // The message box's draft lives here so the "답할 것" card can fill it.
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const report: Report = p => p.then(() => { setError(null); return true; }, (e: Error) => { setError(e.message); return false; });
  const pick = (text: string) => {
    setTab('chat');
    setDraft(text);
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(text.length, text.length); } });
  };
  useEffect(() => {
    if (!id) return;
    setTab('chat');
    setDraft('');
    setError(null);
    void report(loadTranscript(id));
  }, [id]);

  // The agent live panel (a top-layer popover) hides while this modal sheet is open (#728).
  const shown = !!id && !!s;
  useEffect(() => (shown ? holdForSheet() : undefined), [shown]);

  const sid = s ? encodeURIComponent(s.id) : '';
  return (
    <Sheet open={!!id && !!s} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" showCloseButton className="w-full gap-0 bg-background p-0 sm:max-w-2xl">
        {s && (
          <>
            <SheetHeader className="gap-2 border-b">
              <div className="flex items-center gap-2.5 pr-8">
                <SheetTitle className="truncate text-lg">{s.name}</SheetTitle>
                <StatusBadge state={stateOf(s)} />
              </div>
              <SheetDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <ModelTag provider={s.provider} label={`${s.modelLabel}${s.effort ? ` ${s.effort}` : ''}`} />
                {s.branch && <span className="inline-flex items-center gap-1"><GitBranch aria-hidden className="size-3.5" />{s.branch}</span>}
                <span>권한 {permLabel(s.perm)}</span>
              </SheetDescription>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" disabled={s.status !== 'running' && s.status !== 'waiting'}
                  onClick={() => void report(api('POST', `/api/sessions/${sid}/interrupt`))}>
                  <Square />중단
                </Button>
                <Button size="sm" variant="outline" onClick={() => { const at = s.id; onClose(); openAgentLive(at, { from: 'sheet', trigger: null }); }}>
                  <Activity />진행상황 보기
                </Button>
                {s.status === 'done' ? (
                  <Button size="sm" variant="outline" onClick={() => void report(api('POST', `/api/sessions/${sid}/remove`).then(onClose))}>
                    <Trash2 />목록에서 지우기
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => void report(api('POST', `/api/sessions/${sid}/kill`))}>
                    <Power />종료
                  </Button>
                )}
              </div>
            </SheetHeader>
            {error && <Alert variant="destructive">{error}</Alert>}
            <AnswerCard s={s} onPick={pick} report={report} />
            <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
              <TabsList className="mx-(--overlay-x) mt-3">
                <TabsTrigger value="chat">대화</TabsTrigger>
                <TabsTrigger value="diff">변경사항</TabsTrigger>
                <TabsTrigger value="info">정보</TabsTrigger>
              </TabsList>
              <TabsContent value="chat" className="min-h-0"><Chat s={s} report={report} /></TabsContent>
              <TabsContent value="diff" className="min-h-0"><DiffView s={s} /></TabsContent>
              <TabsContent value="info" className="min-h-0"><Info s={s} /></TabsContent>
            </Tabs>
            {tab === 'chat' && <Composer s={s} text={draft} setText={setDraft} inputRef={input} report={report} />}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
