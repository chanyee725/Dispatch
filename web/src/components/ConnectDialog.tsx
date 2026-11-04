import { useState } from "react";
import { ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api, useApp } from "@/store";
import type { Provider, ProviderStatus } from "@/types";

const LOGIN: Record<Provider, string> = { gemini: "Google Antigravity로 연결", claude: "Claude 계정으로 로그인", openai: "ChatGPT 계정으로 로그인" };
const INSTALL: Record<Provider, string> = { gemini: "Antigravity CLI (agy)", claude: "Claude Code", openai: "Codex CLI" };

const ORDER: Provider[] = ["claude", "openai", "gemini"];
const MARK: Record<Provider, { label: string; className: string }> = {
  claude: { label: "C", className: "bg-[#d97757] text-white" },
  openai: { label: "G", className: "bg-neutral-950 text-white ring-1 ring-foreground/20" },
  gemini: { label: "G", className: "bg-[#1a73e8] text-white" },
};

function StateLabel({ p }: { p: ProviderStatus }) {
  const [dot, text, cls] = !p.installed ? ["bg-bad", "설치 안 됨", "text-bad"]
    : p.busy ? ["bg-warn", "로그인 중", "text-muted-foreground"]
    : p.connected ? ["bg-ok", "연결됨", "text-foreground"]
    : ["bg-muted-foreground/50", "연결 안 됨", "text-muted-foreground"];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs", cls)}>
      {p.busy ? <Loader2 className="size-3 animate-spin" /> : <span className={cn("size-1.5 rounded-full", dot)} />}
      {text}
    </span>
  );
}

function ProviderRow({ id, p }: { id: Provider; p: ProviderStatus }) {
  const models = useApp(s => s.models);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const call = <T,>(path: string, body?: unknown) =>
    api<T>("POST", `/api/providers/${id}/${path}`, body).catch((e: Error) => { toast.error(e.message); return null; });

  const connect = async () => {
    const res = await call<{ connected: boolean }>("login");
    if (res?.connected) toast.success(`${p.name}를 연결했어요`);
  };
  const saveKey = async () => {
    const k = key.trim();
    setKey("");
    if (!k) return;
    if (await call("key", { key: k })) { toast.success(`${p.name}를 연결했어요`); setKeyOpen(false); }
  };
  const disconnect = async () => { if (await call("logout")) toast.success(`${p.name} 연결을 해제했어요`); };

  const names = models.filter(m => m.provider === id).map(m => m.label);
  const meta = !p.installed ? `${INSTALL[id]} 필요` : [p.cli, p.cliLoggedIn ? p.method ?? "로그인됨" : "CLI 로그인 안 됨"].filter(Boolean).join(" · ");
  const mark = MARK[id];

  const action = !p.installed ? null
    : p.busy ? <Button size="sm" variant="ghost" onClick={() => call("cancel")}>취소</Button>
    : p.connected ? <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={disconnect}>해제</Button>
    : <Button size="sm" onClick={connect} title={p.cliLoggedIn ? "이미 로그인된 CLI 계정을 그대로 써요" : LOGIN[id]}>연결</Button>;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold", mark.className)} aria-hidden>{mark.label}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{p.name}</span>
            <StateLabel p={p} />
          </div>
          <p className="truncate text-xs text-muted-foreground" title={meta}>{meta}</p>
        </div>
        {action}
      </div>
      {names.length > 0 && (
        <p className="truncate pl-11 text-xs text-muted-foreground" title={names.join(", ")}>{names.join(" · ")}</p>
      )}
      {p.busy && p.url && (
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="ml-11 inline-flex items-center gap-1 text-xs text-[var(--role-impl)] underline-offset-4 hover:underline">
          브라우저가 안 열렸다면 로그인 페이지 열기<ExternalLink className="size-3" />
        </a>
      )}
      {p.error && <p className="pl-11 text-xs text-bad">{p.error}</p>}
      {!p.installed && <p className="pl-11 text-xs text-muted-foreground">{INSTALL[id]}를 설치한 뒤 다시 열어 주세요.</p>}
      {p.installed && !p.connected && !p.busy && !p.cliLoggedIn && p.keySupported && (
        keyOpen ? (
          <form className="flex gap-2 pl-11" onSubmit={e => { e.preventDefault(); saveKey(); }}>
            <Input type="password" autoComplete="off" autoFocus value={key} onChange={e => setKey(e.target.value)} placeholder="OpenAI API 키" aria-label="API 키" className="h-8" />
            <Button type="submit" size="sm" disabled={!key.trim()}>연결</Button>
          </form>
        ) : (
          <button className="ml-11 inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setKeyOpen(true)}>
            <KeyRound className="size-3" />API 키로 연결
          </button>
        )
      )}
    </li>
  );
}

export function ProviderList() {
  const providers = useApp(s => s.providers);
  const list = ORDER.filter(id => providers[id]).map(id => [id, providers[id]] as const);
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {list.map(([id, p]) => <ProviderRow key={id} id={id} p={p} />)}
    </ul>
  );
}

export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>에이전트 연결</DialogTitle>
          <DialogDescription>로그인은 각 CLI가 처리해요. 해제해도 CLI 로그인은 남아요.</DialogDescription>
        </DialogHeader>
        <ProviderList />
      </DialogContent>
    </Dialog>
  );
}

// Shown in place of the board until at least one provider is connected.
export function LoginGate() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16 max-md:px-4 max-md:py-10">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">먼저 에이전트를 연결하세요</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          세션을 만들려면 Claude, Codex, Gemini 중 하나 이상을 연결해야 해요. 로그인은 각 CLI가 브라우저에서 처리하고, Dispatch는 토큰이나 API 키를 저장하지 않아요.
        </p>
      </div>
      <ProviderList />
    </div>
  );
}
