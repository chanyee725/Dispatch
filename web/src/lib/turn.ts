import { totalTok } from "@/lib/format";
import type { Session } from "@/types";

/** Current turn's start and tokens, from the server's turn baseline (older servers: none). */
export function turn(s: Session): { at?: number; tokens?: number } {
  const t = s as Session & { turnStartedAt?: number; turnTokensBase?: number };
  if (!t.turnStartedAt) return {};
  return { at: t.turnStartedAt, tokens: totalTok(s.usage) - (t.turnTokensBase ?? 0) };
}

/**
 * True when the session ended its turn asking the user and waits for an answer (server state `waiting`
 * from `asksUser`, not a permission prompt). Older servers send no `asksUser`: then never.
 */
export function awaitsAnswer(s: Session): boolean {
  const t = s as Session & { asksUser?: boolean };
  return !!t.asksUser && s.state === "waiting" && s.pending.length === 0;
}
