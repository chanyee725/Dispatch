// Rows of a provider's usage limits, shared by the sidebar usage card (#698) and the 세션 보드 사용량 card (#897).
// Both read the same per-provider groups (useUsage: GET /api/limits + providers), so they show the same numbers.
// Numbers only: no account, email or token.
import type { DispatchSettings } from '../api';
import { guardValue, type GuardField, type UsageGroup, type UsageWindow } from '../settings/model.ts';

/** Claude's windows, always listed in this order (missing ones say there is no data yet). */
const CLAUDE_WINDOWS = ['5시간', '주간', 'Fable 주간'];
/** The guard field holding each window's block threshold. */
const GUARD_OF: Record<string, Record<string, GuardField['id']>> = {
  claude: { '5시간': 'five', 주간: 'seven', 'Fable 주간': 'fable' },
  openai: { '5시간': 'codexFive', 주간: 'codexSeven' },
};

export type CardRow = { label: string; used: number | null; reset: number | null; limit: number | null };

/** The rows the card shows for a provider: Claude's three windows in order, else the windows the provider reported. */
export function cardRows(id: string, group: UsageGroup | undefined, settings: DispatchSettings | null): CardRow[] {
  const windows: (UsageWindow | { label: string; used: null; reset: null })[] =
    id === 'claude' ? CLAUDE_WINDOWS.map((label) => group?.windows.find((w) => w.label === label) ?? { label, used: null, reset: null }) : (group?.windows ?? []);
  return windows.map((w) => {
    const field = GUARD_OF[id]?.[w.label];
    return { label: w.label, used: w.used ?? null, reset: w.reset ?? null, limit: field && settings ? guardValue(field, settings) : null };
  });
}
