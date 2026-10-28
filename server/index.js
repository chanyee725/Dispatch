import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cancelLogin, login, loginWithKey, logout, providerStatus, publicStatus } from "./auth.js";
import { currentBranch, diff, projectRoot } from "./git.js";
import { loadModels } from "./models.js";
import { PERMS, ROLES } from "./roles.js";
import { Hub } from "./sessions.js";
import { Store } from "./store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");
const PORT = +process.env.DISPATCH_PORT || 4317;
const HOST = "127.0.0.1";

// The project is the directory Dispatch was started in (or the first CLI argument).
const root = await projectRoot(path.resolve(process.argv[2] || process.cwd()));
const store = new Store(root);
await store.load();
const models = await loadModels();
const hub = new Hub({ root, store, models, roles: ROLES, port: PORT });

let providers = publicStatus(await providerStatus());
async function refreshProviders() {
  providers = publicStatus(await providerStatus());
  broadcast("providers", providers);
}

/* ---------------- SSE ---------------- */
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
for (const ev of ["session", "message", "limits", "removed"]) hub.on(ev, d => broadcast(ev, d));
setInterval(() => { for (const res of clients) res.write(": ping\n\n"); }, 25000);

async function snapshot() {
  return {
    project: { name: path.basename(root), path: root.replace(process.env.HOME || "\0", "~"), branch: await currentBranch(root) },
    roles: ROLES, perms: PERMS, models, providers,
    limits: hub.limits, settings: store.data.settings,
    sessions: hub.sessions.map(s => hub.publicSession(s)),
  };
}

function usage() {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toLocaleDateString("sv-SE");
    days.push({ day: d, ...(store.data.daily[d] || { cost: 0, models: {}, roles: {} }) });
  }
  return { days };
}

/* ---------------- HTTP ---------------- */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

// Serves the built web app from public/; unknown paths fall back to index.html.
async function serveStatic(pathname, res) {
  const file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  const inside = file.startsWith(PUBLIC + path.sep) && !file.endsWith(path.sep);
  const target = inside ? file : path.join(PUBLIC, "index.html");
  try {
    const data = await readFile(target);
    const immutable = target.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, { "content-type": TYPES[path.extname(target)] || "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-store" });
    res.end(data);
  } catch {
    const data = await readFile(path.join(PUBLIC, "index.html"));
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
    res.end(data);
  }
}

function send(res, code, data) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw new Error("body too large"); }
  return raw ? JSON.parse(raw) : {};
}

const routes = [
  ["GET", /^\/api\/state$/, async () => snapshot()],
  ["GET", /^\/api\/usage$/, async () => usage()],
  ["POST", /^\/api\/settings$/, async (_, b) => {
    if (b.guard) store.data.settings.guard = { ...store.data.settings.guard, ...b.guard };
    store.save();
    broadcast("settings", store.data.settings);
    return store.data.settings;
  }],
  ["POST", /^\/api\/sessions$/, async (_, b) => ({
    sessions: await hub.create({ items: b.items || [], commonPrompt: b.commonPrompt || "", worktree: b.worktree !== false, parent: b.parent || null }),
  })],
  ["GET", /^\/api\/sessions\/([\w-]+)\/messages$/, async ([id]) => {
    const s = hub.get(id);
    if (!s) throw Object.assign(new Error("세션이 없어요"), { status: 404 });
    return { session: hub.publicSession(s), messages: hub.transcript(id) };
  }],
  ["GET", /^\/api\/sessions\/([\w-]+)\/diff$/, async ([id]) => {
    const s = hub.get(id);
    if (!s) throw Object.assign(new Error("세션이 없어요"), { status: 404 });
    return diff(s.cwd);
  }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/message$/, async ([id], b) => { hub.send(id, String(b.text || "")); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/interrupt$/, async ([id]) => { hub.interrupt(id); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/kill$/, async ([id]) => { hub.kill(id); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/remove$/, async ([id]) => { hub.remove(id); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/permission$/, async ([id], b) => {
    hub.respondPermission(id, b.requestId, b.behavior === "allow" ? "allow" : "deny", !!b.always);
    return { ok: true };
  }],
  ["POST", /^\/api\/providers\/(claude|openai)\/login$/, async ([id]) => { login(id, refreshProviders); return { ok: true }; }],
  ["POST", /^\/api\/providers\/(claude|openai)\/cancel$/, async ([id]) => { cancelLogin(id); return { ok: true }; }],
  ["POST", /^\/api\/providers\/(claude|openai)\/logout$/, async ([id]) => { await logout(id); await refreshProviders(); return { ok: true }; }],
  ["POST", /^\/api\/providers\/(claude|openai)\/key$/, async ([id], b) => {
    await loginWithKey(id, String(b.key || ""));
    await refreshProviders();
    return { ok: true };
  }],
  ["POST", /^\/api\/providers\/refresh$/, async () => { await refreshProviders(); return providers; }],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) return serveStatic(url.pathname, res);
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: snapshot\ndata: ${JSON.stringify(await snapshot())}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    // Writes need a custom header: browsers can't send it cross-origin without a preflight we never approve.
    if (req.method !== "GET" && req.headers["x-dispatch"] !== "1") return send(res, 403, { error: "forbidden" });
    for (const [method, re, fn] of routes) {
      const m = req.method === method && url.pathname.match(re);
      if (m) return send(res, 200, await fn(m.slice(1), req.method === "GET" ? {} : await body(req)));
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, e.status || 400, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dispatch → http://${HOST}:${PORT}`);
  console.log(`project  → ${root}`);
  console.log(`models   → ${models.map(m => m.id).join(", ")}`);
});

async function shutdown() {
  hub.stopAll();
  await store.flush().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
