import { useEffect, useMemo, useState } from "react";
import { ChevronRight, GitCommitHorizontal, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/store";
import type { Diff, Session } from "@/types";

type BranchDiff = Diff & { commits?: { hash: string; subject: string }[]; base?: string | null; merged?: boolean };
type Line = { kind: "add" | "del" | "ctx" | "hunk"; text: string; old?: number; new?: number };
type FileDiff = { path: string; commit?: string; add: number; del: number; lines: Line[]; binary: boolean };

/** Splits a unified patch (git diff or git show) into files with numbered lines. */
function parsePatch(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null, commit: string | undefined, o = 0, n = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("commit ")) { commit = raw.slice(7); continue; }
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
    if (head) { cur = { path: head[2], commit, add: 0, del: 0, lines: [], binary: false }; files.push(cur); continue; }
    if (!cur) continue;
    if (raw.startsWith("Binary files")) { cur.binary = true; continue; }
    if (/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity |rename |old mode|new mode)/.test(raw)) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (h) { o = +h[1]; n = +h[2]; cur.lines.push({ kind: "hunk", text: h[3].trim() }); continue; }
    if (raw.startsWith("+")) { cur.lines.push({ kind: "add", text: raw.slice(1), new: n++ }); cur.add++; }
    else if (raw.startsWith("-")) { cur.lines.push({ kind: "del", text: raw.slice(1), old: o++ }); cur.del++; }
    else if (raw.startsWith(" ") || raw === "") { if (cur.lines.length) cur.lines.push({ kind: "ctx", text: raw.slice(1), old: o++, new: n++ }); }
  }
  return files;
}

function FileBlock({ f, open, onToggle }: { f: FileDiff; open: boolean; onToggle: () => void }) {
  const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
  const name = f.path.slice(dir.length);
  return (
    <section className="overflow-hidden rounded-lg border">
      <button onClick={onToggle} className="flex w-full items-center gap-2 bg-muted/50 px-3 py-2 text-left text-xs hover:bg-muted">
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="min-w-0 truncate font-mono"><span className="text-muted-foreground">{dir}</span><span className="font-semibold">{name}</span></span>
        {f.commit && <span className="shrink-0 truncate font-mono text-muted-foreground max-sm:hidden">{f.commit.split(" ")[0]}</span>}
        <span className="num ml-auto shrink-0 text-ok">+{f.add}</span>
        <span className="num shrink-0 text-bad">−{f.del}</span>
      </button>
      {open && (
        f.binary ? <p className="px-3 py-2 text-xs text-muted-foreground">바이너리 파일</p> : (
          <div className="overflow-x-auto font-mono text-[11px] leading-5">
            {f.lines.map((l, i) => l.kind === "hunk" ? (
              <div key={i} className="border-y bg-muted/40 px-3 py-0.5 text-muted-foreground">{l.text || "⋯"}</div>
            ) : (
              <div key={i} className={cn("grid grid-cols-[2.75rem_2.75rem_1rem_1fr]",
                l.kind === "add" && "bg-ok/10", l.kind === "del" && "bg-bad/10")}>
                <span className="num pr-2 text-right text-muted-foreground/60 select-none">{l.old ?? ""}</span>
                <span className="num pr-2 text-right text-muted-foreground/60 select-none">{l.new ?? ""}</span>
                <span className={cn("select-none", l.kind === "add" ? "text-ok" : l.kind === "del" ? "text-bad" : "text-transparent")}>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                <span className={cn("pr-3 whitespace-pre-wrap [overflow-wrap:anywhere]", l.kind === "add" && "text-ok", l.kind === "del" && "text-bad")}>{l.text || " "}</span>
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}

export function DiffView({ s }: { s: Session }) {
  const [diff, setDiff] = useState<BranchDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const load = () => api<BranchDiff>("GET", `/api/sessions/${s.id}/diff`).then(d => { setDiff(d); setError(null); }, (e: Error) => setError(e.message));
  useEffect(() => { load(); }, [s.id]);
  const files = useMemo(() => (diff ? parsePatch(diff.patch) : []), [diff]);
  // Large changes start folded so the list stays scannable.
  useEffect(() => { setClosed(new Set(files.length > 6 ? files.map((_, i) => i) : [])); }, [files]);
  if (error) return <p className="p-6 text-sm text-bad">{error}</p>;
  if (!diff) return <p className="p-6 text-sm text-muted-foreground">변경사항을 불러오는 중이에요…</p>;
  const toggle = (i: number) => setClosed(c => { const n = new Set(c); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const scope = diff.merged
    ? `${diff.base ?? "기본 브랜치"}에 병합된 이 브랜치의 커밋`
    : diff.base ? `${diff.base}에서 갈라진 뒤 바뀐 것 (커밋 + 커밋 안 한 변경)` : "커밋 안 한 변경";
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-6 py-5 [&>*]:shrink-0">
      <div className="flex items-center gap-3 text-sm">
        <span className="num font-medium">파일 {diff.files}개</span>
        <span className="num text-ok">+{diff.add}</span>
        <span className="num text-bad">−{diff.del}</span>
        <span className="truncate text-xs text-muted-foreground">{scope}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={load}><RefreshCw />새로고침</Button>
      </div>

      {!!diff.commits?.length && (
        <ul className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs">
          {diff.commits.map(c => (
            <li key={c.hash} className="flex min-w-0 items-center gap-2">
              <GitCommitHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 font-mono text-muted-foreground">{c.hash}</span>
              <span className="truncate">{c.subject}</span>
            </li>
          ))}
        </ul>
      )}

      {diff.untracked.length > 0 && (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">새 파일 (아직 git에 없음)</span> <span className="font-mono">{diff.untracked.join(", ")}</span>
        </div>
      )}

      {files.length > 1 && (
        <div className="flex gap-2 text-xs">
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setClosed(new Set())}>모두 펼치기</button>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setClosed(new Set(files.map((_, i) => i)))}>모두 접기</button>
        </div>
      )}

      {files.length ? (
        files.map((f, i) => <FileBlock key={`${f.commit ?? ""}:${f.path}:${i}`} f={f} open={!closed.has(i)} onToggle={() => toggle(i)} />)
      ) : (
        <p className="text-sm text-muted-foreground">바뀐 파일이 없어요.</p>
      )}
    </div>
  );
}
