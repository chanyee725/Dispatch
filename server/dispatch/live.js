// Live "what is this agent doing now" view (issue #728, design docs/design/agent-live-view.md §4). Built from tool
// entries as they pass through Hub.push() and from the cursor module's document writes, in memory only: nothing
// here is written to disk. It keeps metadata only (a short label, a path or a command's first line, times, an ok
// flag), never assistant text, tool input bodies or tool output (CLAUDE.md privacy rules).
//
// Shape: shared/dispatch/live.ts (AgentLive). Changes go out as one coalesced SSE `live` event per session at
// most every 250 ms: `{ sid, current?, actions?, files? }`, where `actions` and `files` hold only the items added
// or changed since the last event (upsert by `id` and `path`). GET /api/sessions/:id/live gives the full state.

import os from "node:os";
import path from "node:path";
import { activityOf } from "./hub.js";
import { redact } from "./redact.js";

export const LIVE_RECENT = 12;
export const LIVE_FILES = 30;
export const LIVE_FLUSH_MS = 250;
const TARGET_MAX = 80;
const DOC_EXT = ".dpx.json";

// Gemini (agy) tool names mapped to the Claude names activityOf() knows.
const GEMINI = {
  read_file: "Read", read_many_files: "Read", list_directory: "Glob", glob: "Glob", search_file_content: "Grep",
  write_file: "Write", replace: "Edit", run_shell_command: "Bash",
};
const READS = new Set(["Read"]);
const SEARCHES = new Set(["Grep", "Glob"]);
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "edit"]);
const SHELLS = new Set(["Bash", "shell"]);
const PATH_KEYS = ["file_path", "notebook_path", "absolute_path", "path"];

const isSecretFile = p => /(^|\/)\.env(\.[^/]*)?$/.test(p);
const clipTarget = s => (s.length > TARGET_MAX ? s.slice(0, TARGET_MAX - 1) + "…" : s);

function parse(text) {
  try { const o = JSON.parse(text); return o && typeof o === "object" ? o : null; } catch { return null; }
}

/** A string field from a (possibly clipped, so unparsable) JSON tool input. */
function field(text, obj, keys) {
  for (const k of keys) {
    if (obj && typeof obj[k] === "string") return obj[k];
    const m = new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
    if (m) { try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; } }
  }
  return null;
}

/**
 * A path as the view may show it, `{ path, doc }` or null: a Drawing document inside the workspace is
 * workspace-relative (it opens in the app), anything else inside the session's folder is relative to it, and a
 * path outside both keeps only its basename (marked `outside`, so the view never links it), so home folders and user
 * names never reach the UI. `.env` files are dropped.
 */
export function shownPath(p, { cwd = null, workspaceDir = null } = {}) {
  if (!p || typeof p !== "string") return null;
  p = p.trim().split("\n")[0];
  if (!p || isSecretFile(p)) return null;
  const abs = path.isAbsolute(p) ? path.normalize(p) : cwd ? path.resolve(cwd, p) : null;
  const inside = (dir) => {
    if (!dir || !abs) return null;
    const rel = path.relative(dir, abs);
    return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : null;
  };
  const ws = inside(workspaceDir);
  if (ws && ws.endsWith(DOC_EXT)) return { path: ws, doc: true };
  const rel = inside(cwd) ?? (abs ? null : path.normalize(p).replace(/^(\.\/)+/, ""));
  if (rel) return { path: rel, doc: false };
  const base = path.basename(p);
  return base ? { path: base, doc: false, outside: true } : null;
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HOME = os.homedir();

/**
 * Paths in a command line without home folders or user names: the session's folder (and the workspace) become
 * relative (`.` for the folder itself), the home folder and any `/home/<user>`, `/Users/<user>` or `/root` become `~`.
 */
export function unhome(line, { cwd = null, workspaceDir = null } = {}) {
  const dirs = [cwd, workspaceDir].filter(d => typeof d === "string" && d.length > 1).sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    line = line.replace(new RegExp(`${escRe(dir.replace(/\/+$/, ""))}(?:/|(?=[\\s'"\`;)|&]|$))`, "g"), m => (m.endsWith("/") ? "" : "."));
  }
  if (HOME && HOME.length > 1) line = line.replace(new RegExp(`${escRe(HOME)}(?=/|[\\s'"\`;)|&]|$)`, "g"), "~");
  return line.replace(/\/(?:home|Users)\/[^/\s'"`;)|&]+/g, "~").replace(/(^|[\s'"`=(])\/root(?=\/|[\s'"`;)|&]|$)/g, "$1~");
}

/** A command's first line, leading `VAR=value` assignments dropped, home paths shortened (unhome), masked and clipped to 80 characters. */
export function commandTarget(cmd, where = {}) {
  const line = String(cmd || "").trim().split("\n")[0].replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
  return clipTarget(redact(unhome(line, where)));
}

function kindOf(tool, label) {
  if (SHELLS.has(tool)) {
    if (label === "단위 테스트" || label === "e2e 실행") return "test";
    if (label === "빌드" || label === "타입 검사" || label === "lint") return "build";
    if (label === "코드 읽기") return "read";
    return "command";
  }
  if (READS.has(tool)) return "read";
  if (SEARCHES.has(tool) || /^Web(Fetch|Search)$/.test(tool)) return "search";
  if (EDITS.has(tool)) return "edit";
  if (/^mcp__.*playwright|^browser_/.test(tool)) return "browser";
  if (/^mcp__dispatch__/.test(tool) || /^dispatch\./.test(tool)) return "team";
  return "other";
}

const SHELL_READERS = new Set(["cat", "head", "tail", "nl", "less", "more", "bat", "sed"]);
/** Options that take a value as the next word, per reader. */
const VALUE_OPTS = { head: new Set(["-n", "-c"]), tail: new Set(["-n", "-c"]), sed: new Set(["-e", "-f"]) };
const SHELL_READ_MAX = 5;

/**
 * The files a plain shell read names (`cat a b`, `sed -n 1,20p a`, `head -n 5 a`, after optional `cd dir &&`), as
 * `{ path, doc, edited: false }` through shownPath; [] for anything with globs, variables or substitutions.
 */
export function shellReadFiles(cmd, where = {}) {
  const out = [];
  let base = where.cwd ?? null;
  for (const seg of String(cmd || "").split("\n")[0].split(/\s*(?:&&|;)\s*/)) {
    const words = seg.split("|")[0].match(/'[^']*'|"[^"]*"|\S+/g) || [];
    const [head, ...rest] = words.map(w => w.replace(/^(['"])(.*)\1$/, "$2"));
    if (head === "cd" && rest.length === 1 && base) { base = path.resolve(base, rest[0].replace(/^~(?=\/|$)/, os.homedir())); continue; }
    // `sed -i` writes; it is not a read.
    if (!SHELL_READERS.has(head) || (head === "sed" && rest.some(w => /^-[^-]*i|^--in-place/.test(w)))) continue;
    let script = head === "sed" && !rest.includes("-e");
    for (let i = 0; i < rest.length; i++) {
      const w = rest[i];
      if (VALUE_OPTS[head]?.has(w)) { i++; continue; }
      if (/^\d*[<>]/.test(w)) break;
      if (w.startsWith("-")) continue;
      if (/[*?$`(){}<>]/.test(w) || /^\d+$/.test(w)) continue;
      if (script) { script = false; continue; }
      const abs = path.isAbsolute(w) ? w : base ? path.resolve(base, w) : w;
      const f = shownPath(abs, where);
      if (f && !out.some(o => o.path === f.path)) out.push({ ...f, edited: false });
      if (out.length >= SHELL_READ_MAX) return out;
    }
  }
  return out;
}

/**
 * What one tool entry does: `{ kind, label, tool, target, files }`. `text` is the entry's already masked and
 * clipped text (JSON input, or a Codex shell command / edit list).
 */
export function liveOf(name = "", text = "", where = {}) {
  const tool = GEMINI[name] || name;
  const short = String(name).replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");
  if (SHELLS.has(tool)) {
    const cmd = name === "shell" ? text : field(text, parse(text), ["command"]) || "";
    let label = activityOf(tool, cmd);
    let kind = kindOf(tool, label);
    // A shell read (`cat a`, `cd dir && sed -n 1,9p a`) counts as reading its files; the first one is the target, like Read's.
    const files = kind === "read" || kind === "command" ? shellReadFiles(cmd, where) : [];
    if (files.length && kind === "command") [kind, label] = ["read", "코드 읽기"];
    return { kind, label, tool: short, target: files.length ? clipTarget(files[0].path) : commandTarget(cmd, where), files };
  }
  if (name === "edit") {
    // Codex file_change: one "kind path" per line; the first file is the target.
    const files = String(text).split("\n").map(l => shownPath(l.replace(/^\S+\s+/, ""), where)).filter(Boolean)
      .map(f => ({ ...f, edited: true }));
    return { kind: "edit", label: activityOf(name), tool: short, target: clipTarget(files[0]?.path ?? ""), files };
  }
  if (READS.has(tool) || SEARCHES.has(tool) || EDITS.has(tool)) {
    const obj = parse(text);
    const f = shownPath(field(text, obj, PATH_KEYS), where);
    const label = activityOf(tool);
    // A search's target is its pattern when it has no path; a search does not count as touching a file.
    const target = f?.path ?? (SEARCHES.has(tool) ? redact(field(text, obj, ["pattern"]) || "") : "");
    const files = f && !SEARCHES.has(tool) ? [{ ...f, edited: EDITS.has(tool) }] : [];
    return { kind: kindOf(tool, label), label, tool: short, target: clipTarget(target), files };
  }
  return { kind: kindOf(name, ""), label: activityOf(name), tool: short, target: "", files: [] };
}

export class LiveTracker {
  /** `known(id)`: whether the id is a hub session; others (outside writers, removed sessions) get no state. */
  constructor({ emit, workspaceDir = null, flushMs = LIVE_FLUSH_MS, now = () => Date.now(), known = () => true } = {}) {
    this.emitFn = emit || (() => {});
    this.known = known;
    this.workspaceDir = workspaceDir;
    this.flushMs = flushMs;
    this.now = now;
    this.byId = new Map(); // sid -> { current, recent (oldest first), files (Map, oldest first), calls, dirty, timer, lastSent }
  }

  state(id) {
    let st = this.byId.get(id);
    if (!st) this.byId.set(id, st = { current: null, recent: [], files: new Map(), calls: new Map(),
      dirty: { current: false, actions: new Set(), files: new Set() }, timer: null, lastSent: -Infinity });
    return st;
  }

  /** Takes one transcript entry (after masking). Only tool calls and tool results count. */
  note(s, entry) {
    if (!this.known(s.id)) return;
    if (entry.kind === "tool") {
      const st = this.state(s.id);
      const at = entry.at ?? this.now();
      const info = liveOf(entry.name, entry.text, { cwd: s.cwd, workspaceDir: this.workspaceDir });
      const action = { id: entry.id, at, kind: info.kind, label: info.label, tool: info.tool, target: info.target };
      // Codex reports a finished call (final) in one entry.
      if (entry.final) Object.assign(action, { ok: !entry.error, endedAt: at });
      st.recent.push(action);
      if (st.recent.length > LIVE_RECENT) {
        for (const old of st.recent.splice(0, st.recent.length - LIVE_RECENT)) st.dirty.actions.delete(old.id);
      }
      st.dirty.actions.add(action.id);
      if (entry.callId && !entry.final) {
        st.calls.set(entry.callId, action);
        if (st.calls.size > LIVE_RECENT) st.calls.delete(st.calls.keys().next().value);
      }
      this.setCurrent(st, entry.final ? null : action);
      for (const f of info.files) this.addFile(st, f, at);
      this.schedule(s.id, st);
    } else if (entry.kind === "tool_result") {
      const st = this.byId.get(s.id);
      if (!st) return;
      // Claude pairs results by call id; Gemini's results come in order, so they finish the running action.
      const action = entry.callId ? st.calls.get(entry.callId) : st.current;
      if (!action || action.endedAt) return;
      if (entry.callId) st.calls.delete(entry.callId);
      Object.assign(action, { ok: !entry.error, endedAt: entry.at ?? this.now() });
      if (st.recent.includes(action)) st.dirty.actions.add(action.id);
      if (st.current === action) this.setCurrent(st, null);
      this.schedule(s.id, st);
    }
  }

  /** A document write credited to the session by the cursor module (workspace-relative path). */
  noteDoc(sid, file, at = this.now()) {
    if (!sid || typeof file !== "string" || !file || isSecretFile(file) || !this.known(sid)) return;
    const st = this.state(sid);
    this.addFile(st, { path: file, doc: file.endsWith(DOC_EXT), edited: true }, at);
    this.schedule(sid, st);
  }

  setCurrent(st, action) {
    if (st.current === action) return;
    st.current = action;
    st.dirty.current = true;
  }

  addFile(st, f, at) {
    const prev = st.files.get(f.path);
    // An edit stays an edit: a later read of the same file does not hide that it was changed.
    const file = { path: f.path, edited: !!(prev?.edited || f.edited), at, doc: !!(prev?.doc || f.doc) };
    // A basename that was ever outside the session's folder stays unlinked.
    if (prev?.outside || f.outside) file.outside = true;
    st.files.delete(f.path);
    st.files.set(f.path, file);
    st.dirty.files.add(f.path);
    if (st.files.size > LIVE_FILES) {
      // Drop the oldest read-only file first; edits are what the person cares about.
      const victim = [...st.files.values()].find(x => !x.edited) || st.files.values().next().value;
      st.files.delete(victim.path);
      st.dirty.files.delete(victim.path);
    }
  }

  /** The turn ended: nothing is running any more. */
  idle(id) {
    const st = this.byId.get(id);
    if (!st || !st.current) return;
    this.setCurrent(st, null);
    this.schedule(id, st);
  }

  drop(id) {
    const st = this.byId.get(id);
    if (st?.timer) clearTimeout(st.timer);
    this.byId.delete(id);
  }

  schedule(id, st) {
    if (st.timer) return;
    const wait = this.flushMs - (this.now() - st.lastSent);
    if (wait <= 0) return this.flush(id);
    st.timer = setTimeout(() => { st.timer = null; this.flush(id); }, wait);
    st.timer.unref?.();
  }

  flush(id) {
    const st = this.byId.get(id);
    if (!st) return;
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    const d = st.dirty;
    if (!d.current && !d.actions.size && !d.files.size) return;
    const ev = { sid: id };
    if (d.current) ev.current = st.current && { ...st.current };
    if (d.actions.size) ev.actions = st.recent.filter(a => d.actions.has(a.id)).reverse().map(a => ({ ...a }));
    // st.files is in touch order (a re-touched file moves to the end), so newest first comes from it, not from the Set.
    if (d.files.size) ev.files = [...st.files.values()].filter(f => d.files.has(f.path)).reverse().map(f => ({ ...f }));
    st.dirty = { current: false, actions: new Set(), files: new Set() };
    st.lastSent = this.now();
    this.emitFn(ev);
  }

  /** Full state for one session (AgentLive): recent actions and files newest first. */
  snapshot(id) {
    const st = this.byId.get(id);
    if (!st) return { sid: id, current: null, recent: [], files: [] };
    return { sid: id, current: st.current && { ...st.current }, recent: [...st.recent].reverse().map(a => ({ ...a })),
      files: [...st.files.values()].reverse().map(f => ({ ...f })) };
  }
}
