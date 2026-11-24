// The chat's message box (#968 s2), CLI-like: images attach by paste, drop or the 📎 button (memory only, sent as
// base64 with the next message); "/" at the start opens a menu of /clear and the installed skills (cmdk, driven from
// the textarea: ↑↓ pick, Enter or Tab take, Esc closes); while the session works the send button becomes 정지.
import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type RefObject } from 'react';
import { ImagePlus, SendHorizontal, Square, X } from 'lucide-react';
import { Command, CommandItem, CommandList } from '../components/ui/command';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { cn } from '../lib/utils';
import { sendsOnEnter } from './lib/chatDock.ts';
import { IMAGE_TYPES, parseDataUrl, pickImages, skillText, slashItems, slashQuery, type Attachment, type SlashItem } from './lib/chatInput.ts';

type Props = {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  attachments: Attachment[];
  setAttachments: (f: (list: Attachment[]) => Attachment[]) => void;
  skills: { name: string; description: string }[];
  /** Images only go to Claude sessions; the helper is one. */
  canAttach: boolean;
  placeholder: string;
  busy: boolean;
  running: boolean;
  blocked: boolean;
  setError: (v: string | null) => void;
  onSend: () => void;
  onStop: () => void;
  onClear: () => void;
};

const readAsDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('이미지를 읽지 못했어요'));
    r.readAsDataURL(f);
  });

let seq = 0;

export function Composer(p: Props) {
  const { inputRef: input, draft, setDraft, attachments, setAttachments } = p;
  const file = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [menuClosed, setMenuClosed] = useState<string | null>(null);
  const query = slashQuery(draft);
  const items = useMemo(() => (query === null ? [] : slashItems(query, p.skills)), [query, p.skills]);
  const menuOpen = query !== null && items.length > 0 && menuClosed !== draft;
  const [active, setActive] = useState('');
  const current = items.find(i => i.name === active) ?? items[0];

  const attach = async (files: File[]) => {
    if (!files.length) return;
    if (!p.canAttach) return p.setError('이미지는 Claude 세션에만 보낼 수 있어요.');
    const { ok, error } = pickImages(files, attachments.length);
    p.setError(error);
    const read = await Promise.all(ok.map(async (i): Promise<Attachment | null> => {
      const parsed = parseDataUrl(await readAsDataUrl(files[i]!));
      return parsed ? { id: `img-${++seq}`, name: files[i]!.name || '이미지', ...parsed } : null;
    })).catch((e: Error): (Attachment | null)[] => { p.setError(e.message); return []; });
    const good = read.filter((a): a is Attachment => !!a);
    if (good.length) setAttachments(list => [...list, ...good]);
  };

  const take = (item: SlashItem) => {
    if (item.kind === 'command') return p.onClear();
    setDraft(skillText(item.name) + ' ');
    input.current?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void attach(files);
  };
  const dropProps = p.canAttach ? {
    onDragOver: (e: DragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      setDragging(false);
      void attach([...e.dataTransfer.files]);
    },
  } : {};

  const canSend = (!!draft.trim() || attachments.length > 0) && !p.busy && !p.blocked;

  return (
    <div className={cn('chat-composer overlay-foot border-t', dragging && 'is-dragging')} {...dropProps}>
      {menuOpen && (
        <Command className="chat-slash-menu" shouldFilter={false} value={current?.name ?? ''} onValueChange={setActive} label="명령과 스킬">
          <CommandList id="chat-slash-list" className="max-h-56">
            {items.map(item => (
              <CommandItem key={item.name} value={item.name} onSelect={() => take(item)} className="flex-col items-start gap-0.5 py-1.5">
                <span className="font-mono text-2xs">/{item.name}</span>
                {item.description && <span className="line-clamp-1 text-2xs text-muted-foreground">{item.description}</span>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      )}
      {attachments.length > 0 && (
        <ul className="chat-attachments" aria-label="붙인 이미지">
          {attachments.map(a => (
            <li key={a.id}>
              <img src={`data:${a.mediaType};base64,${a.data}`} alt={a.name} />
              <button type="button" aria-label={`${a.name} 빼기`} onClick={() => setAttachments(list => list.filter(x => x.id !== a.id))}>
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-1.5">
        {p.canAttach && (
          <>
            <Button size="icon" variant="ghost" className="shrink-0 text-muted-foreground" aria-label="이미지 붙이기" onClick={() => file.current?.click()}>
              <ImagePlus />
            </Button>
            <input
              ref={file}
              type="file"
              accept={IMAGE_TYPES.join(',')}
              multiple
              hidden
              onChange={e => {
                void attach([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </>
        )}
        <Textarea
          ref={input}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onPaste={onPaste}
          role={menuOpen ? 'combobox' : undefined}
          aria-expanded={menuOpen ? true : undefined}
          aria-controls={menuOpen ? 'chat-slash-list' : undefined}
          aria-autocomplete={menuOpen ? 'list' : undefined}
          onKeyDown={e => {
            const native = e.nativeEvent;
            if (menuOpen && !native.isComposing) {
              const i = Math.max(0, items.findIndex(x => x.name === current?.name));
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const next = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
                if (next) setActive(next.name);
                return;
              }
              if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                e.preventDefault();
                if (current) take(current);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setMenuClosed(draft);
                return;
              }
            }
            if (sendsOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: native.isComposing, keyCode: e.keyCode, repeat: e.repeat })) {
              e.preventDefault();
              if (canSend) p.onSend();
            }
          }}
          placeholder={p.placeholder}
          aria-label="메시지"
          className="max-h-40 min-h-10 resize-none rounded-[10px] px-3 py-2 text-xs leading-[1.55] md:text-xs"
          rows={1}
        />
        {p.running ? (
          <Button size="icon" variant="secondary" className="shrink-0" onClick={p.onStop} aria-label="정지 (Esc)" title="정지 (Esc)">
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button size="icon" className="shrink-0" onClick={p.onSend} disabled={!canSend} aria-label="보내기">
            <SendHorizontal />
          </Button>
        )}
      </div>
    </div>
  );
}
