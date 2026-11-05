import { useEffect, useRef, useState } from "react";
import { ChevronRight, GitBranch, Power, SendHorizontal, ShieldAlert, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ModelTag, StatusBadge, ThinkingLine } from "@/components/bits";
import { DiffView } from "@/components/DiffView";
import { turn } from "@/lib/turn";
import { fmtK, fmtUsd, pct, roleColor, stateOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api, loadTranscript, useApp } from "@/store";
import type { Entry, Pending, Session } from "@/types";

const run = (p: Promise<unknown>, ok?: string) => p.then(() => ok && toast.success(ok)).catch((e: Error) => toast.error(e.message));

/** One-line title for a tool call (its description, command, path or pattern) plus the full input. */
function toolSummary(text: string): { title: string; detail: string } {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const pick = ["description", "command", "file_path", "path", "pattern", "url", "query", "prompt"].map(k => o[k]).find(v => typeof v === "string") as string | undefined;
    const title = (pick ?? "").split("\n")[0];
    // Edits read as a diff: removed lines "-", added lines "+".
    const minus = (v: unknown) => String(v).split("\n").map(l => `-${l}`).join("\n");
    const plus = (v: unknown) => String(v).split("\n").map(l => `+${l}`).join("\n");
    if (typeof o.old_string === "string" || typeof o.new_string === "string")
      return { title, detail: [`@@ ${o.file_path ?? ""}`, o.old_string ? minus(o.old_string) : "", o.new_string ? plus(o.new_string) : ""].filter(Boolean).join("\n") };
    if (Array.isArray(o.edits))
      return { title, detail: [`@@ ${o.file_path ?? ""}`, ...(o.edits as { old_string?: string; new_string?: string }[]).flatMap(e => [e.old_string ? minus(e.old_string) : "", e.new_string ? plus(e.new_string) : ""]).filter(Boolean)].join("\n") };
    if (typeof o.content === "string" && typeof o.file_path === "string")
      return { title, detail: `@@ ${o.file_path} (새 파일)\n${plus(o.content)}` };
    const detail = Object.entries(o).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
    return { title: title || detail.split("\n")[0], detail };
  } catch {
    return { title: text.split("\n")[0], detail: text.includes("\n") || text.length > 120 ? text : "" };
  }
}

const DIFF_HINT = /^(diff --git |@@ |\+\+\+ |--- a\/)/m;
const STAT_LINE = /^(.*\|\s+\d+\s)(\+*)(-*)\s*$/;
const SUMMARY = /(\d+ files? changed)|(\d+ insertions?\(\+\))|(\d+ deletions?\(-\))/g;

/** Shell/tool text with diff colouring: + lines green, - lines red, @@ hunks tinted; git --stat bars too. */
function ShellText({ text, diff }: { text: string; diff?: boolean }) {
  const isDiff = diff || DIFF_HINT.test(text);
  return (
    <>
      {text.split("\n").map((l, i) => {
        if (isDiff) {
          if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff --git") || l.startsWith("index "))
            return <div key={i} className="font-semibold text-foreground/70">{l || " "}</div>;
          if (l.startsWith("@@")) return <div key={i} className="text-[var(--role-impl)]">{l}</div>;
          if (l.startsWith("+")) return <div key={i} className="-mx-1 bg-ok/10 px-1 text-ok">{l}</div>;
          if (l.startsWith("-")) return <div key={i} className="-mx-1 bg-bad/10 px-1 text-bad">{l}</div>;
        }
        const st = STAT_LINE.exec(l);
        if (st) return <div key={i}>{st[1]}<span className="text-ok">{st[2]}</span><span className="text-bad">{st[3]}</span></div>;
        if (/files? changed/.test(l))
          return (
            <div key={i}>
              {l.split(SUMMARY).filter(x => x !== undefined && x !== "").map((part, j) =>
                /insertion/.test(part) ? <span key={j} className="text-ok">{part}</span>
                  : /deletion/.test(part) ? <span key={j} className="text-bad">{part}</span>
                  : <span key={j}>{part}</span>)}
            </div>
          );
        return <div key={i}>{l || " "}</div>;
      })}
    </>
  );
}

function EntryView({ m, agent }: { m: Entry; agent: string }) {
  switch (m.kind) {
    case "user":
      return (
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {m.label && <div className="mb-1 text-xs text-primary-foreground/60">{m.label}</div>}
          <div className="whitespace-pre-wrap">{m.text}</div>
        </div>
      );
    case "assistant":
      return (
        <div className="max-w-[92%] text-sm leading-6">
          <div className="mb-1 text-xs text-muted-foreground">{agent}</div>
          <div className="whitespace-pre-wrap">{m.text}</div>
        </div>
      );
    case "tool": {
      const { title, detail } = toolSummary(m.text);
      return (
        <details className="group rounded-lg border bg-muted/40 text-xs text-muted-foreground [&[open]]:bg-muted/60">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 [&::-webkit-details-marker]:hidden">
            <span className="shrink-0 font-semibold" style={{ color: "var(--role-impl)" }}>{m.name}</span>
            <span className="min-w-0 truncate">{title}</span>
            <ChevronRight className="ml-auto size-3.5 shrink-0 transition-transform group-open:rotate-90" />
          </summary>
          {detail && (
            <pre className="max-h-64 overflow-auto border-t px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]"><ShellText text={detail} /></pre>
          )}
        </details>
      );
    }
    case "tool_result":
      return m.text ? (
        <pre className={cn("-mt-2 max-h-40 overflow-y-auto border-l-2 py-0.5 pl-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]", m.error ? "border-bad" : "border-border")}><ShellText text={m.text} /></pre>
      ) : null;
    case "perm":
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="size-3.5 text-warn" />
          {m.tool} 권한을 요청했어요
        </div>
      );
    case "error":
      return <div className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-bad">{m.text}</div>;
    default:
      return <div className="text-xs text-muted-foreground">{m.text}</div>;
  }
}

function PermissionCard({ s, p }: { s: Session; p: Pending }) {
  const respond = (behavior: "allow" | "deny", always = false) =>
    run(api("POST", `/api/sessions/${s.id}/permission`, { requestId: p.requestId, behavior, always }));
  return (
    <div className="rounded-xl border border-warn/60 bg-warn/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldAlert className="size-4 text-warn" />
        {p.tool} 실행을 허용할까요?
      </div>
      {p.description && <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>}
      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-background p-2.5 font-mono text-xs whitespace-pre-wrap">{JSON.stringify(p.input, null, 2)}</pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => respond("allow")}>허용</Button>
        {p.suggestions.length > 0 && <Button size="sm" variant="outline" onClick={() => respond("allow", true)}>이 세션에서 항상 허용</Button>}
        <Button size="sm" variant="ghost" className="text-bad hover:text-bad" onClick={() => respond("deny")}>거부</Button>
      </div>
    </div>
  );
}

function Chat({ s }: { s: Session }) {
  const entries = useApp(st => st.transcripts[s.id]);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries, s.pending.length]);
  const agent = s.provider === "openai" ? "Codex" : "Claude";
  return (
    <div
      ref={box}
      onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      className="flex h-full flex-col gap-4 overflow-y-auto px-6 py-5 [&>*]:shrink-0"
    >
      {!entries && <p className="text-sm text-muted-foreground">대화를 불러오는 중이에요…</p>}
      {entries?.length === 0 && (
        <p className="text-sm text-muted-foreground">이번 서버 실행 중에 주고받은 대화가 없어요. 메시지를 보내면 이전 세션을 이어서 실행해요.</p>
      )}
      {entries?.map((m, i) => <EntryView key={i} m={m} agent={agent} />)}
      {s.pending.map(p => <PermissionCard key={p.requestId} s={s} p={p} />)}
      <ThinkingLine status={s.status} turnStartedAt={turn(s).at} tokens={turn(s).tokens} />
    </div>
  );
}

function Info({ s }: { s: Session }) {
  const rows: [string, string][] = [
    ["세션 ID", s.id],
    ["CLI 세션", s.providerSessionId ?? "—"],
    ["모델", `${s.model}${s.effort ? ` (effort ${s.effort})` : ""}`],
    ["역할", `${s.roleName}${s.canSpawn ? " · 다른 세션을 만들 수 있음" : ""}`],
    ["권한 모드", s.provider === "openai" ? `${s.perm} → ${s.perm === "acceptEdits" || s.perm === "auto" ? "workspace-write" : "read-only"} 샌드박스` : s.perm],
    ["작업 폴더", s.cwd],
    ["컨텍스트", `${fmtK(s.ctx)} / ${fmtK(s.ctxWindow)} (${pct(s.ctx / s.ctxWindow)})`],
  ];
  const usage: [string, number][] = [["입력", s.usage.input], ["캐시 읽기", s.usage.cacheRead], ["캐시 쓰기", s.usage.cacheWrite], ["출력", s.usage.output]];
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-6 py-5 text-sm">
      <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-mono text-[13px] break-all">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="mb-2 font-medium">토큰</h3>
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5">
          {usage.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="num">{fmtK(v)}</dd>
            </div>
          ))}
          <dt className="text-muted-foreground">비용</dt>
          <dd className="num font-semibold">{fmtUsd(s.cost)}{s.cost == null && <span className="ml-2 font-normal text-muted-foreground">Codex는 비용을 알려주지 않아요</span>}</dd>
        </dl>
      </div>
      <div>
        <h3 className="mb-2 font-medium">역할 프롬프트</h3>
        <p className="rounded-lg border bg-muted/30 p-3 whitespace-pre-wrap text-muted-foreground">{s.prompt || "—"}</p>
      </div>
    </div>
  );
}

function Composer({ s }: { s: Session }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      await api("POST", `/api/sessions/${s.id}/message`, { text: v });
      setText("");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-end gap-2 border-t p-4">
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        placeholder={`${s.name}에게 메시지 보내기`}
        aria-label="메시지"
        className="max-h-40 min-h-11 resize-none"
        rows={1}
      />
      <Button size="icon" onClick={send} disabled={!text.trim() || busy} aria-label="보내기"><SendHorizontal /></Button>
    </div>
  );
}

export function SessionSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const s = useApp(st => st.sessions.find(x => x.id === id));
  const [tab, setTab] = useState("chat");
  useEffect(() => {
    if (!id) return;
    setTab("chat");
    loadTranscript(id).catch((e: Error) => toast.error(e.message));
  }, [id]);

  return (
    <Sheet open={!!id && !!s} onOpenChange={o => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        {s && (
          <>
            <SheetHeader className="gap-2 border-b px-6 pt-5 pb-4">
              <div className="flex items-center gap-2.5 pr-8">
                <span className="h-5 w-1 rounded-full" style={{ background: roleColor(s.role) }} />
                <SheetTitle className="truncate text-lg">{s.name}</SheetTitle>
                <StatusBadge state={stateOf(s)} />
              </div>
              <SheetDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <ModelTag provider={s.provider} label={`${s.modelLabel}${s.effort ? ` ${s.effort}` : ""}`} />
                {s.branch && <span className="inline-flex items-center gap-1"><GitBranch className="size-3.5" />{s.branch}</span>}
                <span>권한 {s.perm}</span>
              </SheetDescription>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" disabled={s.status !== "running" && s.status !== "waiting"}
                  onClick={() => run(api("POST", `/api/sessions/${s.id}/interrupt`), "중단을 요청했어요")}>
                  <Square />중단
                </Button>
                {s.status === "done" ? (
                  <Button size="sm" variant="outline" onClick={() => run(api("POST", `/api/sessions/${s.id}/remove`).then(onClose), "목록에서 지웠어요")}>
                    <Trash2 />목록에서 지우기
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="text-bad hover:text-bad" onClick={() => run(api("POST", `/api/sessions/${s.id}/kill`), "세션을 종료했어요")}>
                    <Power />종료
                  </Button>
                )}
              </div>
            </SheetHeader>
            <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
              <TabsList className="mx-6 mt-3">
                <TabsTrigger value="chat">대화</TabsTrigger>
                <TabsTrigger value="diff">변경사항</TabsTrigger>
                <TabsTrigger value="info">정보</TabsTrigger>
              </TabsList>
              <TabsContent value="chat" className="min-h-0"><Chat s={s} /></TabsContent>
              <TabsContent value="diff" className="min-h-0"><DiffView s={s} /></TabsContent>
              <TabsContent value="info" className="min-h-0"><Info s={s} /></TabsContent>
            </Tabs>
            {tab === "chat" && <Composer s={s} />}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
