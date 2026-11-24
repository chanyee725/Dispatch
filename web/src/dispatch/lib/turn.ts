// The current turn and the "지금 …" line. Pure.
import { totalTok } from './format.ts';
import type { Session } from '../../../../shared/dispatch/types.ts';

type TurnFields = { turnStartedAt?: number; turnTokensBase?: number; asksUser?: boolean };

/** Current turn's start and tokens, from the server's turn baseline (none on older servers). */
export function turn(s: Session): { at?: number; tokens?: number } {
  const t = s as Session & TurnFields;
  if (!t.turnStartedAt) return {};
  return { at: t.turnStartedAt, tokens: totalTok(s.usage) - (t.turnTokensBase ?? 0) };
}

/** True when the session ended its turn asking the user and waits for an answer (not a permission prompt). */
export function awaitsAnswer(s: Session): boolean {
  const t = s as Session & TurnFields;
  return !!t.asksUser && s.state === 'waiting' && s.pending.length === 0;
}
