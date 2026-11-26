// 작업 보기 (E673, #905): what the session is making right now, read-only, inside the agent live view.
// GET /api/sessions/:id/diff every few seconds while the panel is on screen and the tab is visible: the changed files
// with +/− counts, the newest one unfolded. A file link from 진행 (`reveal`, #905) switches to this view, unfolds that
// file and focuses its row; a file the session did not change has no diff to show.
// File contents stay in memory only; nothing is stored or logged.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LiveFile } from '../../../shared/dispatch/live.ts';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import type { FileDiff } from '../dispatch/lib/patch.ts';
import { middle } from './format';
import { changedFiles, samePath, WORK_POLL_MS, type ChangedFile, type DiffAnswer } from './workView';

interface Props {
  sid: string;
  step?: string;
  statusLabel?: string;
  files: readonly LiveFile[];
  /** The panel is on screen (not hidden under a session sheet). */
  shown: boolean;
  /** A code file a link asked to see: shows that file unfolded. */
  reveal?: string | null;
}

export function AgentWorkView(p: Props) {
  return <CodeWork sid={p.sid} files={p.files} shown={p.shown} step={p.step} statusLabel={p.statusLabel} reveal={p.reveal ?? null} />;
}

/** Polls the session diff while `shown` and the tab is visible; the same patch does not re-render. */
function useSessionDiff(sid: string, shown: boolean) {
  const [diff, setDiff] = useState<DiffAnswer | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const [attempt, setAttempt] = useState(0);
  const last = useRef('');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  useEffect(() => {
    if (!shown || !visible) return;
    const ctl = new AbortController();
    let timer = 0;
    const tick = () => {
      void fetch(`/api/sessions/${encodeURIComponent(sid)}/diff`, { signal: ctl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          const d = (await r.json()) as DiffAnswer;
          const key = `${d.patch}\n\0${(d.untracked ?? []).join('\n')}`;
          setFailed(false);
          if (key !== last.current) {
            last.current = key;
            setDiff({ patch: d.patch ?? '', untracked: d.untracked ?? [] });
          }
        })
        .catch(() => !ctl.signal.aborted && setFailed(true))
        .finally(() => {
          if (!ctl.signal.aborted) timer = window.setTimeout(tick, WORK_POLL_MS);
        });
    };
    tick();
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, [sid, shown, visible, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { diff, failed, retry };
}

function CodeWork({ sid, files, shown, step, statusLabel, reveal }: { sid: string; files: readonly LiveFile[]; shown: boolean; step?: string; statusLabel?: string; reveal: string | null }) {
  const { diff, failed, retry } = useSessionDiff(sid, shown);
  const list = useMemo(() => (diff ? changedFiles(diff, files) : []), [diff, files]);
  // The newest file (or the one a link asked for) is open unless folded by hand; any other opens on a click.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  useEffect(() => setToggled(new Map()), [sid, reveal]);
  const target = reveal ? (list.find((c) => samePath(c.path, reveal))?.path ?? null) : null;
  const isOpen = (c: ChangedFile, i: number) => toggled.get(c.path) ?? (reveal ? c.path === target : i === 0);
  const toggle = (c: ChangedFile, i: number) => setToggled((m) => new Map(m).set(c.path, !isOpen(c, i)));
  const ul = useRef<HTMLUListElement>(null);
  // Bring the asked-for file into view and put focus on its row once the diff has it.
  useEffect(() => {
    if (!target) return;
    const li = [...(ul.current?.children ?? [])].find((el) => (el as HTMLElement).dataset.workFile === target);
    const row = li?.querySelector('summary');
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }, [target]);
  const missing = reveal && diff && !target ? (
    <p className="agent-live-muted" role="status" data-work-missing>
      {middle(reveal, 40)} 파일은 이 세션에서 바뀌지 않아서 보여 줄 변경이 없어요.
    </p>
  ) : null;

  if (failed && !diff) {
    return (
      <section>
        <p className="agent-live-error">바뀐 파일을 불러오지 못했어요</p>
        <button type="button" onClick={retry} className={cn('agent-live-btn', FOCUS_RING)}>다시 시도</button>
      </section>
    );
  }
  if (!diff) return <section><p className="agent-live-muted">바뀐 파일을 불러오는 중이에요…</p></section>;
  if (!list.length) {
    return (
      <section>
        {(step || statusLabel) && (
          <dl className="agent-live-now">
            {step && <div><dt>단계</dt><dd className="truncate" title={step}>{step}</dd></div>}
            {statusLabel && <div><dt>지금</dt><dd className="truncate" title={statusLabel}>{statusLabel}</dd></div>}
          </dl>
        )}
        {missing ?? <p className="agent-live-muted">아직 바뀐 파일이 없어요.</p>}
      </section>
    );
  }
  const add = list.reduce((n, c) => n + c.add, 0);
  const del = list.reduce((n, c) => n + c.del, 0);
  return (
    <section>
      <h3>
        바뀐 파일 <span className="agent-live-count">{list.length}개</span>
        <span className="agent-work-sum"><span className="text-ok">+{add}</span> <span className="text-destructive">−{del}</span></span>
      </h3>
      {failed && <p className="agent-live-muted" role="status">최신 변경을 불러오지 못했어요. 이전 내용이에요.</p>}
      {missing}
      <ul ref={ul} className="agent-live-list agent-work-files">
        {list.map((c, i) => {
          const open = isOpen(c, i);
          return (
            <li key={c.path} data-work-file={c.path}>
              {/* A native disclosure (details/summary); the patch is only drawn while open. */}
              <details open={open} onToggle={(e) => e.currentTarget.open !== open && toggle(c, i)}>
                <summary className={cn('agent-work-row', FOCUS_RING)}>
                  <ChevronRight aria-hidden className={cn('agent-work-chev size-3.5 shrink-0', open && 'rotate-90')} />
                  <span className="agent-live-target" title={c.path}>{middle(c.path, 48)}</span>
                  {c.untracked ? (
                    <span className="agent-live-time">새 파일</span>
                  ) : (
                    <span className="agent-work-counts">
                      <span className="text-ok">+{c.add}</span>
                      <span className="text-destructive">−{c.del}</span>
                    </span>
                  )}
                </summary>
                {open && <FilePatch c={c} />}
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Lines drawn per file; the rest is in the session sheet's 변경사항 tab. */
const MAX_LINES = 400;

function FilePatch({ c }: { c: ChangedFile }) {
  if (c.untracked) return <p className="agent-work-note">아직 git에 없는 새 파일이라 줄 단위 변경이 없어요.</p>;
  const lines = c.parts.flatMap((f: FileDiff) => (f.binary ? [{ kind: 'hunk' as const, text: '바이너리 파일' }] : f.lines));
  const shownLines = lines.slice(0, MAX_LINES);
  return (
    <div className="agent-work-patch" role="region" aria-label={`${c.path} 변경 내용`}>
      {shownLines.map((l, i) =>
        l.kind === 'hunk' ? (
          <div key={i} className="agent-work-hunk">{l.text || '⋯'}</div>
        ) : (
          <div key={i} className="agent-work-line" data-kind={l.kind}>
            <span className="agent-work-no">{l.kind === 'del' ? (l.old ?? '') : (l.new ?? '')}</span>
            <span aria-hidden className="agent-work-sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</span>
            <span className="sr-only">{l.kind === 'add' ? '추가' : l.kind === 'del' ? '삭제' : ''}</span>
            <span className="agent-work-text">{l.text || ' '}</span>
          </div>
        ),
      )}
      {lines.length > MAX_LINES && <p className="agent-work-note">{lines.length - MAX_LINES}줄 더 있어요. 대화 보기의 변경사항에서 전체를 볼 수 있어요.</p>}
    </div>
  );
}
