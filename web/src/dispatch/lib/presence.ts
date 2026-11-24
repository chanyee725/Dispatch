// A board Session as the card input of the dashboard's SessionCard (#919): the card reads an AgentPresence, so the
// 세션 보드 maps each session to one. Pure; metadata only (names, state, labels), never transcript text.
import type { AgentPresence } from '../../../../shared/dispatch/agent-presence.ts';
import type { Session, SessionState } from '../../../../shared/dispatch/types.ts';

/** `stateOf` is passed in so this file stays free of the format module's UI imports. */
export function presenceOf(s: Session, stateOf: (s: Session) => SessionState): AgentPresence {
  const state = stateOf(s);
  // What the card shows under the name: why a person should look, else what it does now.
  const reason = (state === 'waiting' || state === 'stuck' || state === 'failed') && s.attention?.reason ? s.attention.reason : s.stall?.reason;
  return {
    sid: s.id,
    name: s.name,
    n: s.n,
    parent: s.parent ?? undefined,
    role: s.role,
    roleName: s.roleName,
    color: s.color,
    model: s.model,
    modelLabel: s.modelLabel ? `${s.modelLabel}${s.effort ? ` ${s.effort}` : ''}` : undefined,
    provider: s.provider,
    statusLabel: reason || s.activity?.label || undefined,
    status: s.status,
    state,
    project: s.folder ?? null,
    file: null,
    at: s.stateSince ?? s.updatedAt ?? null,
  };
}
