import { readFileSync } from "node:fs";
import path from "node:path";
import { pluginDir } from "./plugins.js";

// Reply style for every Dispatch session: the i-have-adhd ruleset (lead with the next action,
// number steps, no tangents) when that Claude Code plugin is installed, else a short fallback.
// DISPATCH_REPLY_STYLE=off turns it off. Read once per server start.

const FALLBACK = `[답변 방식]
- 첫 줄은 결론이나 다음 행동이다. 인사·서론·요약 반복은 쓰지 않는다.
- 여러 단계면 번호를 붙이고, 한 항목은 한두 줄로 끝낸다.
- 지금 일과 상관없는 이야기는 하지 않는다.`;

function adhdSkill() {
  const dir = pluginDir("i-have-adhd");
  if (!dir) return null;
  try {
    const body = readFileSync(path.join(dir, "skills", "i-have-adhd", "SKILL.md"), "utf8")
      .replace(/^---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/, "")
      .trim();
    return body ? `[답변 방식: i-have-adhd]\n${body}` : null;
  } catch {
    return null;
  }
}

let cached;
export function replyStyle() {
  if (cached === undefined) cached = adhdSkill() ?? FALLBACK;
  return cached;
}
