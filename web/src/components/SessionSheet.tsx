import { useEffect, useRef, useState } from "react";
import { GitBranch, Power, RefreshCw, SendHorizontal, ShieldAlert, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/bits";
import { fmtK, fmtUsd, pct, roleColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api, loadTranscript, useApp } from "@/store";
import type { Diff, Entry, Pending, Session } from "@/types";

const run = (p: Promise<unknown>, ok?: string) => p.then(() => ok && toast.success(ok)).catch((e: Error) => toast.error(e.message));

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
    case "tool":
      return (
        <div className="rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
          <span className="font-semibold" style={{ color: "var(--role-impl)" }}>{m.name}</span> <span className="break-all">{m.text}</span>
        </div>
      );
    case "tool_result":
      return m.text ? (
        <pre className={cn("-mt-2 max-h-40 overflow-auto border-l-2 py-1 pl-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground", m.error ? "border-bad" : "border-border")}>{m.text}</pre>
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
      className="flex h-full flex-col gap-4 overflow-y-auto px-6 py-5"
    >
      {!entries && <p className="text-sm text-muted-foreground">대화를 불러오는 중이에요…</p>}
      {entries?.length === 0 && (
        <p className="text-sm text-muted-foreground">이번 서버 실행 중에 주고받은 대화가 없어요. 메시지를 보내면 이전 세션을 이어서 실행해요.</p>
      )}
      {entries?.map((m, i) => <EntryView key={i} m={m} agent={agent} />)}
      {s.pending.map(p => <PermissionCard key={p.requestId} s={s} p={p} />)}
    </div>
  );
}

function DiffView({ s }: { s: Session }) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Diff>("GET", `/api/sessions/${s.id}/diff`).then(setDiff, (e: Error) => setError(e.message));
  useEffect(() => { load(); }, [s.id]);
  if (error) return <p className="p-6 text-sm text-bad">{error}</p>;
  if (!diff) return <p className="p-6 text-sm text-muted-foreground">변경사항을 불러오는 중이에요…</p>;
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-6 py-5">
      <div className="flex items-center gap-3 text-sm">
        <span className="num">파일 {diff.files}개</span>
        <span className="num text-ok">+{diff.add}</span>
        <span className="num text-bad">−{diff.del}</span>
        <span className="truncate text-muted-foreground">{s.worktree ? s.cwd : "프로젝트 폴더에서 실행 중"}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={load}><RefreshCw />새로고침</Button>
      </div>
      {diff.untracked.length > 0 && (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">새 파일</span> <span className="font-mono">{diff.untracked.join(", ")}</span>
        </div>
      )}
      {diff.patch ? (
        <pre className="overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-5">
          {diff.patch.split("\n").map((l, i) => (
            <div key={i} className={cn(
              l.startsWith("@@") && "text-[var(--role-impl)]",
              l.startsWith("+") && !l.startsWith("+++") && "bg-ok/10 text-ok",
              l.startsWith("-") && !l.startsWith("---") && "bg-bad/10 text-bad",
            )}>{l || " "}</div>
          ))}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">추적 중인 파일에는 변경이 없어요.</p>
      )}
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
                <StatusBadge status={s.status} />
              </div>
              <SheetDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>{s.modelLabel}{s.effort ? ` ${s.effort}` : ""}</span>
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
