import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cancelLogin, login, loginWithKey, logout, providerStatus, publicStatus } from "./auth.js";
import { branchGraph, currentBranch, diff, projectRoot } from "./git.js";
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

// A provider counts as connected only after the user connects it in Dispatch, even if its CLI is
// already logged in on this machine. `cliLoggedIn` keeps the CLI's own state for the UI.
const enabled = () => store.data.settings.enabled;
function decorate(raw) {
  const out = {};
  for (const [id, p] of Object.entries(publicStatus(raw))) {
    out[id] = { ...p, cliLoggedIn: p.connected, connected: p.connected && !!enabled()[id] };
  }
  return out;
}
let providers = decorate(await providerStatus());
async function refreshProviders() {
  providers = decorate(await providerStatus());
  broadcast("providers", providers);
}
function setEnabled(id, on) {
  store.data.settings.enabled = { ...enabled(), [id]: on };
  store.save();
}
hub.isConnected = provider => !!providers[provider]?.connected;

/* ---------------- SSE ---------------- */
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
for (const ev of ["session", "message", "limits", "removed", "tasks", "tickets"]) hub.on(ev, d => broadcast(ev, d));
setInterval(() => { for (const res of clients) res.write(": ping\n\n"); }, 25000);

async function snapshot() {
  return {
    project: { name: path.basename(root), path: root.replace(process.env.HOME || "\0", "~"), branch: await currentBranch(root) },
    roles: ROLES, perms: PERMS, models, providers,
    limits: hub.currentLimits(), settings: store.data.settings,
    sessions: hub.sessions.map(s => hub.publicSession(s)),
    prefs: await readPrefs(),
    tasks: hub.tasks,
    tickets: hub.tickets,
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

/* ---------------- Other projects ---------------- */
// Every server registers itself in ~/.dispatch/servers/<port>.json so the UI can list and switch to
// the other projects running on this machine. Only port, name, path and pid are written.
const REGISTRY = path.join(os.homedir(), ".dispatch", "servers");
const SCAN = [4317, 4330]; // servers started before the registry existed are found by probing these ports
const tilde = p => p.replace(os.homedir(), "~");

async function register() {
  await mkdir(REGISTRY, { recursive: true });
  const entry = { port: PORT, name: path.basename(root), path: tilde(root), pid: process.pid, startedAt: Date.now() };
  await writeFile(path.join(REGISTRY, `${PORT}.json`), JSON.stringify(entry));
}
async function unregister() {
  const file = path.join(REGISTRY, `${PORT}.json`);
  const cur = JSON.parse(await readFile(file, "utf8").catch(() => "{}"));
  if (cur.pid === process.pid) await rm(file, { force: true });
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

async function probe(port) {
  try {
    const res = await fetch(`http://${HOST}:${port}/api/state`, { signal: AbortSignal.timeout(500) });
    const { project } = await res.json();
    return project?.path ? { port, name: project.name, path: project.path } : null;
  } catch { return null; }
}

async function projects() {
  const found = new Map();
  for (const f of await readdir(REGISTRY).catch(() => [])) {
    if (!f.endsWith(".json")) continue;
    const e = JSON.parse(await readFile(path.join(REGISTRY, f), "utf8").catch(() => "{}"));
    if (!e.port) continue;
    if (e.port !== PORT && !alive(e.pid)) { rm(path.join(REGISTRY, f), { force: true }); continue; }
    found.set(e.port, { port: e.port, name: e.name, path: e.path });
  }
  const ports = [];
  for (let p = SCAN[0]; p <= SCAN[1]; p++) if (!found.has(p) && p !== PORT) ports.push(p);
  for (const e of await Promise.all(ports.map(probe))) if (e) found.set(e.port, e);
  found.set(PORT, { port: PORT, name: path.basename(root), path: tilde(root) });
  return [...found.values()].map(e => ({ ...e, current: e.port === PORT })).sort((a, b) => a.port - b.port);
}

/* ---------------- Preferences shared by every project ---------------- */
// One file for all Dispatch servers on this machine, so switching projects (another port, another
// browser origin) keeps the same theme. Only UI preferences live here.
const PREFS = path.join(os.homedir(), ".dispatch", "prefs.json");
const THEMES = ["system", "light", "dark"];
async function readPrefs() {
  const p = JSON.parse(await readFile(PREFS, "utf8").catch(() => "{}"));
  return { theme: THEMES.includes(p.theme) ? p.theme : "system" };
}
async function writePrefs(patch) {
  const next = { ...(await readPrefs()) };
  if (THEMES.includes(patch.theme)) next.theme = patch.theme;
  await mkdir(path.dirname(PREFS), { recursive: true });
  await writeFile(PREFS, JSON.stringify(next));
  broadcast("prefs", next);
  return next;
}

/* ---------------- Usage across projects ---------------- */
// This server's 14 days plus every other running project's, fetched server-side (no CORS).
async function usageAll() {
  const list = await projects();
  return {
    projects: await Promise.all(list.map(async p => {
      if (p.current) return { ...p, ...usage() };
      try {
        const res = await fetch(`http://${HOST}:${p.port}/api/usage`, { signal: AbortSignal.timeout(1500) });
        return { ...p, ...(await res.json()) };
      } catch { return { ...p, days: [], error: true }; }
    })),
  };
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
    // Unknown path → the app shell. While `npm run build` rewrites public/ even that can be
    // missing for a moment: answer 503 instead of letting the error take the server down.
    try {
      const data = await readFile(path.join(PUBLIC, "index.html"));
      res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
      res.end(data);
    } catch {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "2" });
      res.end("Dispatch UI is rebuilding — reload in a moment.");
    }
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
  ["GET", /^\/api\/usage\/all$/, async () => usageAll()],
  ["GET", /^\/api\/prefs$/, async () => readPrefs()],
  ["POST", /^\/api\/prefs$/, async (_, b) => writePrefs(b || {})],
  ["GET", /^\/api\/projects$/, async () => ({ projects: await projects() })],
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
    return diff(s.cwd, root);
  }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/message$/, async ([id], b) => { hub.send(id, String(b.text || "")); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/interrupt$/, async ([id]) => { hub.interrupt(id); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/kill$/, async ([id]) => { hub.kill(id); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/remove$/, async ([id]) => { hub.remove(id); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/clear$/, async () => ({ removed: hub.clearAll() })],
  ["GET", /^\/api\/limits$/, async () => hub.providerLimits()],
  ["GET", /^\/api\/tasks$/, async () => ({ tasks: hub.tasks })],
  ["GET", /^\/api\/branches$/, async () => branchGraph(root, { active: hub.sessions.filter(x => x.status !== "done" && x.branch).map(x => x.branch) })],
  ["GET", /^\/api\/tickets$/, async () => ({ tickets: hub.tickets })],
  ["POST", /^\/api\/tickets\/([\w-]+)\/resume$/, async ([id]) => ({ ok: hub.resumeTicket(id) })],
  ["POST", /^\/api\/tickets\/([\w-]+)\/close$/, async ([id]) => { hub.closeTicket(id); return { ok: true }; }],
  ["POST", /^\/api\/tasks$/, async (_, b) => hub.setTask(b.lead || null, b || {})],
  ["POST", /^\/api\/tasks\/([\w-]+)\/remove$/, async ([id]) => { hub.removeTask(id); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/to-lead$/, async ([id], b) => { hub.messageLead(id, String(b.text || "")); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/parent$/, async ([id], b) => { hub.setParent(id, b.parent ? String(b.parent) : null); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/perm$/, async ([id], b) => { hub.setPerm(id, String(b.perm || "")); return { ok: true }; }],
  ["POST", /^\/api\/sessions\/([\w-]+)\/permission$/, async ([id], b) => {
    hub.respondPermission(id, b.requestId, b.behavior === "allow" ? "allow" : "deny", !!b.always);
    return { ok: true };
  }],
  // Already logged in on this machine → just connect; otherwise run the CLI's browser login first.
  ["POST", /^\/api\/providers\/(claude|openai|gemini)\/login$/, async ([id]) => {
    if (providers[id]?.cliLoggedIn) { setEnabled(id, true); await refreshProviders(); return { ok: true, connected: true }; }
    login(id, refreshProviders, ok => ok && setEnabled(id, true));
    return { ok: true, connected: false };
  }],
  ["POST", /^\/api\/providers\/(claude|openai|gemini)\/cancel$/, async ([id]) => { cancelLogin(id); return { ok: true }; }],
  // Disconnects from Dispatch only; the CLI stays logged in unless `cli: true` is passed.
  ["POST", /^\/api\/providers\/(claude|openai|gemini)\/logout$/, async ([id], b) => {
    setEnabled(id, false);
    if (b.cli) await logout(id);
    await refreshProviders();
    return { ok: true };
  }],
  ["POST", /^\/api\/providers\/(claude|openai|gemini)\/key$/, async ([id], b) => {
    await loginWithKey(id, String(b.key || ""));
    setEnabled(id, true);
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

setInterval(() => hub.checkTeams(), 30000);

server.listen(PORT, HOST, () => {
  hub.resumeInterrupted();
  register().catch(e => console.error("registry:", e.message));
  console.log(`Dispatch → http://${HOST}:${PORT}`);
  console.log(`project  → ${root}`);
  console.log(`models   → ${models.map(m => m.id).join(", ")}`);
});

async function shutdown() {
  hub.stopAll();
  await unregister().catch(() => {});
  await store.flush().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
