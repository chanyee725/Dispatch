#!/usr/bin/env node
// Claude Code PreToolUse hook shipped with the Dispatch plugin (issue #31).
// Inside a Dispatch session (DISPATCH_SESSION / DISPATCH_PARENT / DISPATCH_SELF set) it does nothing. In any other
// Claude Code session, before a file edit — or a Bash command that looks like a write (issue #33) — it checks whether
// a live Dispatch server runs for the project that holds the file (~/.dispatch/servers/*.json, pid check only, no
// network). If so it adds a note to the model's context: the main session delegates implementation to a lead instead
// of editing files itself. It repeats the note at most every REMIND_MS (30 min) per session. It never blocks the tool.
// Any failure exits 0 silently. The marker holds no personal data: its name is the sanitized session id, its content
// is empty, and its mtime is the time of the last note. Command text is never stored.
import { existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

export const NOTE = "[Dispatch 훅] 이 프로젝트에는 Dispatch 서버가 돌고 있다. 메인 세션은 구현·수정·조사를 직접 하지 않는다. 파일을 직접 고치지 말고 Dispatch 관리자(lead)에게 맡겨라: 브리프를 쓰고, 머지 전에 확인하고, PR에 코멘트하고 머지하는 것만 한다. 다른 흐름의 일(다른 영역·저장소, 또는 지금 관리자의 컨텍스트가 무겁거나 longRun)이면 기존 관리자에 얹지 말고 새 관리자를 만들어라. 리뷰의 작은 should-fix도 담당 관리자에게 돌려보낸다.";

export const REMIND_MS = 30 * 60 * 1000;

// Drops quoted strings (each becomes Q), backslash escapes and heredoc bodies, so a `>` or `rm` inside data is not
// read as shell syntax.
export function shellSkeleton(cmd) {
  const src = cmd.replace(/(<<-?\s*(['"]?)(\w+)\2)([^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g, "$1$4");
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += c === '"' && src[j] === "\\" ? 2 : 1;
      out += "Q";
      i = j;
      continue;
    }
    out += c;
  }
  return out;
}

const WRITE_CMDS = new Set(["rm", "rmdir", "mv", "cp", "mkdir", "touch", "ln", "chmod", "chown", "truncate", "dd", "install", "patch", "rsync", "unlink", "tee", "shred"]);
const WRAPPERS = new Set(["sudo", "env", "command", "nice", "nohup", "time", "xargs", "exec"]);
const GIT_WRITES = new Set(["add", "am", "apply", "checkout", "cherry-pick", "clean", "commit", "merge", "mv", "pull", "rebase", "reset", "restore", "revert", "rm", "switch", "stash"]);
const INTERPRETERS = /^(python[\d.]*|node|deno|bun|ruby|perl)$/;
const CODE_WRITES = /\bopen\s*\([^)]*,\s*(?:mode\s*=\s*)?['"][^'"]*[wax+]|write_text|write_bytes|writeFileSync|writeFile\s*\(|appendFile|createWriteStream|rmSync|unlinkSync|renameSync|copyFileSync|mkdirSync|os\.(?:remove|unlink|rename|replace|makedirs|mkdir)|shutil\.|File\.write/;

// True when a Bash command looks like it changes files. Misses are fine; false alarms on read-only commands are not.
export function looksLikeWrite(cmd) {
  if (typeof cmd !== "string" || !cmd.trim()) return false;
  const sk = shellSkeleton(cmd);
  const redirects = sk
    .replace(/\d*>&\d*-?/g, "")
    .replace(/(?:&|\d)?>>?\s*\/dev\/(?:null|stdout|stderr|tty)\b/g, "");
  if (/>/.test(redirects)) return true;
  for (const seg of sk.split(/\|\|?|&&|;|\n|&|\$\(|[()`]/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    let k = 0;
    while (k < words.length && (/^\w+=/.test(words[k]) || WRAPPERS.has(words[k]) || (k > 0 && WRAPPERS.has(words[k - 1]) && words[k].startsWith("-")))) k++;
    const name = (words[k] ?? "").replace(/^.*\//, "");
    const args = words.slice(k + 1);
    if (WRITE_CMDS.has(name)) return true;
    if (name === "sed" && args.some(a => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) return true;
    if (name === "perl" && args.some(a => /^-[a-zA-Z]*i/.test(a))) return true;
    if (name === "find" && args.includes("-delete")) return true;
    if (name === "find") {
      const e = args.findIndex(a => a === "-exec" || a === "-execdir");
      if (e >= 0 && WRITE_CMDS.has((args[e + 1] ?? "").replace(/^.*\//, ""))) return true;
    }
    if (name === "git") {
      let g = 0;
      while (g < args.length && args[g].startsWith("-")) g += /^-[Cc]$/.test(args[g]) ? 2 : 1;
      const sub = args[g];
      if (sub === "stash" && /^(list|show)$/.test(args[g + 1] ?? "")) continue;
      if (GIT_WRITES.has(sub)) return true;
    }
    if (INTERPRETERS.test(name) && CODE_WRITES.test(cmd)) return true;
  }
  return false;
}

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

export function run(env = process.env, input = {}, registryDir = join(homedir(), ".dispatch", "servers"), markDir = tmpdir(), home = homedir(), now = Date.now()) {
  try { return check(env, input, registryDir, markDir, home, now); } catch { return null; }
}

function check(env, input, registryDir, markDir, home, now) {
  if (env.DISPATCH_SESSION || env.DISPATCH_PARENT || env.DISPATCH_SELF) return null;
  if (!input || typeof input !== "object") return null;
  const sid = typeof input.session_id === "string" ? input.session_id.replace(/[^\w-]/g, "_").slice(0, 80) : "";
  if (!sid) return null;
  const cwd = typeof input.cwd === "string" && isAbsolute(input.cwd) ? input.cwd : null;
  if (input.tool_name === "Bash" && !looksLikeWrite(input.tool_input?.command)) return null;
  const fp = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const target = typeof fp === "string" && fp ? resolve(cwd ?? "/", expandHome(fp, home)) : cwd;
  if (!target || !isAbsolute(target)) return null;
  const mark = join(markDir, `dispatch-main-${sid}`);
  if (existsSync(mark) && now - statSync(mark).mtimeMs < REMIND_MS) return null;
  if (!existsSync(registryDir) || !findServer(target, registryDir, home)) return null;
  writeFileSync(mark, "");
  utimesSync(mark, new Date(now), new Date(now));
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
