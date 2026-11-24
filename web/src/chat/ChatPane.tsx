// Inside of the chat dock window (#937), loaded on its first open: the conversation (the #915 bubbles
// and markdown reader via SessionSheet's Chat), 생각 중…, and the message box (Enter sends, Shift+Enter adds a line).
// #954: an issue asked about from the dashboard is pinned under the header, and the 시작하기 bar sits under the
// helper's proposal.
// #968 s2: the CLI's chat in the app — 새 대화, 대화 저장, 크게 보기 and the session's tokens and cost in the header;
// the box (Composer) takes images and the "/" menu; a reopened saved conversation shows its earlier messages first.
import { useEffect, useRef, type ReactNode } from 'react';
import { Maximize2, Minimize2, Save, SquarePen, X } from 'lucide-react';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Chat, type Report } from '../dispatch/SessionSheet';
import { canRun, READ_ONLY_NOTICE } from '../dispatch/lib/runnable.ts';
import type { Session } from '../../../shared/dispatch/types.ts';
import { type ChatTarget } from './lib/chatDock.ts';
import { usageText, type Attachment, type SavedMessage } from './lib/chatInput.ts';
import { Composer } from './Composer';
import { IssueCard } from './IssueAsk';
import type { AskedIssue } from './lib/askIssue';

type Props = {
  titleId: string;
  open: boolean;
  target: ChatTarget;
  session: Session | undefined;
  thinking: boolean;
  draft: string;
  setDraft: (v: string) => void;
  attachments: Attachment[];
  setAttachments: (f: (list: Attachment[]) => Attachment[]) => void;
  skills: { name: string; description: string }[];
  busy: boolean;
  /** Why the message cannot go yet (Claude not connected for the helper); replaces the empty-state hint. */
  notice: string | null;
  error: string | null;
  setError: (v: string | null) => void;
  onSend: () => void;
  onStop: () => void;
  onNew: () => void;
  onSave: () => void;
  canSave: boolean;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  /** Messages of a reopened saved conversation, shown until the new session has its own. */
  prior: SavedMessage[] | null;
  /** The issue being talked about (#954), pinned at the top. */
  issue: AskedIssue | null;
  /** Under the last entry; gets a function that puts the cursor in the message box (수정 요청). */
  after?: (focusInput: () => void) => ReactNode;
};

export default function ChatPane(p: Props) {
  const { titleId, open, target, session: s, thinking, error, setError, issue, after, prior } = p;
  const input = useRef<HTMLTextAreaElement>(null);
  // The message box takes focus when the window opens.
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);
  const report: Report = q => q.then(() => { setError(null); return true; }, (e: Error) => { setError(e.message); return false; });
  const readOnly = !!s && !canRun(s);
  const spend = usageText(s?.usage, s?.cost);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-1 border-b py-2 pr-2 pl-4">
        <h2 id={titleId} className="m-0 shrink-0 text-xs font-semibold">채팅</h2>
        {spend && <span className="chat-dock-spend" title="이 대화의 토큰과 비용">{spend}</span>}
        <div className="ml-auto flex items-center">
          <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label="새 대화" title="새 대화" onClick={p.onNew}>
            <SquarePen />
          </Button>
          <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label="대화 저장" title="대화 저장" disabled={!p.canSave} onClick={p.onSave}>
            <Save />
          </Button>
          <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={p.expanded ? '작게 보기' : '크게 보기'} title={p.expanded ? '작게 보기' : '크게 보기'} aria-pressed={p.expanded} onClick={p.onExpand}>
            {p.expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label="채팅 닫기" onClick={p.onClose}>
            <X />
          </Button>
        </div>
      </header>
      {issue && <IssueCard issue={issue} />}
      {error && <Alert variant="destructive" className="rounded-none">{error}</Alert>}
      <div className="min-h-0 flex-1">
        {s ? (
          <Chat s={s} report={report} thinking={false} after={after?.(() => input.current?.focus())} />
        ) : prior?.length ? (
          <ol className="chat-prior overlay-body-mid" aria-label="이전 대화">
            {prior.map((m, i) => (
              <li key={i} data-role={m.role}>
                <span className="chat-prior-who">{m.role === 'user' ? '나' : target.label}</span>
                <p>{m.text || (m.tools?.length ? m.tools.map(t => t.name).join(', ') : '')}</p>
              </li>
            ))}
            <li className="chat-prior-note">이어서 보내면 이 대화를 이어 가요.</li>
          </ol>
        ) : (
          <div className="flex h-full flex-col justify-end gap-1 overlay-body-mid text-xs leading-[1.55]">
            <p className="m-0 font-medium">무엇이든 물어보세요</p>
            <p role={p.notice ? 'note' : undefined} className="m-0 text-muted-foreground">
              {p.notice ?? '/ 로 스킬을 고르고, 이미지는 붙여 넣거나 끌어 놓아요.'}
            </p>
          </div>
        )}
      </div>
      <p role="status" className="chat-dock-thinking">{thinking ? '생각 중… Esc로 멈춰요' : ''}</p>
      {readOnly ? (
        <p role="note" className="overlay-foot m-0 border-t text-xs leading-[1.55] text-muted-foreground">{READ_ONLY_NOTICE}</p>
      ) : (
        <Composer
          inputRef={input}
          draft={p.draft}
          setDraft={p.setDraft}
          attachments={p.attachments}
          setAttachments={p.setAttachments}
          skills={p.skills}
          canAttach={!s || s.provider === 'claude'}
          placeholder={`${target.label}에게 메시지 보내기`}
          busy={p.busy}
          running={thinking && !!s}
          blocked={!!p.notice}
          setError={setError}
          onSend={p.onSend}
          onStop={p.onStop}
          onClear={p.onNew}
        />
      )}
    </div>
  );
}
