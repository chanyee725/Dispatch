// Ask the chat dock about one issue (#954). A tiny module store like live/issueStore.ts: an issue row (or the team
// panel's 채팅으로 가기) calls askAboutIssue, the dock subscribes, opens, pins the issue card and, for an issue nobody
// works on yet, puts a proposal question in the box for the person to send (no model call on click). Nothing starts until the person presses 시작하기
// under the answer. Metadata only (number, title, state label, URL); the issue body never enters the store.
import { useSyncExternalStore } from 'react';

export type AskedIssue = { number: number; title: string; state: string; url?: string };
/**
 * `ask`: prefill the proposal question for the helper and offer 시작하기 under its answer once it is sent. Without it the dock only opens
 * with the card pinned, talking to `partner` (the team's lead) when given.
 * `seq` grows on every call so the same issue twice opens the dock again.
 */
export type AskRequest = { issue: AskedIssue; ask: boolean; partner: string | null; seq: number };

let current: AskRequest | null = null;
let seq = 0;
const subs = new Set<() => void>();

export function askAboutIssue(issue: AskedIssue, opts: { ask?: boolean; partner?: string | null } = {}): void {
  current = { issue, ask: opts.ask ?? true, partner: opts.partner ?? null, seq: ++seq };
  subs.forEach((f) => f());
}

const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
const read = () => current;
export const useAskRequest = () => useSyncExternalStore(subscribe, read, read);

/** The helper's first message for an issue: a short proposal, explicitly not a start. */
export const issueAskText = (n: number) => `#${n} 이슈를 읽고 무엇을 할지, 범위, 팀 구성을 짧게 제안해 줘. 아직 시작하지 마`;

/**
 * Whether the helper has answered the ask: an assistant entry after the last user entry that carries the ask text.
 * The start buttons wait for that, so they sit under the proposal and not under an empty chat.
 */
export function answeredAsk(entries: readonly { kind: string; text: string }[] | undefined, n: number): boolean {
  if (!entries) return false;
  const ask = issueAskText(n);
  let at = -1;
  entries.forEach((e, i) => {
    if (e.kind === 'user' && e.text.includes(ask)) at = i;
  });
  // The hub echoes every message, the helper's first prompt included, as a user entry (hub.js); no ask, no answer.
  return at >= 0 && entries.slice(at + 1).some((e) => e.kind === 'assistant');
}

export type StartState = { state: 'idle' } | { state: 'busy' } | { state: 'done'; text: string } | { state: 'error'; text: string };

/**
 * The 시작하기 lock and result filter, per pinned ask (`seq`). `pin` marks a new ask current and drops the lock, so
 * a second issue can start after the first; `take` is the synchronous one-press lock; a result is shown only while
 * its ask is still the pinned one, so issue A's answer never lands on issue B's bar.
 */
export function startGate() {
  let pinned: number | null = null;
  let locked: number | null = null;
  return {
    pin(seq: number) {
      pinned = seq;
      locked = null;
    },
    take(seq: number) {
      if (seq !== pinned || locked === seq) return false;
      locked = seq;
      return true;
    },
    release(seq: number) {
      if (locked === seq) locked = null;
    },
    current: (seq: number) => seq === pinned,
  };
}
export type StartGate = ReturnType<typeof startGate>;

/** One 시작하기 press: lock, run, and show the outcome only if `seq` is still pinned. A failure unlocks for a retry. */
export async function runStart(gate: StartGate, seq: number, work: () => Promise<string>, show: (s: StartState) => void): Promise<void> {
  if (!gate.take(seq)) return;
  show({ state: 'busy' });
  try {
    const text = await work();
    if (gate.current(seq)) show({ state: 'done', text });
  } catch (e) {
    gate.release(seq);
    if (gate.current(seq)) show({ state: 'error', text: `시작하지 못했어요. ${(e as Error).message}` });
  }
}
