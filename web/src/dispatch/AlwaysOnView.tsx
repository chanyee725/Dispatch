// 상시 화면 (E29): a wall-display view of /dispatch#tv. Dark, big state tiles and the 확인 필요 strip only; no
// auto-scroll and no motion. Esc or the close button goes back to the board; a tile opens its session sheet.
import { useLayoutEffect } from 'react';
import { X } from 'lucide-react';
import { roleColor } from './lib/roles';
import { AttentionGroup, useAttention } from './AttentionStrip';
import { isOpen, stateOf } from './lib/format.ts';
import { alwaysOnOrder } from './lib/usage.ts';
import { StatusBadge } from './parts';
import { useDispatch } from './store';

export function AlwaysOnView({ onExit, onOpen }: { onExit: () => void; onOpen: (id: string) => void }) {
  const sessions = useDispatch(s => s.sessions);
  const project = useDispatch(s => s.project);

  // Dark while mounted, then the user's theme comes back. Layout effects, so the theme and the Esc key are in place
  // before the first paint: no light flash, and an Esc pressed as soon as the tiles show is never lost.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const before = root.dataset.theme;
    root.dataset.theme = 'dark';
    return () => { if (before) root.dataset.theme = before; else delete root.dataset.theme; };
  }, []);
  useLayoutEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onExit(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onExit]);

  const attn = useAttention();
  const list = alwaysOnOrder(sessions, stateOf);
  const open = sessions.filter(isOpen).length;

  return (
    <div data-always-on className="flex min-h-dvh flex-col gap-4 bg-background p-6 text-foreground max-md:p-4">
      <header className="flex items-center gap-4">
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{project.name || '세션'}</h1>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">열린 세션</div>
          <div className="text-2xl font-semibold tabular-nums">{open}</div>
        </div>
        <button type="button" onClick={onExit} aria-label="상시 화면 닫기" title="닫기 (Esc)"
          className="flex size-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <X aria-hidden className="size-4" />
        </button>
      </header>

      {attn.items.length > 0 && (
        <div className="overflow-hidden rounded-card bg-background [&>section]:border-b-0">
          <AttentionGroup items={attn.items} now={attn.now} onOpen={onOpen} />
        </div>
      )}

      {list.length ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3" aria-label="세션 상태">
          {list.map(s => (
            <li key={s.id}>
              <button type="button" onClick={() => onOpen(s.id)} data-tile={s.name}
                className="flex min-h-28 w-full min-w-0 flex-col justify-between gap-3 rounded-lg border border-l-4 bg-card p-4 text-left hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                style={{ borderLeftColor: roleColor(s.role) }}>
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold">{s.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">{s.roleName}</span>
                </span>
                <StatusBadge state={stateOf(s)} className="gap-2 border-0 p-0 text-xl font-semibold text-foreground [&_svg]:size-6!" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-16 text-center text-muted-foreground">아직 세션이 없어요</p>
      )}
    </div>
  );
}
