#!/usr/bin/env node
// Claude Code PreToolUse hook shipped with the Atelier plugin (issues #31, #33, #769).
// Inside an Atelier session (DISPATCH_SESSION / DISPATCH_PARENT / DISPATCH_SELF set) it does nothing. In any other
// Claude Code session, before a file edit — or a Bash command that looks like a write — it checks whether an Atelier
// server runs for the project that holds the file: the project is the git top-level of the hook's cwd, its port is in
// <project>/.dispatch/server.port (written by plugin/scripts/start.sh) and must be all digits, the project's
// <project>/.atelier/.drawing/server.lock (or the older atelier/ or pipelines/) must name that port and a live pid (the rule of ours() in start.sh), and
// http://127.0.0.1:<port>/api/info must answer as a project-mode server (loopback only, short timeout).
// Lanes (#768): the main session may do a quickfix (1-3 files) itself. The hook counts the distinct files the session
// writes in that project; once it passes QUICKFIX_FILES it adds a note to the model's context: hand normal and risky
// work to a lead. It repeats the note at most every REMIND_MS (30 min) per session. It never blocks the tool.
// Any failure exits 0 silently. The marker holds no personal data: its name is the sanitized session id, its content
// is JSON with short hashes of the written paths (never the paths) and the time of the last note. Command text is
// never stored.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export const NOTE = "[Atelier 훅] 이 프로젝트에는 Atelier 서버가 돌고 있다. 메인 세션이 직접 하는 일은 1–3개 파일의 빠른 수정(atelier-quickfix)까지다. 이 세션은 3개 파일을 넘게 고치고 있다: 일반·위험 작업이니 atelier-team 으로 관리자(lead)에게 넘겨라. 인증·데이터·삭제·구조를 건드리는 위험 작업은 파일 수와 상관없이 넘긴다. 다른 흐름의 일이면 새 관리자를 만든다.";

// Distinct files the main session may write in one project before the note (quickfix lane). ATELIER_QUICKFIX_FILES
// overrides it (tests use 0).
export const QUICKFIX_FILES = 3;

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

function inside(file, dir) {
  const d = resolve(dir);
  return file === d || file.startsWith(d.endsWith(sep) ? d : d + sep);
}

// Git top-level of `dir` (nearest ancestor holding .git), or null. Reads the file system only; no child process.
export function projectRoot(dir) {
  let d = resolve(dir);
  for (;;) {
    if (existsSync(join(d, ".git"))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

// The project's workspace folder (#782) and the older ones a server started before #782 or #773 may still run on.
const WORKSPACES = [".atelier", "atelier", "pipelines"];

// The port in <root>/.atelier/server.port (or an older .dispatch/ not moved yet, #782) when it is plain digits in 1..65535, else null.
export function readPort(root) {
  let raw = null;
  for (const dir of [".atelier", ".dispatch"]) {
    try { raw = readFileSync(join(root, dir, "server.port"), "utf8").trim(); break; } catch { /* next */ }
  }
  if (raw === null) return null;
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : null;
}

// True when <root>/.atelier/.drawing/server.lock (or the older atelier/ or pipelines/) names `port` and a live pid (EPERM means alive, owned by another user).
export function lockLive(root, port) {
  return WORKSPACES.some((ws) => {
    try {
      const lock = JSON.parse(readFileSync(join(root, ws, ".drawing", "server.lock"), "utf8"));
      if (!lock || String(lock.port) !== String(port) || !Number.isInteger(lock.pid) || lock.pid <= 0) return false;
      try { process.kill(lock.pid, 0); } catch (e) { if (e?.code !== "EPERM") return false; }
      return true;
    } catch { return false; }
  });
}

// True when a project-mode Atelier server on the ".atelier" (or older "atelier", "pipelines") workspace answers /api/info on 127.0.0.1:<port>.
export function probe(port, timeout = 1500) {
  return new Promise(done => {
    const req = get({ host: "127.0.0.1", port, path: "/api/info", timeout }, res => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", c => { if (b.length < 4096) b += c; });
      res.on("end", () => { try { done(res.statusCode === 200 && (i => i?.mode === "project" && WORKSPACES.includes(i.workspace))(JSON.parse(b))); } catch { done(false); } });
      res.on("error", () => done(false));
    });
    req.on("error", () => done(false));
    req.on("timeout", () => { req.destroy(); done(false); });
  });
}

// Returns { root, port } of the live Drawing server of the project that holds `target`, or null.
export async function findServer(target, cwd) {
  const root = projectRoot(cwd ?? target);
  if (!root || !inside(target, root)) return null;
  const port = readPort(root);
  if (port === null || !lockLive(root, port) || !(await probe(port))) return null;
  return { root, port };
}

export async function run(env = process.env, input = {}, markDir = tmpdir(), home = homedir(), now = Date.now()) {
  try { return await check(env, input, markDir, home, now); } catch { return null; }
}

async function check(env, input, markDir, home, now) {
  if (env.DISPATCH_SESSION || env.DISPATCH_PARENT || env.DISPATCH_SELF) return null;
  if (!input || typeof input !== "object") return null;
  const sid = typeof input.session_id === "string" ? input.session_id.replace(/[^\w-]/g, "_").slice(0, 80) : "";
  if (!sid) return null;
  const cwd = typeof input.cwd === "string" && isAbsolute(input.cwd) ? input.cwd : null;
  const bash = input.tool_name === "Bash";
  if (bash && !looksLikeWrite(input.tool_input?.command)) return null;
  const fp = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const target = typeof fp === "string" && fp ? resolve(cwd ?? "/", expandHome(fp, home)) : cwd;
  if (!target || !isAbsolute(target)) return null;
  const mark = join(markDir, `atelier-main-${sid}`);
  const state = readMark(mark);
  if (now - state.noteAt < REMIND_MS) return null;
  if (!cwd || !(await findServer(target, cwd))) return null;
  // A Bash write has no known file: all of them share one slot.
  const key = createHash("sha256").update(bash ? "bash:" : target).digest("hex").slice(0, 12);
  if (!state.files.includes(key)) state.files.push(key);
  const raw = env.ATELIER_QUICKFIX_FILES;
  const limit = typeof raw === "string" && /^[0-9]+$/.test(raw) ? Number(raw) : QUICKFIX_FILES;
  const over = state.files.length > limit;
  if (over) state.noteAt = now;
  writeFileSync(mark, JSON.stringify({ files: state.files.slice(-50), noteAt: state.noteAt }));
  return over ? { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: NOTE } } : null;
}

// { files: string[], noteAt: number } from the marker; an unreadable or old (empty) marker counts as fresh.
function readMark(mark) {
  try {
    const m = JSON.parse(readFileSync(mark, "utf8"));
    const files = Array.isArray(m?.files) ? m.files.filter(f => typeof f === "string" && /^[0-9a-f]{12}$/.test(f)) : [];
    return { files, noteAt: Number.isFinite(m?.noteAt) ? m.noteAt : 0 };
  } catch { return { files: [], noteAt: 0 }; }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("main-delegates.mjs")) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", c => { raw += c; });
  process.stdin.on("end", async () => {
    try {
      const out = await run(process.env, JSON.parse(raw));
      if (out) process.stdout.write(JSON.stringify(out));
    } catch { /* fail silently */ }
    process.exit(0);
  });
  process.stdin.on("error", () => process.exit(0));
}
