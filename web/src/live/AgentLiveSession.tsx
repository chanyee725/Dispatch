// Detail tabs of the agent live panel, loaded on first visit.
import { useEffect } from 'react';
import { Info } from '../dispatch/SessionInfo';
import { DiffView } from '../dispatch/DiffView';
import { AgentOrgTree } from './AgentOrgTree';
import { connect, useDispatch } from '../dispatch/store';

export type SessionTab = 'diff' | 'info' | 'org';

export default function AgentLiveSession({ sid, tab }: { sid: string; tab: SessionTab }) {
  // The Dispatch store is fed only while one of these tabs is open.
  useEffect(() => connect(), []);
  const sessions = useDispatch((st) => st.sessions);
  const s = sessions.find((x) => x.id === sid);
  if (!s) return <section><p className="agent-live-muted">세션을 불러오는 중이에요…</p></section>;
  return (
    <div className="agent-live-session" data-session-tab={tab}>
      {tab === 'org' ? (
        <div className="agent-live-session-scroll agent-live-body"><AgentOrgTree sessions={sessions} sid={s.id} /></div>
      ) : (
        <div className="agent-live-session-scroll">{tab === 'diff' ? <DiffView s={s} /> : <Info s={s} />}</div>
      )}
    </div>
  );
}
