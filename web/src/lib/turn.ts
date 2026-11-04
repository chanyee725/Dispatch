import { totalTok } from "@/lib/format";
import type { Session } from "@/types";

/** Current turn's start and tokens, from the server's turn baseline (older servers: none). */
export function turn(s: Session): { at?: number; tokens?: number } {
  const t = s as Session & { turnStartedAt?: number; turnTokensBase?: number };
  if (!t.turnStartedAt) return {};
  return { at: t.turnStartedAt, tokens: totalTok(s.usage) - (t.turnTokensBase ?? 0) };
}
