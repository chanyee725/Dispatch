import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Usage limits per provider, read from what each CLI already records locally. Only the limit
// numbers are parsed; nothing else from those files is kept or sent anywhere.

const CODEX_SESSIONS = path.join(os.homedir(), ".codex", "sessions");

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

let codexCache = { at: 0, value: null };
/** Latest Codex rate limits (primary/secondary windows) from its newest session log. */
export async function codexLimits() {
  if (Date.now() - codexCache.at < 60_000) return codexCache.value;
  let value = null;
  try {
    const f = await newestRollout(CODEX_SESSIONS);
    if (f) {
      const text = await tail(f.path);
      const i = text.lastIndexOf('"rate_limits":');
      if (i >= 0) {
        // Parse the object that follows: count braces from the first "{".
        const start = text.indexOf("{", i);
        let depth = 0, end = start;
        for (; end < text.length; end++) { if (text[end] === "{") depth++; else if (text[end] === "}" && --depth === 0) break; }
        const rl = JSON.parse(text.slice(start, end + 1));
        const win = w => (w ? { label: windowLabel(w.window_minutes ?? 0), used: (w.used_percent ?? 0) / 100, reset: w.resets_at ? w.resets_at * 1000 : null } : null);
        value = { windows: [win(rl.primary), win(rl.secondary)].filter(Boolean), plan: rl.plan_type ?? null, updatedAt: f.mtime };
      }
    }
  } catch { value = null; }
  codexCache = { at: Date.now(), value };
  return value;
}

/** "Resets in 3h20m" / "Resets in 45m" from a Gemini quota error, as an epoch ms. */
export function geminiResetFrom(text) {
  const m = /resets? in\s+(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i.exec(text || "");
  if (!m || (!m[1] && !m[2])) return null;
  return Date.now() + ((+m[1] || 0) * 60 + (+m[2] || 0)) * 60_000;
}
export const isQuotaError = text => /RESOURCE_EXHAUSTED|quota reached|code 429/i.test(text || "");

/* ---------------- Shared Claude / Gemini limits ---------------- */
// Claude windows and the Gemini quota are account-wide, so every Dispatch server on this machine
// reads and writes one file, ~/.dispatch/limits.json, next to prefs.json and servers/. Only
// numbers and reset times go in it — no account, email or token.

export const LIMITS_FILE = path.join(os.homedir(), ".dispatch", "limits.json");
const EMPTY_CLAUDE = () => ({ five: null, seven: null, fiveReset: null, sevenReset: null, updatedAt: null });
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Keeps the known number fields only; anything else in the input is dropped. */
export function cleanClaude(l) {
  const c = EMPTY_CLAUDE();
  if (l && typeof l === "object") for (const k of Object.keys(c)) c[k] = num(l[k]);
  return c;
}
export function cleanGemini(g) {
  if (!g || typeof g !== "object" || num(g.at) == null) return null;
  return { reached: g.reached === true, reset: num(g.reset), at: g.at };
}
const newer = (a, b) => (a ?? -Infinity) > (b ?? -Infinity);

/** Per section, the side with the newer timestamp wins. */
export function mergeLimits(a, b) {
  const ca = cleanClaude(a?.claude), cb = cleanClaude(b?.claude);
  const ga = cleanGemini(a?.gemini), gb = cleanGemini(b?.gemini);
  return { claude: newer(cb.updatedAt, ca.updatedAt) ? cb : ca, gemini: newer(gb?.at, ga?.at) ? gb : ga };
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
   * Holds ~/.dispatch/limits.json.lock (O_EXCL create) around read → merge → rename, so two servers
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

  setClaude(l) { return this.write({ claude: { ...l, updatedAt: l.updatedAt ?? Date.now() } }); }
  setGemini(g) { return this.write({ gemini: { ...g, at: g.at ?? Date.now() } }); }
}
