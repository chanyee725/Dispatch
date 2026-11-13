#!/usr/bin/env node
// Claude Code PreToolUse hook shipped with the Dispatch plugin (issue #31).
// Inside a Dispatch session (DISPATCH_SESSION / DISPATCH_PARENT / DISPATCH_SELF set) it does nothing. In any other
// Claude Code session, before a file edit, it checks whether a live Dispatch server runs for the project that holds
// the file (~/.dispatch/servers/*.json, pid check only, no network). If so, once per session, it adds a note to the
// model's context: the main session delegates implementation to a lead instead of editing files itself. It never
// blocks the tool. Any failure exits 0 silently. The marker holds no personal data: its name is the sanitized
// session id, its content is empty.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

export const NOTE = "[Dispatch 훅] 이 프로젝트에는 Dispatch 서버가 돌고 있다. 메인 세션은 구현·수정·조사를 직접 하지 않는다. 파일을 직접 고치지 말고 Dispatch 관리자(lead)에게 맡겨라: 브리프를 쓰고, 머지 전에 확인하고, PR에 코멘트하고 머지하는 것만 한다. 다른 흐름의 일(다른 영역·저장소, 또는 지금 관리자의 컨텍스트가 무겁거나 longRun)이면 기존 관리자에 얹지 말고 새 관리자를 만들어라. 리뷰의 작은 should-fix도 담당 관리자에게 돌려보낸다.";

export function expandHome(p, home = homedir()) {
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p;
}

export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function inside(file, dir) {
  const d = resolve(dir);
  return file === d || file.startsWith(d.endsWith(sep) ? d : d + sep);
}

// Returns the registry entry of a live Dispatch server whose project contains `target`, or null.
export function findServer(target, registryDir, home = homedir()) {
  for (const f of readdirSync(registryDir)) {
    if (!f.endsWith(".json")) continue;
    let e;
    try { e = JSON.parse(readFileSync(join(registryDir, f), "utf8")); } catch { continue; }
    if (typeof e?.path !== "string" || !e.path) continue;
    const dir = expandHome(e.path, home);
    if (!isAbsolute(dir)) continue;
    if (inside(target, dir) && alive(e.pid)) return e;
  }
  return null;
}

export function run(env = process.env, input = {}, registryDir = join(homedir(), ".dispatch", "servers"), markDir = tmpdir(), home = homedir()) {
  try { return check(env, input, registryDir, markDir, home); } catch { return null; }
}

function check(env, input, registryDir, markDir, home) {
  if (env.DISPATCH_SESSION || env.DISPATCH_PARENT || env.DISPATCH_SELF) return null;
  if (!input || typeof input !== "object") return null;
  const sid = typeof input.session_id === "string" ? input.session_id.replace(/[^\w-]/g, "_").slice(0, 80) : "";
  if (!sid) return null;
  const cwd = typeof input.cwd === "string" && isAbsolute(input.cwd) ? input.cwd : null;
  const fp = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const target = typeof fp === "string" && fp ? resolve(cwd ?? "/", expandHome(fp, home)) : cwd;
  if (!target || !isAbsolute(target)) return null;
  const mark = join(markDir, `dispatch-main-${sid}`);
  if (existsSync(mark) || !existsSync(registryDir)) return null;
  if (!findServer(target, registryDir, home)) return null;
  writeFileSync(mark, "");
  return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: NOTE } };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("main-delegates.mjs")) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", c => { raw += c; });
  process.stdin.on("end", () => {
    try {
      const out = run(process.env, JSON.parse(raw));
      if (out) process.stdout.write(JSON.stringify(out));
    } catch { /* fail silently */ }
    process.exit(0);
  });
  process.stdin.on("error", () => process.exit(0));
}
