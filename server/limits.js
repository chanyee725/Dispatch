import { open, readdir, stat } from "node:fs/promises";
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
