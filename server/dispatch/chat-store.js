// Saved chat history for the bottom-right chat (#968): one file per conversation in
// <project>/.atelier/chat/<YYYY-MM-DD>-<id>.json, kept out of git (git.js ensureExcluded).
// The record is rebuilt field by field from what the caller sends and every free-text field goes
// through chatRedact on the way to disk: there is no other write path. Images are never stored,
// only an [이미지] placeholder; tool calls keep a short summary, not their input or output.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chatRedact, IMAGE } from "./chat-redact.js";
import { CHAT_DIR, ensureExcluded } from "./git.js";
import { STATE_DIR, stateLayout } from "./paths.js";

const ID = /^[a-z0-9]{8,32}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FILE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]{8,32})\.json$/;
export const LIMITS = { title: 80, text: 20_000, tools: 50, tool: 200, messages: 1000 };

const fail = (status, message) => Object.assign(new Error(message), { status });
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
/** Masks first, then clips: a cut-off token would no longer look like one. */
const clean = (s, n) => clip(chatRedact(String(s ?? "")).trim(), n);
const day = ms => new Date(ms).toISOString().slice(0, 10);

/** One tool block as { name, summary }: a summary the caller gave, else the input's main field. */
function toolOf(b) {
  const input = b.input && typeof b.input === "object" ? b.input : {};
  const main = b.summary ?? input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.description ?? "";
  return { name: clean(b.name || b.tool || "tool", 60), summary: clean(typeof main === "string" ? main : "", LIMITS.tool) };
}

/** A message as { role, text, tools? }. Accepts { role, text, blocks?, tools?, images? }; blocks are Claude content blocks. */
function messageOf(m) {
  if (!m || typeof m !== "object") return null;
  const role = m.role === "assistant" ? "assistant" : "user";
  const parts = [];
  const tools = [];
  if (typeof m.text === "string") parts.push(m.text);
  for (const b of Array.isArray(m.blocks) ? m.blocks : []) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "image") parts.push(IMAGE);
    else if (b.type === "tool_use" || b.type === "tool") tools.push(toolOf(b));
  }
  for (const t of Array.isArray(m.tools) ? m.tools : []) if (t && typeof t === "object") tools.push(toolOf(t));
  const images = Array.isArray(m.images) ? m.images.length : Number.isInteger(m.images) ? m.images : 0;
  for (let i = 0; i < Math.min(images, 20); i++) parts.push(IMAGE);
  const text = clean(parts.join("\n"), LIMITS.text);
  if (!text && !tools.length) return null;
  return { role, text, ...(tools.length && { tools: tools.slice(0, LIMITS.tools) }) };
}

/** The only way a record is built for disk: whitelisted fields, masked text. */
export function sanitize(input, { id, createdAt, now }) {
  const messages = (Array.isArray(input?.messages) ? input.messages : []).slice(-LIMITS.messages).map(messageOf).filter(Boolean);
  const first = messages.find(m => m.role === "user")?.text || "";
  const title = clean(typeof input?.title === "string" && input.title.trim() ? input.title : first.split("\n")[0], LIMITS.title) || "새 대화";
  const sessionId = typeof input?.sessionId === "string" && SESSION_ID.test(input.sessionId) ? input.sessionId : null;
  return { v: 1, id, title, createdAt, updatedAt: now, sessionId, messages };
}

/** Chat history of the project at `root`. `now` is injectable for tests. */
export function createChatStore(root, { now = Date.now } = {}) {
  const dir = path.join(root, STATE_DIR, CHAT_DIR);
  let excluded = false;

  async function files() {
    const names = await readdir(dir).catch(e => (e.code === "ENOENT" ? [] : Promise.reject(e)));
    return names.map(n => n.match(FILE)).filter(Boolean).map(m => ({ name: m[0], id: m[2] }));
  }
  async function fileOf(id) {
    if (typeof id !== "string" || !ID.test(id)) throw fail(400, "id가 올바르지 않아요");
    return (await files()).find(f => f.id === id)?.name ?? null;
  }
  async function load(name) {
    try { return JSON.parse(await readFile(path.join(dir, name), "utf8")); } catch { return null; }
  }

  return {
    dir,
    /** Newest first: { id, title, createdAt, updatedAt, sessionId, count }. */
    async list() {
      const out = [];
      for (const f of await files()) {
        const c = await load(f.name);
        if (c?.id === f.id) out.push({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, sessionId: c.sessionId ?? null, count: c.messages?.length ?? 0 });
      }
      return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    },
    /** The whole record, or null. */
    async read(id) {
      const name = await fileOf(id);
      return name ? load(name) : null;
    },
    /** Saves a new conversation (no id) or replaces one (its id); returns the masked record as written. */
    async save(input) {
      const t = now();
      let id = input?.id, name = null, createdAt = t;
      if (id != null) {
        name = await fileOf(id);
        if (!name) throw fail(404, "대화가 없어요");
        createdAt = (await load(name))?.createdAt ?? t;
      } else {
        id = randomBytes(8).toString("hex");
        name = `${day(t)}-${id}.json`;
      }
      const record = sanitize(input, { id, createdAt, now: t });
      if (!excluded) { await ensureExcluded(root, stateLayout(root).worktrees); excluded = true; }
      await mkdir(dir, { recursive: true });
      const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
      await writeFile(tmp, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
      await rename(tmp, path.join(dir, name));
      return record;
    },
    /** True when a conversation was removed. */
    async remove(id) {
      const name = await fileOf(id);
      if (!name) return false;
      await rm(path.join(dir, name), { force: true });
      return true;
    },
    /** Removes every saved conversation; returns how many. */
    async clear() {
      const all = await files();
      await Promise.all(all.map(f => rm(path.join(dir, f.name), { force: true })));
      return all.length;
    },
  };
}
