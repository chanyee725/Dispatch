#!/usr/bin/env node
// Claude Code PostToolUse hook shipped with the Dispatch plugin (issue #29).
// Outside a Dispatch session (no DISPATCH_SESSION) it does nothing. Inside one, it asks the local Dispatch
// server whether this session is past the length guard (`longRun`) and, once per session, adds a note to the
// model's context telling it to wrap up and hand over. The server already says this through the lead; the hook
// is the backstop for a session that kept working through that message. Any failure exits 0 silently.
import { existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHECK_EVERY_MS = 120_000;

export function noteFor(s) {
  const m = s.longRun?.mtok ?? "?";
  return s.parent
    ? `[Dispatch 훅] 이 세션은 누적 ${m}M 토큰을 넘었다. 새 일을 시작하지 마라. 지금 단계를 마무리해 커밋하고, 결과(브랜치·커밋·검사 결과·남은 일)를 한 번에 보고하고 턴을 끝내라. 남은 일은 관리자가 새 팀원에게 넘긴다.`
    : `[Dispatch 훅] 이 세션은 누적 ${m}M 토큰을 넘었다. 새 일을 시작하지 마라. 남은 일을 40줄 이내로 인계(작업마다 담당·브랜치·커밋·단계·다음 할 일)해 답하고, 새 관리자로 바꿔 달라고 요청하며 턴을 끝내라.`;
}

export async function run(env = process.env, fetchFn = globalThis.fetch, markDir = tmpdir()) {
  const url = env.DISPATCH_URL, id = env.DISPATCH_SESSION;
  if (!url || !id || !/^[\w-]{1,80}$/.test(id) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) return null;
  const mark = join(markDir, `dispatch-long-${id}`);
  if (existsSync(mark)) return null;
  // Ask the server at most every two minutes per session: tool calls come fast and the state route is not free.
  const seen = join(markDir, `dispatch-long-seen-${id}`);
  try { if (Date.now() - statSync(seen).mtimeMs < CHECK_EVERY_MS) return null; } catch { /* first check */ }
  writeFileSync(seen, "");
  const res = await fetchFn(`${url}/api/state`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) return null;
  const s = (await res.json()).sessions?.find(x => x.id === id);
  if (!s?.longRun) return null;
  writeFileSync(mark, "");
  return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: noteFor(s) } };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("long-session.mjs")) {
  process.stdin.resume();
  process.stdin.on("data", () => {});
  run().then(out => { if (out) process.stdout.write(JSON.stringify(out)); }).catch(() => {}).finally(() => process.exit(0));
}
