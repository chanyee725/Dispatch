/**
 * Whether a session can still run. The server (hub.js PROVIDERS) starts and resumes Claude, Codex (openai) and
 * Gemini sessions and exposes no flag for it, so this mirrors that list here: change both together.
 */
export const RUNNABLE_PROVIDERS: readonly string[] = ['claude', 'openai', 'gemini'];
export function canRun(s: { provider: string }): boolean {
  return RUNNABLE_PROVIDERS.includes(s.provider);
}

export const READ_ONLY_NOTICE = '이 세션은 더 이상 이어서 실행할 수 없어요. 대화만 볼 수 있어요.';
