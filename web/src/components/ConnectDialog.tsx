import { useState } from "react";
import { ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/bits";
import { cn } from "@/lib/utils";
import { api, useApp } from "@/store";
import type { Provider, ProviderStatus } from "@/types";

const LOGIN: Record<Provider, string> = { claude: "Claude 계정으로 로그인", openai: "ChatGPT 계정으로 로그인" };
const INSTALL: Record<Provider, string> = { claude: "Claude Code", openai: "Codex CLI" };

function ProviderCard({ id, p }: { id: Provider; p: ProviderStatus }) {
  const models = useApp(s => s.models);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const call = (path: string, body?: unknown, ok?: string) =>
    api("POST", `/api/providers/${id}/${path}`, body).then(() => ok && toast.success(ok)).catch((e: Error) => toast.error(e.message));

  const saveKey = async () => {
    const k = key.trim();
    setKey("");
    if (!k) return;
    await call("key", { key: k }, `${p.name}에 연결했어요`);
    setKeyOpen(false);
  };

  const names = models.filter(m => m.provider === id).map(m => m.label);
  return (
    <section className={cn("flex flex-col gap-4 rounded-xl border p-4", p.connected && "border-ok/40")}>
      <header className="flex items-center gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{p.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{p.cli ?? "설치되지 않음"}</p>
        </div>
        <span className="ml-auto">
          {!p.installed ? <StatusBadge status="error" className="[&>span:last-child]:hidden" />
            : p.busy ? <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />브라우저에서 로그인 중</span>
            : p.connected ? <span className="inline-flex items-center gap-1.5 text-xs font-medium"><span className="size-1.5 rounded-full bg-ok" />연결됨</span>
            : <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-muted-foreground" />연결 안 됨</span>}
        </span>
      </header>

      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">로그인 방식</dt><dd>{p.method ?? "—"}</dd>
        <dt className="text-muted-foreground">모델</dt><dd>{names.join(", ") || "—"}</dd>
        <dt className="text-muted-foreground">자격 증명</dt><dd><span className="font-mono text-[13px]">{p.store}</span> <span className="text-muted-foreground">(CLI가 보관)</span></dd>
      </dl>

      {p.busy && p.url && (
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-[var(--role-impl)] underline-offset-4 hover:underline">
          브라우저가 열리지 않았다면 로그인 페이지 열기<ExternalLink className="size-3.5" />
        </a>
      )}
      {p.error && <p className="text-sm text-bad">{p.error}</p>}

      {keyOpen && (
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); saveKey(); }}>
          <Input type="password" autoComplete="off" autoFocus value={key} onChange={e => setKey(e.target.value)} placeholder="OpenAI API 키" aria-label="API 키" />
          <Button type="submit" disabled={!key.trim()}>연결</Button>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {!p.installed ? (
          <p className="text-sm text-muted-foreground">{INSTALL[id]}를 설치한 뒤 다시 열어 주세요. 터미널에서 <code className="font-mono">setup.sh --status</code>로 확인할 수 있어요.</p>
        ) : p.busy ? (
          <Button size="sm" variant="outline" onClick={() => call("cancel")}>로그인 취소</Button>
        ) : p.connected ? (
          <>
            <Button size="sm" variant="outline" onClick={() => call("login")}>다시 로그인</Button>
            <Button size="sm" variant="ghost" className="text-bad hover:text-bad" onClick={() => call("logout", undefined, "연결을 해제했어요")}>연결 해제</Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => call("login")}>{LOGIN[id]}</Button>
            {p.keySupported && !keyOpen && <Button size="sm" variant="ghost" onClick={() => setKeyOpen(true)}><KeyRound />API 키로 연결</Button>}
          </>
        )}
      </div>
    </section>
  );
}

export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const providers = useApp(s => s.providers);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>에이전트 연결</DialogTitle>
          <DialogDescription>로그인은 각 CLI가 브라우저에서 처리해요. Dispatch는 토큰이나 API 키를 저장하지 않아요.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {(Object.entries(providers) as [Provider, ProviderStatus][]).map(([id, p]) => <ProviderCard key={id} id={id} p={p} />)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
