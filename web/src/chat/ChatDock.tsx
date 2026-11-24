// Chat dock (#937): a round button at the bottom right opens a 380×560 chat window, so a person can talk to a session
// from the web instead of the CLI. The default partner is the 도우미 (helper), a lead-level session of this project
// made on the first send; any other live session can be picked in the window's header.
// The window is a non-modal <dialog popover="manual">: the page stays usable, ✕ or Esc closes it and focus goes back
// to the button. It moves left of an open agent live panel and hides under a modal (chat-dock.css).
// The conversation lives only in the Dispatch store's memory (no disk, localStorage or logs).
// #954: an issue row (askAboutIssue) opens the dock on the helper with the issue pinned and asks for a proposal; the
// work reaches a lead only through 시작하기 under the answer (one press, locked synchronously like sendOnce).
// #968 s2: the CLI in the app. One partner (the main session); images, the "/" menu, Esc or 정지 stops a turn, 새 대화
// (/clear) saves and ends the helper, 대화 저장 writes the masked record (POST /api/chats) and tells the sidebar,
// 크게 보기 widens the window. openChatSession (index.ts) reopens a saved conversation through a window event.
import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MessageCircle } from 'lucide-react';
import { api, connect, getState, loadTranscript, useDispatch } from '../dispatch/store';
import type { Session } from '../../../shared/dispatch/types.ts';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { badgeText, mainTarget, PARTNER_KEY, helperBody, HELPER_OFFLINE, helperOffline, isAlive, replies, sendOnce, sessionGone, unread } from './lib/chatDock.ts';
import { answeredAsk, issueAskText, runStart, startGate, useAskRequest, type AskRequest, type StartState } from './lib/askIssue.ts';
import { issueTask, newLeadBody, type TeamPick } from '../home/issueStart.ts';
import { IssueStartBar } from './IssueAsk';
import { chatRecord, imagesBody, isClear, isCliSessionId, withPrior, worthSaving, type Attachment, type SavedMessage } from './lib/chatInput.ts';
import { HISTORY_CHANGED, OPEN_CHAT, OPEN_CHAT_SESSION, type ChatSummary } from '../shell/chatHistory';
import './chat-dock.css';

const ChatPane = lazy(() => import('./ChatPane'));

/** `folder`: the project shown (a top-level workspace folder); the helper works for it. */
export function ChatDock({ folder }: { folder: string | null }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  // Memory only: the helper's id, the draft and how many replies were seen per session.
  const [helperId, setHelperId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // #968 s2, memory only: attached images, the skill list for "/", the wide window, the saved record this conversation
  // updates, and a reopened conversation (its CLI session to resume and its earlier messages).
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [resume, setResume] = useState<string | null>(null);
  const [prior, setPrior] = useState<SavedMessage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Record<string, number>>({});
  // One send at a time, checked synchronously (sendOnce); `busy` only drives the UI.
  const sending = useRef(false);
  // #954: the issue pinned at the top, and its 시작하기 state; `gate` is the per-ask one-press lock and result filter.
  const [pin, setPin] = useState<AskRequest | null>(null);
  const [start, setStart] = useState<StartState>({ state: 'idle' });
  const gate = useRef(startGate()).current;
  const handled = useRef(0);
  const asked = useAskRequest();
  // A partner other than the helper (a lead the talk moved to); none is picked from outside any more.
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // The store is fed only once the dock is used (opened or a conversation started), not on every page.
  const active = open || helperId !== null || partnerId !== null;
  useEffect(() => (active ? connect() : undefined), [active]);
  const unavailable = useDispatch(st => st.unavailable);
  const sessions = useDispatch(st => st.sessions);
  const providers = useDispatch(st => st.providers);
  const target = useMemo(() => mainTarget(sessions, helperId, partnerId), [sessions, helperId, partnerId]);
  const sid = target.id;
  const s: Session | undefined = sid ? sessions.find(x => x.id === sid) : undefined;
  // Talking to a partner lead: its transcript is the team's work, so it is not saved as a chat or ended by 새 대화.
  const onPartner = target.key === PARTNER_KEY;
  const entries = useDispatch(st => (sid ? st.transcripts[sid] : undefined));
  // Claude not connected: say so before the first send instead of failing on it.
  const offline = helperOffline(target, providers);

  useEffect(() => {
    if (sid && !getState().transcripts[sid]) loadTranscript(sid).catch((e: Error) => setError(e.message));
  }, [sid]);

  // What is on screen while the window is open counts as read.
  const count = replies(entries);
  useEffect(() => {
    if (open && sid && seen[sid] !== count) setSeen(m => ({ ...m, [sid]: count }));
  }, [open, sid, count, seen]);
  const badge = !open && sid && seen[sid] !== undefined ? unread(entries, seen[sid]) : 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const shown = el.matches(':popover-open');
    if (open && !shown) el.showPopover();
    else if (!open && shown) el.hidePopover();
  }, [open]);

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => fab.current?.focus({ preventScroll: true }));
  };
  const toggle = () => {
    if (open) return close();
    setOpened(true);
    setOpen(true);
  };

  // The "/" menu's skills: names and descriptions only, loaded once the window is first opened.
  useEffect(() => {
    if (!opened) return;
    api<{ skills: { name: string; description: string }[] }>('GET', '/api/skills').then(r => setSkills(r.skills), () => {});
  }, [opened]);

  /** Sends `text` (and `images`) to session `to`, or makes the helper with it when `to` is null. Returns whether it went out. */
  const deliver = async (text: string, to: string | null, images: Attachment[] = [], restore = text) => {
    let ok = false;
    const ran = await sendOnce(sending, async () => {
      setBusy(true);
      setError(null);
      // The box clears at once; a failed send puts the text back.
      setDraft('');
      setAttachments(() => []);
      const imgs = images.length ? imagesBody(images) : undefined;
      try {
        if (to) {
          await api('POST', `/api/sessions/${encodeURIComponent(to)}/message`, imgs ? { text, images: imgs } : { text });
        } else {
          const res = await api<{ sessions: Session[] }>('POST', '/api/sessions', helperBody(text, folder, { resume, images: imgs }));
          const made = res.sessions[0]?.id;
          if (made) {
            setHelperId(made);
            setResume(null);
            loadTranscript(made).catch(() => {});
          }
        }
        ok = true;
      } catch (e) {
        setDraft(restore);
        setAttachments(() => images);
        setError((e as Error).message);
        // A helper that is gone (removed elsewhere) is made again on the next send; a passing error keeps it.
        if (to && to === helperId && sessionGone(e)) setHelperId(null);
      } finally {
        setBusy(false);
      }
    });
    // Another send in flight: keep the text in the box instead of dropping it.
    if (!ran) setDraft(restore);
    return ok;
  };

  const send = async () => {
    const text = draft.trim();
    if (offline) return;
    if (isClear(text)) return void newChat();
    if (!text && !attachments.length) return;
    await deliver(text, sid, attachments, text);
  };

  /** Esc or 정지: interrupts the running turn (the CLI's Esc). */
  const stop = () => {
    if (!sid) return;
    api('POST', `/api/sessions/${encodeURIComponent(sid)}/interrupt`).catch((e: Error) => setError(e.message));
  };

  /** Writes the conversation (masked by the server) and tells the sidebar list to reload. */
  const save = async (quiet = false) => {
    if (!worthSaving(entries)) return false;
    try {
      const body = withPrior(chatRecord(entries ?? [], s?.providerSessionId ?? resume ?? null, savedId ?? undefined), prior);
      const res = await api<{ chat: { id: string } }>('POST', '/api/chats', body);
      setSavedId(res.chat.id);
      window.dispatchEvent(new Event(HISTORY_CHANGED));
      if (!quiet) toast.success('대화를 저장했어요');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  /** 새 대화 (/clear): saves what is there, ends the helper (its CLI process), and the next message makes a new one. */
  const newChat = async () => {
    // A partner lead keeps working: 새 대화 only leaves it and goes back to the helper.
    if (onPartner) {
      setPartnerId(null);
      setDraft('');
      setAttachments(() => []);
      setError(null);
      return;
    }
    if (worthSaving(entries) && !(await save(true))) return;
    const old = helperId;
    setHelperId(null);
    setSavedId(null);
    setResume(null);
    setPrior(null);
    setPartnerId(null);
    setDraft('');
    setAttachments(() => []);
    setError(null);
    if (old) api('POST', `/api/sessions/${encodeURIComponent(old)}/kill`).catch(() => {});
  };

  /** Reopens a saved conversation by its CLI session id: the live helper that has it, else a new one that resumes it. */
  const openSession = useCallback(async (cliSessionId: string) => {
    if (!isCliSessionId(cliSessionId)) return;
    setOpened(true);
    setOpen(true);
    setPartnerId(null);
    setError(null);
    setDraft('');
    setAttachments(() => []);
    const live = getState().sessions.find(x => x.providerSessionId === cliSessionId && isAlive(x));
    if (live) {
      setHelperId(live.id);
      setResume(null);
      setPrior(null);
    } else {
      setHelperId(null);
      setResume(cliSessionId);
    }
    // The saved record: its id (a later save updates it) and, for a resumed session, its earlier messages.
    try {
      const { chats } = await api<{ chats: ChatSummary[] }>('GET', '/api/chats');
      const hit = chats.find(c => c.sessionId === cliSessionId);
      setSavedId(hit?.id ?? null);
      if (!hit || live) return setPrior(null);
      const { chat } = await api<{ chat: { messages: SavedMessage[] } }>('GET', `/api/chats/${encodeURIComponent(hit.id)}`);
      setPrior(chat.messages);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const on = (e: Event) => void openSession((e as CustomEvent<{ cliSessionId?: unknown }>).detail?.cliSessionId as string);
    window.addEventListener(OPEN_CHAT_SESSION, on);
    return () => window.removeEventListener(OPEN_CHAT_SESSION, on);
  }, [openSession]);

  // `#chat` (openChat): open the window on whatever conversation it holds.
  useEffect(() => {
    const on = () => {
      setOpened(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_CHAT, on);
    return () => window.removeEventListener(OPEN_CHAT, on);
  }, []);

  // An issue row asked about an issue: open on the helper (or the team's lead), pin the card, prefill the question.
  useEffect(() => {
    if (!asked || asked.seq === handled.current) return;
    handled.current = asked.seq;
    setPartnerId(null);
    setPin(asked);
    gate.pin(asked.seq);
    setStart({ state: 'idle' });
    setError(null);
    setOpened(true);
    setOpen(true);
    if (!asked.ask) return;
    // Opening an issue never calls the model by itself (2026-11-20): the proposal question waits in the box, and
    // the person sends it (or edits it) when they want an answer.
    setDraft(issueAskText(asked.issue.number));
    // Runs once per request (seq); the other values are read as they are at that moment.
  }, [asked]);

  const startIssue = (team: TeamPick, leadId: string) => {
    if (!pin) return;
    const issue = { number: pin.issue.number, title: pin.issue.title };
    return runStart(gate, pin.seq, async () => {
      if (leadId) {
        await api('POST', `/api/sessions/${encodeURIComponent(leadId)}/message`, { text: issueTask(issue, team) });
        const name = sessions.find(x => x.id === leadId)?.name ?? '관리자';
        return `${name}에게 보냈어요. 곧 팀원을 만들어요.`;
      }
      const { default: rules } = await import('../../../plugin/skills/atelier-team/reference/rules.md?raw');
      await api('POST', '/api/sessions', newLeadBody(issue, team, rules, folder));
      return '새 관리자를 만들었어요. 곧 팀원을 만들어요.';
    }, setStart);
  };

  if (unavailable) return null;
  // Waiting for the answer: our request in flight, a helper that is being made, or the session's turn running.
  const thinking = busy || (helperId !== null && !s) || s?.status === 'running' || s?.status === 'starting';
  // The 시작하기 bar: under the helper's answer to the ask, while the helper is not mid-turn (kept once pressed).
  const showBar = !!pin?.ask && !!s && (start.state !== 'idle' || (!thinking && answeredAsk(entries, pin.issue.number)));
  const label = badge ? `채팅 열기, 읽지 않은 답 ${badge}개` : '채팅 열기';

  return (
    <>
      <button
        ref={fab}
        type="button"
        className={cn('chat-dock-fab', FOCUS_RING)}
        aria-label={open ? '채팅 닫기' : label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <MessageCircle aria-hidden className="size-5" />
        {badge > 0 && <span aria-hidden className="chat-dock-badge">{badgeText(badge)}</span>}
      </button>
      <dialog
        ref={ref}
        popover="manual"
        className="chat-dock-window"
        aria-labelledby={titleId}
        data-expanded={expanded || undefined}
        onKeyDown={e => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            // Like the CLI: Esc stops a running turn first; with nothing running it closes the window.
            // A document's lead may be mid-way through its team's work: Esc only closes; 정지 still stops it.
            if (thinking && s && !onPartner) stop();
            else close();
          }
        }}
      >
        {opened && (
          <Suspense fallback={<p className="chat-dock-muted">불러오는 중이에요…</p>}>
            <ChatPane
              titleId={titleId}
              open={open}
              target={target}
              session={s}
              thinking={thinking}
              draft={draft}
              setDraft={setDraft}
              attachments={attachments}
              setAttachments={setAttachments}
              skills={skills}
              busy={busy}
              notice={offline ? HELPER_OFFLINE : null}
              error={error}
              setError={setError}
              onSend={() => void send()}
              onStop={stop}
              onNew={() => void newChat()}
              onSave={() => void save()}
              canSave={!onPartner && worthSaving(entries)}
              expanded={expanded}
              onExpand={() => setExpanded(v => !v)}
              prior={s ? null : prior}
              onClose={close}
              issue={pin?.issue ?? null}
              after={showBar ? focusInput => (
                <IssueStartBar
                  key={pin!.seq}
                  // The helper is a lead-level session too; it proposes, it does not take the work.
                  sessions={sessions.filter(x => x.id !== helperId)}
                  state={start}
                  onStart={(team, leadId) => void startIssue(team, leadId)}
                  onRevise={focusInput}
                />
              ) : undefined}
            />
          </Suspense>
        )}
      </dialog>
    </>
  );
}
