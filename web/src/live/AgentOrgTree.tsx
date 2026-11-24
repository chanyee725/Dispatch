// 조직도 tab of the agent live panel (#943): the open session in its team, its lead above and teammates below
// (orgTree.ts). Each node: name, role chip, model mark, state dot, and the task summary a lead left (#912). Another
// node opens that session in this panel; the open one is marked, not a button. Metadata only, never prompts.
import { ProviderIcon } from '../ProviderIcon';
import { STATE, TONE_BG, providerName, stateOf } from '../dispatch/lib/format.ts';
import type { Session } from '../dispatch/types';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { orgSize, orgTree, type OrgNode } from './orgTree';
import { openAgentLive, useAgentLiveTrail } from './store';

export function AgentOrgTree({ sessions, sid }: { sessions: readonly Session[]; sid: string }) {
  const trail = useAgentLiveTrail();
  const tree = orgTree(sessions, sid);
  if (!tree) return <section><p className="agent-live-muted">세션을 불러오는 중이에요…</p></section>;
  const size = orgSize(tree);
  return (
    <section aria-labelledby="agent-org-title">
      <h3 id="agent-org-title">
        같은 팀 {size > 1 && <span className="agent-live-count">{size}명</span>}
      </h3>
      <ul className="agent-org">
        <Branch n={tree} open={id => openAgentLive(id, { trail })} />
      </ul>
      {size === 1 && <p className="agent-live-muted">위아래로 이어진 세션이 없어요</p>}
    </section>
  );
}

function Branch({ n, open }: { n: OrgNode<Session>; open: (id: string) => void }) {
  return (
    <li>
      <Node s={n.s} current={n.current} open={open} />
      {n.children.length > 0 && (
        <ul>
          {n.children.map(c => <Branch key={c.s.id} n={c} open={open} />)}
        </ul>
      )}
    </li>
  );
}

function Node({ s, current, open }: { s: Session; current: boolean; open: (id: string) => void }) {
  const state = STATE[stateOf(s)] ?? STATE.resting;
  const task = s.task || s.activity?.label || '';
  const body = (
    <>
      <span className="agent-org-line">
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', TONE_BG[state.tone])} />
        <span className="sr-only">{state.label}, </span>
        <span className="truncate font-semibold text-foreground">{s.name}</span>
        <span className="agent-org-role">{s.roleName}</span>
        <span className="agent-org-model" title={s.modelLabel || s.model}>
          <ProviderIcon provider={s.provider} className="size-3.5" />
          <span className="sr-only">{providerName(s.provider)} {s.modelLabel || s.model}</span>
        </span>
        {current && <span className="agent-org-here">지금 보는 세션</span>}
      </span>
      <span className="agent-org-task" title={task || undefined}>{task || '맡은 일 요약이 없어요'}</span>
    </>
  );
  if (current) return <div className="agent-org-node" aria-current="true" data-org-node={s.id}>{body}</div>;
  return (
    <button type="button" className={cn('agent-org-node', FOCUS_RING)} data-org-node={s.id} onClick={() => open(s.id)}>
      {body}
    </button>
  );
}
