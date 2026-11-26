// 대화 · 변경사항 · 정보 · 조직도 tabs of the agent live panel (#905). The panel shows these itself instead of opening a
// SessionSheet over it; the bodies are the SessionSheet's own (Chat, Composer, AnswerCard, DiffView, Info). Loaded
// lazily with the panel's first visit to one of them. Transcripts come from the in-memory Dispatch store, never stored.
import { useEffect, useRef, useState } from 'react';
import { Alert } from '../components/ui/alert';
import { AnswerCard, Chat, Composer, Info, type Report } from '../dispatch/SessionSheet';
import { DiffView } from '../dispatch/DiffView';
import { AgentOrgTree } from './AgentOrgTree';
import { connect, loadTranscript, useDispatch } from '../dispatch/store';

export type SessionTab = 'chat' | 'diff' | 'info' | 'org';

export default function AgentLiveSession({ sid, tab }: { sid: string; tab: SessionTab }) {
  // The Dispatch store is fed only while one of these tabs is open.
  useEffect(() => connect(), []);
  const sessions = useDispatch((st) => st.sessions);
  const s = sessions.find((x) => x.id === sid);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const report: Report = (p) => p.then(() => { setError(null); return true; }, (e: Error) => { setError(e.message); return false; });
  useEffect(() => {
    setDraft('');
    setError(null);
    void report(loadTranscript(sid));
  }, [sid]);

  if (!s) return <section><p className="agent-live-muted">세션을 불러오는 중이에요…</p></section>;
  const id = encodeURIComponent(s.id);
  const pick = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(text.length, text.length); } });
  };
  return (
    <div className="agent-live-session" data-session-tab={tab}>
      {error && <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">{error}</Alert>}
      {tab === 'chat' ? (
        <>
          <AnswerCard s={s} onPick={pick} report={report} />
          <div className="agent-live-session-scroll"><Chat s={s} report={report} /></div>
          <Composer s={s} text={draft} setText={setDraft} inputRef={input} report={report} />
        </>
      ) : tab === 'org' ? (
        <div className="agent-live-session-scroll agent-live-body"><AgentOrgTree sessions={sessions} sid={s.id} /></div>
      ) : (
        <div className="agent-live-session-scroll">{tab === 'diff' ? <DiffView s={s} /> : <Info s={s} />}</div>
      )}
    </div>
  );
}
