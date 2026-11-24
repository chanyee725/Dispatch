import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardRows } from '../../web/src/lib/usageCardRows.ts';
import { usageGroups, type UsageEntry } from '../../web/src/settings/model.ts';

const providers = { claude: { name: 'Claude', connected: true }, openai: { name: 'Codex', connected: true }, gemini: { name: 'Gemini', connected: true } };
// The GET /api/limits shape: one entry per provider, Fable weekly in its own bucket.
const apiLimits: Record<string, UsageEntry> = {
  claude: { windows: [{ label: '5시간', used: 0.42, reset: 1000 }, { label: '주간', used: 0.18, reset: 2000 }] },
  fable: { windows: [{ label: 'Fable 주간', used: 0.05, reset: 3000 }] },
  openai: { windows: [{ label: '5시간', used: 0.3, reset: null }] },
  gemini: { windows: [{ label: '일간', used: 0.1 }] },
};

test('card rows show Claude 5시간 and 주간 as numbers from the per-provider limits (#897)', () => {
  const groups = usageGroups(apiLimits, providers);
  const claude = cardRows('claude', groups.find((g) => g.id === 'claude'), null);
  assert.deepEqual(claude.map((r) => [r.label, r.used]), [['5시간', 0.42], ['주간', 0.18], ['Fable 주간', 0.05]]);
  assert.deepEqual(cardRows('openai', groups.find((g) => g.id === 'openai'), null).map((r) => r.used), [0.3]);
  assert.deepEqual(cardRows('gemini', groups.find((g) => g.id === 'gemini'), null), [{ label: '일간', used: 0.1, reset: null, limit: null }]);
});

test('the flat store limits shape has no per-provider windows, so it cannot feed the card', () => {
  const flat = { five: 0.42, seven: 0.18, fable: null, fiveReset: 1000, sevenReset: 2000, fableReset: null, updatedAt: 1 };
  const claude = usageGroups(flat as unknown as Record<string, UsageEntry>, providers).find((g) => g.id === 'claude')!;
  assert.deepEqual(cardRows('claude', claude, null).map((r) => r.used), [null, null, null]);
});
