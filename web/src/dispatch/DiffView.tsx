// 변경사항 tab: the session branch's diff against the base (commits plus uncommitted changes), file by file.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, GitCommitHorizontal, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { api } from './store';
import type { Diff, Session } from './types';
import { parsePatch, type FileDiff } from './lib/patch';

type BranchDiff = Diff & { commits?: { hash: string; subject: string }[]; base?: string | null; merged?: boolean };
function FileBlock({ f, open, onToggle }: { f: FileDiff; open: boolean; onToggle: () => void }) {
  const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
  return (
    <section className="overflow-hidden rounded-lg border">
      <Button variant="ghost" onClick={onToggle} aria-expanded={open}
        className="h-auto w-full justify-start gap-2 rounded-none bg-muted/50 px-3 py-2 text-xs font-normal">
        <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 truncate font-mono"><span className="text-muted-foreground">{dir}</span><span className="font-semibold">{f.path.slice(dir.length)}</span></span>
        {f.commit && <span className="shrink-0 truncate font-mono text-muted-foreground max-sm:hidden">{f.commit.split(' ')[0]}</span>}
        <span className="ml-auto shrink-0 text-ok tabular-nums">+{f.add}</span>
        <span className="shrink-0 text-destructive tabular-nums">−{f.del}</span>
      </Button>
      {open && (f.binary ? <p className="px-3 py-2 text-xs text-muted-foreground">바이너리 파일</p> : (
        <div className="overflow-x-auto font-mono text-2xs leading-5">
          {f.lines.map((l, i) => l.kind === 'hunk' ? (
            <div key={i} className="border-y bg-muted/40 px-3 py-0.5 text-muted-foreground">{l.text || '⋯'}</div>
          ) : (
            <div key={i} className={cn('grid grid-cols-[2.75rem_2.75rem_1rem_1fr]', l.kind === 'add' && 'bg-ok/10', l.kind === 'del' && 'bg-destructive/10')}>
              <span className="pr-2 text-right text-muted-foreground/60 tabular-nums select-none">{l.old ?? ''}</span>
              <span className="pr-2 text-right text-muted-foreground/60 tabular-nums select-none">{l.new ?? ''}</span>
              <span aria-hidden className={cn('select-none', l.kind === 'add' ? 'text-ok' : l.kind === 'del' ? 'text-destructive' : 'text-transparent')}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
              <span className="pr-3 whitespace-pre-wrap [overflow-wrap:anywhere]">{l.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

export function DiffView({ s }: { s: Session }) {
  const [diff, setDiff] = useState<BranchDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const load = useCallback(() => api<BranchDiff>('GET', `/api/sessions/${encodeURIComponent(s.id)}/diff`)
    .then(d => { setDiff(d); setError(null); }, (e: Error) => setError(e.message)), [s.id]);
  useEffect(() => { void load(); }, [load]);
  const files = useMemo(() => (diff ? parsePatch(diff.patch) : []), [diff]);
  // Large changes start folded so the list stays scannable.
  useEffect(() => { setClosed(new Set(files.length > 6 ? files.map((_, i) => i) : [])); }, [files]);
  if (error) return <p role="alert" className="p-6 text-sm text-destructive">{error}</p>;
  if (!diff) return <p className="p-6 text-sm text-muted-foreground">변경사항을 불러오는 중이에요…</p>;
  const toggle = (i: number) => setClosed(c => { const n = new Set(c); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const scope = diff.merged
    ? `${diff.base ?? '기본 브랜치'}에 병합된 이 브랜치의 커밋`
    : diff.base ? `${diff.base}에서 갈라진 뒤 바뀐 것 (커밋 + 커밋 안 한 변경)` : '커밋 안 한 변경';
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto overlay-body [&>*]:shrink-0">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-medium tabular-nums">파일 {diff.files}개</span>
        <span className="text-ok tabular-nums">+{diff.add}</span>
        <span className="text-destructive tabular-nums">−{diff.del}</span>
        <span className="truncate text-xs text-muted-foreground">{scope}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()}><RefreshCw />새로고침</Button>
      </div>
      {!!diff.commits?.length && (
        <ul className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs">
          {diff.commits.map(c => (
            <li key={c.hash} className="flex min-w-0 items-center gap-2">
              <GitCommitHorizontal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 font-mono text-muted-foreground">{c.hash}</span>
              <span className="truncate">{c.subject}</span>
            </li>
          ))}
        </ul>
      )}
      {diff.untracked.length > 0 && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">새 파일 (아직 git에 없음)</span> <span className="font-mono">{diff.untracked.join(', ')}</span>
        </p>
      )}
      {files.length > 1 && (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setClosed(new Set())}>모두 펼치기</Button>
          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setClosed(new Set(files.map((_, i) => i)))}>모두 접기</Button>
        </div>
      )}
      {files.length
        ? files.map((f, i) => <FileBlock key={`${f.commit ?? ''}:${f.path}:${i}`} f={f} open={!closed.has(i)} onToggle={() => toggle(i)} />)
        : <p className="text-sm text-muted-foreground">바뀐 파일이 없어요.</p>}
    </div>
  );
}
