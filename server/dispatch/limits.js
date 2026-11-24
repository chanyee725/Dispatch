import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { userDir } from "./paths.js";

// Usage limits per provider (ported from standalone Dispatch, issue #587). Claude reports its windows
// in the stream; Codex's are read from what the codex CLI already records locally (only the limit
// numbers are parsed, nothing else from those files is kept or sent anywhere); Gemini's come from
// agy's /usage command (geminiUsage, numbers only), and its "quota reached" error sets a flag with its reset time.

export const CODEX_SESSIONS = path.join(os.homedir(), ".codex", "sessions");

async function newestRollout(dir, depth = 0) {
  let best = null;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 4) {
      const f = await newestRollout(p, depth + 1);
      if (f && (!best || f.mtime > best.mtime)) best = f;
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      const m = (await stat(p).catch(() => null))?.mtimeMs ?? 0;
      if (!best || m > best.mtime) best = { path: p, mtime: m };
    }
  }
  return best;
}

async function tail(file, bytes = 256 * 1024) {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally { await fh.close(); }
}

const windowLabel = min => (min >= 40000 ? "월간" : min >= 10000 ? "주간" : min >= 1440 ? `${Math.round(min / 1440)}일` : `${Math.round(min / 60)}시간`);

const codexCache = new Map(); // dir -> { at, value }
/** Latest Codex rate limits (primary/secondary windows) from its newest session log; cached for a minute. */
export async function codexLimits(dir = CODEX_SESSIONS, now = Date.now()) {
  const hit = codexCache.get(dir);
  if (hit && now - hit.at < 60_000) return hit.value;
  let value = null;
  try {
    const f = await newestRollout(dir);
    if (f) {
      const text = await tail(f.path);
      const i = text.lastIndexOf('"rate_limits":');
      if (i >= 0) {
        // Parse the object that follows: count braces from the first "{".
        const start = text.indexOf("{", i);
        let depth = 0, end = start;
        for (; end < text.length; end++) { if (text[end] === "{") depth++; else if (text[end] === "}" && --depth === 0) break; }
        const rl = JSON.parse(text.slice(start, end + 1));
        const num01 = v => (typeof v === "number" && Number.isFinite(v) ? v / 100 : 0);
        // slot: which Codex guard threshold applies (primary = the short window, secondary = the weekly one).
        const win = (w, slot) => (w ? { slot, label: windowLabel(w.window_minutes ?? 0), used: num01(w.used_percent), reset: typeof w.resets_at === "number" ? w.resets_at * 1000 : null } : null);
        value = { windows: [win(rl.primary, "five"), win(rl.secondary, "seven")].filter(Boolean), plan: typeof rl.plan_type === "string" ? rl.plan_type : null, updatedAt: f.mtime };
      }
    }
  } catch { value = null; }
  codexCache.set(dir, { at: now, value });
  return value;
}

/* ---------------- Gemini usage windows (#878) ---------------- */
// `agy -p /usage --output-format json` answers the /usage slash command without a model turn (0 tokens):
// { command: { name: "usage", data: { groups: [{ name, buckets: [{ id, window, remaining_fraction, reset_time }] }] } } }.
// Only the "Gemini Models" group is kept (Atelier runs Gemini models through agy); only the numbers are read.

const GEMINI_WINDOW_LABELS = { weekly: "주간", daily: "일간", "5h": "5시간", five_hour: "5시간", monthly: "월간" };

/** Usage windows ({ label, used 0..1, reset epoch ms }) from agy's /usage JSON; [] when the shape is not there. */
export function geminiUsageWindows(out) {
  let data;
  try { data = typeof out === "string" ? JSON.parse(out) : out; } catch { return []; }
  const groups = data?.command?.name === "usage" ? data.command.data?.groups : null;
  if (!Array.isArray(groups)) return [];
  const windows = [];
  for (const g of groups) {
    if (!/gemini/i.test(String(g?.name ?? ""))) continue;
    for (const b of Array.isArray(g.buckets) ? g.buckets : []) {
      const left = b?.remaining_fraction;
      if (typeof left !== "number" || !Number.isFinite(left)) continue;
      const reset = typeof b.reset_time === "string" ? Date.parse(b.reset_time) : NaN;
      windows.push({
        label: GEMINI_WINDOW_LABELS[b.window] ?? (typeof b.window === "string" && b.window.length <= 12 ? b.window : "한도"),
        used: Math.min(1, Math.max(0, 1 - left)),
        reset: Number.isFinite(reset) ? reset : null,
      });
    }
  }
  return windows;
}

export const GEMINI_USAGE_MS = 5 * 60_000;
let geminiCache = null; // { at, value } — value null when agy gave no windows
let geminiPending = null;
/** Forgets the cached /usage answer (tests). */
export const resetGeminiUsageCache = () => { geminiCache = null; geminiPending = null; };

/**
 * Gemini's usage windows via `run` (runCli from cli.js: agy -p /usage), cached for five minutes so the 30 s
 * poll of GET /api/limits starts at most one agy every five minutes. Null when agy failed or gave no windows.
 */
export async function geminiUsage(run, now = Date.now()) {
  if (geminiCache && now - geminiCache.at < GEMINI_USAGE_MS) return geminiCache.value;
  geminiPending ??= (async () => {
    let value = null;
    try {
      const { stdout } = await run("agy", ["-p", "/usage", "--output-format", "json", "--print-timeout", "20s", "--mode", "plan"], { cwd: os.tmpdir(), timeout: 30_000, maxBuffer: 1024 * 1024 });
      const windows = geminiUsageWindows(stdout);
      value = windows.length ? { windows } : null;
    } catch { value = null; }
    geminiCache = { at: now, value };
    geminiPending = null;
    return value;
  })();
  return geminiPending;
}

/** "Resets in 3h20m" / "Resets in 45m" from a Gemini quota error, as an epoch ms. */
export function geminiResetFrom(text, now = Date.now()) {
  const m = /resets? in\s+(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i.exec(text || "");
  if (!m || (!m[1] && !m[2])) return null;
  return now + ((+m[1] || 0) * 60 + (+m[2] || 0)) * 60_000;
}
export const isQuotaError = text => /RESOURCE_EXHAUSTED|quota reached|code 429/i.test(text || "");

/* ---------------- Shared Claude / Gemini limits ---------------- */
// Claude windows and the Gemini quota are account-wide, so every Dispatch server on this machine
// reads and writes one file, ~/.atelier/limits.json (paths.js), next to drawing.json. Only numbers
// and reset times go in it — no account, email or token. Keys this server does not know are kept
// untouched on write.

export const LIMITS_FILE = path.join(userDir({}), "limits.json");
// fable: the weekly window the CLI reports as seven_day_overage_included (models with their own weekly
// bucket, Fable today). Only Fable turns carry it, so it keeps its last value between them.
const EMPTY_CLAUDE = () => ({ five: null, seven: null, fable: null, fiveReset: null, sevenReset: null, fableReset: null, updatedAt: null });
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Keeps the known number fields only; anything else in the input is dropped. */
export function cleanClaude(l) {
  const c = EMPTY_CLAUDE();
  if (l && typeof l === "object") for (const k of Object.keys(c)) c[k] = num(l[k]);
  return c;
}
const newer = (a, b) => (a ?? -Infinity) > (b ?? -Infinity);

/** Gemini: reached or not, when it resets, and when that was seen (`at`); null when never seen. */
export function cleanGemini(g) {
  if (!g || typeof g !== "object" || num(g.at) == null) return null;
  return { reached: g.reached === true, reset: num(g.reset), at: g.at };
}

/** Keys this server does not know: kept as they are. */
const KNOWN = ["claude", "gemini"];
const extras = x => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([k]) => !KNOWN.includes(k))) : {});

/** Per section, the side with the newer timestamp wins; unknown keys are kept (b over a). */
export function mergeLimits(a, b) {
  const ca = cleanClaude(a?.claude), cb = cleanClaude(b?.claude);
  const ga = cleanGemini(a?.gemini), gb = cleanGemini(b?.gemini);
  return { ...extras(a), ...extras(b), claude: newer(cb.updatedAt, ca.updatedAt) ? cb : ca, gemini: newer(gb?.at, ga?.at) ? gb : ga };
}

/**
 * The shared limits file. Writes merge with what is on disk (newest wins) and replace it with a
 * temp file + rename, so concurrent servers never see a half-written file. refresh() (polled by the
 * server) picks up another server's change and emits "change".
 */
export class SharedLimits extends EventEmitter {
  static WAIT_MS = 2000;
  static STALE_MS = 10_000;
  constructor(file = LIMITS_FILE) {
    super();
    this.file = file;
    this.data = { claude: EMPTY_CLAUDE(), gemini: null };
  }

  get claude() { return this.data.claude; }
  get gemini() { return this.data.gemini; }

  async read() {
    try {
      return { data: mergeLimits(JSON.parse(await readFile(this.file, "utf8")), null) };
    } catch (e) {
      return { data: null, missing: e.code === "ENOENT" };
    }
  }

  /**
   * Loads the file. `seed` is an older per-project copy: it is merged in once (newest wins), so the
   * first servers to start after the move fill the shared file with the newest value any had.
   */
  async load(seed = null) {
    const { data } = await this.read();
    this.data = mergeLimits(this.data, data);
    const merged = mergeLimits(this.data, seed);
    if (JSON.stringify(merged) !== JSON.stringify(this.data)) await this.write(seed);
    return this.data;
  }

  /** Re-reads the file if it changed on disk; emits "change" when another server wrote newer values. */
  async refresh() {
    const { data } = await this.read();
    if (!data) return false; // missing or damaged: keep what we have
    const next = mergeLimits(this.data, data);
    const changed = JSON.stringify(next) !== JSON.stringify(this.data);
    this.data = next;
    if (changed) this.emit("change", this.data);
    // Ours is newer than the disk (a write that lost a race): put it back so other servers see it.
    if (JSON.stringify(next) !== JSON.stringify(data)) await this.write({});
    return changed;
  }

  /**
   * Holds ~/.atelier/limits.json.lock (O_EXCL create) around read → merge → rename, so two servers
   * writing at once cannot replace a newer value with an older one. A lock older than STALE_MS is
   * left over from a crashed server and is taken over; if the lock cannot be had within WAIT_MS the
   * write goes ahead anyway and refresh() repairs the file on its next tick.
   */
  async lock() {
    const lock = this.file + ".lock";
    const until = Date.now() + SharedLimits.WAIT_MS;
    await mkdir(path.dirname(this.file), { recursive: true });
    for (;;) {
      try {
        await (await open(lock, "wx")).close();
        return () => rm(lock, { force: true });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        const st = await stat(lock).catch(() => null);
        if (st && Date.now() - st.mtimeMs > SharedLimits.STALE_MS) { await rm(lock, { force: true }); continue; }
        if (Date.now() > until) return async () => {};
        await new Promise(r => setTimeout(r, 5 + Math.random() * 10));
      }
    }
  }

  /** Records new values (each section only if newer) and writes the merged result. */
  async write(patch) {
    this.data = mergeLimits(this.data, patch);
    const unlock = await this.lock();
    try {
      const { data } = await this.read();
      this.data = mergeLimits(this.data, data);
      const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(this.data, null, 2));
        await rename(tmp, this.file);
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
    } finally {
      await unlock();
    }
    return this.data;
  }

  // A stamp strictly after the one we hold: two updates within the same millisecond must not tie,
  // or mergeLimits (newer wins) would drop the second one.
  stamp(prev) { return Math.max(Date.now(), (prev ?? 0) + 1); }
  setClaude(l) { return this.write({ claude: { ...l, updatedAt: l.updatedAt ?? this.stamp(this.data.claude?.updatedAt) } }); }
  setGemini(g) { return this.write({ gemini: { ...g, at: g.at ?? this.stamp(this.data.gemini?.at) } }); }
}
