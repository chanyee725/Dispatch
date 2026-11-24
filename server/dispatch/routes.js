// Dispatch HTTP API as Drawing module routes. Paths are the ones the standalone Dispatch server had
// (so mcp.js, the skills and the hook keep working); only /api/events is shared, see index.js.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { agentsSummary } from "./agents-summary.js";
import { createChatStore } from "./chat-store.js";
import { branchGraph, diff } from "./git.js";
import { issueAccounts } from "./ledger.js";
import { ROLES } from "./roles.js";
import { patchGuard, patchTeam, teamSettings } from "./settings.js";

const MAX_BODY = 1e6;
const PR_BRANCHES = 12;

const fail = (status, message) => Object.assign(new Error(message), { status });
const CLI_NAMES = { claude: "Claude CLI", openai: "Codex CLI", gemini: "Antigravity CLI(agy)" };

/** Message text must say something: an empty send used to wake a session with a blank turn. */
const required = text => {
  const t = String(text ?? "").trim();
  if (!t) throw fail(400, "text가 비어 있어요");
  return t;
};

/** Chat images (#968): at most 4, png/jpeg/gif/webp, 5 MB of base64 each, Claude sessions only (hub.send). */
export const IMAGE_LIMITS = { max: 4, base64Bytes: 5 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/gif", "image/webp"] };
/** The message route reads up to this much so four full images and the text fit. */
const MESSAGE_BODY = IMAGE_LIMITS.max * IMAGE_LIMITS.base64Bytes + MAX_BODY;

/** `images` from a message body as [{ mediaType, data }], or null; anything off-limits is a 400. */
export function checkImages(images) {
  if (images == null) return null;
  if (!Array.isArray(images)) throw fail(400, "images는 배열이어야 해요");
  if (!images.length) return null;
  if (images.length > IMAGE_LIMITS.max) throw fail(400, `이미지는 한 번에 ${IMAGE_LIMITS.max}장까지 보낼 수 있어요`);
  return images.map(i => {
    const mediaType = i?.mediaType, data = i?.data;
    if (!IMAGE_LIMITS.types.includes(mediaType)) throw fail(400, "PNG, JPEG, GIF, WebP 이미지만 보낼 수 있어요");
    if (typeof data !== "string" || !data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw fail(400, "이미지 데이터가 올바르지 않아요");
    if (data.length > IMAGE_LIMITS.base64Bytes) throw fail(400, "이미지는 장당 5MB(base64)까지 보낼 수 있어요");
    return { mediaType, data };
  });
}

/** POST /api/sessions/:id/message: text, or images with or without text. */
export function messageBody(b) {
  const images = checkImages(b?.images);
  const text = images ? String(b?.text ?? "").trim() : required(b?.text);
  return { text, images };
}

/** A SKILL.md front matter's one-line `name` and `description`, or null. Nothing else is read out of the file. */
export function skillMeta(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ""));
  if (!fm) return null;
  const field = key => {
    const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(fm[1]);
    return m ? m[1].trim().replace(/^(["'])(.*)\1$/, "$2") : "";
  };
  const name = field("name");
  if (!/^[\w:.-]{1,64}$/.test(name)) return null;
  const description = field("description");
  return { name, description: /^[>|]/.test(description) ? "" : description.slice(0, 200) };
}

/**
 * Installed skills for the chat's "/" menu (#968): `name` and `description` only, no paths or file contents.
 * Looks in the project's .claude/skills and the user's ~/.claude/skills; the project wins on a name clash.
 */
export async function listSkills(dirs) {
  const seen = new Map();
  for (const dir of dirs) {
    let names = [];
    try { names = await readdir(dir); } catch { continue; }
    for (const n of names.sort()) {
      if (n.startsWith(".")) continue;
      let meta = null;
      try { meta = skillMeta(await readFile(path.join(dir, n, "SKILL.md"), "utf8")); } catch { /* not a skill */ }
      if (meta && !seen.has(meta.name)) seen.set(meta.name, meta);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readBody(req, max = MAX_BODY) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > max) throw fail(413, "body too large");
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw fail(400, "invalid JSON"); }
}

function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

/**
 * Wraps a Dispatch table entry [method, RegExp, fn(params, body)] as a Drawing route. Errors are
 * answered as { error } with e.status || 400, like the standalone server; a thrown error never
 * reaches the app's 500 handler, so one failing Dispatch call can't affect drawing routes. The
 * x-drawing header on writes is checked by server/app.js for every /api route.
 */
export function adapt([method, path, fn, opts]) {
  return {
    method,
    path,
    async handler(req, res, _ctx, match, url) {
      try {
        const body = method === "GET" ? {} : await readBody(req, opts?.maxBody);
        send(res, 200, await fn(match.slice(1), body ?? {}, url));
      } catch (e) {
        if (!res.headersSent) send(res, e.status || 400, { error: e.message });
        else res.end();
      }
    },
  };
}

/**
 * The route table. `d` is the running Dispatch instance from index.js:
 * { root, store, hub, models, broadcast, snapshot, usage, projects,
 *   providers(), refreshProviders, setEnabled, login, cancelLogin, logout }
 */
export function routeTable(d) {
  const { root, store, hub, models, broadcast } = d;
  let chatStore = d.chats ?? null;
  const chats = () => (chatStore ??= createChatStore(root));
  const session = id => {
    const s = hub.get(id);
    if (!s) throw fail(404, "세션이 없어요");
    return s;
  };
  return [
    ["GET", /^\/api\/state$/, async () => d.snapshot()],
    ["GET", /^\/api\/usage$/, async (_, __, url) => {
      // ?folder=<path>: cost and tokens of that project's sessions (the daily chart stays account-wide, see usage()).
      const p = url?.searchParams.get("folder");
      if (p == null) return d.usage();
      if (!p || p.startsWith(".") || /[\/\\\0]/.test(p)) throw fail(400, "folder가 올바르지 않아요");
      return hub.folderUsage(p);
    }],
    ["GET", /^\/api\/projects$/, async () => ({ projects: await d.projects() })],
    ["POST", /^\/api\/settings$/, async (_, b) => {
      const before = { guard: store.data.settings.guard, team: store.data.settings.team };
      if (b.guard) store.data.settings.guard = patchGuard(store.data.settings.guard, b.guard);
      if (b.team) patchTeam(store, b.team, { roles: ROLES, models });
      // The user's defaults file (~/.atelier/drawing.json) gets the change first; a broken file refuses it and the
      // project's state.json stays as it was, so the two never disagree about what was saved.
      try {
        await d.saveUserDefaults({ guard: b.guard ? store.data.settings.guard : undefined, team: b.team ? store.data.settings.team : undefined });
      } catch (e) {
        Object.assign(store.data.settings, before);
        throw e;
      }
      store.save();
      const settings = { ...store.data.settings, team: teamSettings(store) };
      broadcast("settings", settings);
      // Role default models live in the snapshot's roles, so a model change re-sends the snapshot.
      if (b.team?.roleModels) broadcast("snapshot", await d.snapshot());
      return settings;
    }],
    // Harness profiles per mode × role (#748). PUT: { cells }, { hints } or { reset: true | <mode> }.
    ["GET", /^\/api\/mode-profiles$/, async () => d.modeProfiles.get()],
    ["PUT", /^\/api\/mode-profiles$/, async (_, b) => d.modeProfiles.put(b)],
    ["POST", /^\/api\/sessions$/, async (_, b) => {
      const images = checkImages(b.images);
      return {
        sessions: await hub.create({ items: b.items || [], commonPrompt: b.commonPrompt || "", worktree: b.worktree !== false, parent: b.parent || null, folder: b.folder, ...(typeof b.mode === "string" && { mode: b.mode }), ...(typeof b.lane === "string" && { lane: b.lane }), ...(images && { images }) }),
      };
    }, { maxBody: MESSAGE_BODY }],
    ["GET", /^\/api\/sessions\/([\w-]+)\/messages$/, async ([id]) => ({ session: hub.publicSession(session(id)), messages: hub.transcript(id) })],
    ["GET", /^\/api\/sessions\/([\w-]+)\/live$/, async ([id]) => ({ session: hub.publicSession(session(id)), live: hub.liveState(id) })],
    ["GET", /^\/api\/sessions\/([\w-]+)\/diff$/, async ([id]) => diff(session(id).cwd, root)],
    ["POST", /^\/api\/sessions\/([\w-]+)\/message$/, async ([id], b) => {
      const { text, images } = messageBody(b);
      hub.send(id, text, images ? { images } : undefined);
      return { ok: true };
    }, { maxBody: MESSAGE_BODY }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/interrupt$/, async ([id]) => { hub.interrupt(id); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/kill$/, async ([id]) => { hub.kill(id); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/remove$/, async ([id]) => { hub.remove(id); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/clear$/, async () => ({ removed: hub.clearAll() })],
    ["POST", /^\/api\/sessions\/clear-done$/, async () => ({ removed: hub.clearDone() })],
    ["GET", /^\/api\/limits$/, async () => hub.providerLimits()],
    ["GET", /^\/api\/timeline$/, async () => hub.timeline()],
    ["GET", /^\/api\/tasks$/, async () => ({ tasks: hub.tasks })],
    // Compact read-only summary for the Claude Code mod pane (#755): usage windows, leads with their task board and
    // team, issue/PR numbers. Metadata only (agents-summary.js). PRs come from the cached issue list; ?pr=0 skips it.
    ["GET", /^\/api\/agents\/summary$/, async (_, __, url) => {
      const issues = url?.searchParams.get("pr") === "0" || !d.issues ? null : await d.issues().catch(() => null);
      return agentsSummary({ project: { name: root ? path.basename(root) : "" }, limits: hub.currentLimits(),
        sessions: hub.sessions.map(s => hub.publicSession(s)), tasks: hub.tasks, issues });
    }],
    ["GET", /^\/api\/branches$/, async () => branchGraph(root, { active: hub.sessions.filter(x => x.status !== "done" && x.branch).map(x => x.branch) })],
    // One row per session branch (#792): owner sessions, issue, ahead/behind, last commit, dirty flag, PR phase.
    ["GET", /^\/api\/branches\/live$/, async () => (d.liveBranches ? d.liveBranches() : { base: null, pr: "disabled", rows: [] })],
    // Commit tree for the 브랜치 tab (#877): hash, parents, owning branch, time and subject per commit, branch tips.
    ["GET", /^\/api\/branches\/tree$/, async () => (d.branchTree ? d.branchTree() : { base: null, commits: [], tips: [] })],
    // ?branches=a,b: PR state and CI per branch (project dashboard, #686). At most PR_BRANCHES per call; each answer is
    // { ok, pr: { number, state, ci } } or { ok: false, reason } ("disabled" when PR tracking is off).
    ["GET", /^\/api\/prs$/, async (_, __, url) => {
      const list = [...new Set((url?.searchParams.get("branches") || "").split(",").filter(Boolean))].slice(0, PR_BRANCHES);
      const prs = {};
      if (d.prStatus) await Promise.all(list.map(async b => { prs[b] = await d.prStatus(b); }));
      return { prs };
    }],
    // Open GitHub issues with their PRs (#776): { ok, issues: [{ number, title, url?, prs: [{ number, state, url?, branch? }] }] }
    // or { ok: false, reason }. Read-only.
    ["GET", /^\/api\/issues$/, async () => (d.issues ? d.issues() : { ok: false, reason: "disabled" })],
    // The first lines of one issue's body for the start panel (#954): { ok, summary: string[] } or { ok: false, reason }.
    ["GET", /^\/api\/issues\/(\d{1,7})\/summary$/, async ([n]) => (d.issues?.summary ? d.issues.summary(Number(n)) : { ok: false, reason: "disabled" })],
    // Sessions, models and account labels that worked on one issue (#747), plus the PR-comment summary line.
    // PRs come from the cached issue/PR list (branch, Closes, Refs), else pr-status per branch; ?pr=0 skips both.
    ["GET", /^\/api\/issues\/(\d{1,7})\/accounts$/, async ([n], __, url) => {
      if (url?.searchParams.get("pr") === "0") return issueAccounts(d.ledger, Number(n));
      return issueAccounts(d.ledger, Number(n), { prsOf: d.issues?.prsOf, prOf: d.prStatus });
    }],
    // Posts the summary line on the issue's PR as one comment, updated in place on later calls (#756). Body { pr? }:
    // without pr, the issue's first PR (open first). { ok, pr, comment: "created"|"updated", summary } or
    // { ok: false, reason } ("no-sessions", "no-pr", or pr-comment.js's reasons).
    ["POST", /^\/api\/issues\/(\d{1,7})\/accounts\/comment$/, async ([n], b) => {
      if (b?.pr != null && !(Number.isInteger(b.pr) && b.pr > 0 && b.pr < 1e7)) throw fail(400, "pr이 올바르지 않아요");
      const issue = Number(n);
      const a = await issueAccounts(d.ledger, issue, { prsOf: d.issues?.prsOf, prOf: d.prStatus });
      if (!a.sessions.length) return { ok: false, reason: "no-sessions", summary: a.summary };
      const pr = b?.pr ?? a.prs[0];
      if (!pr) return { ok: false, reason: "no-pr", summary: a.summary };
      if (!d.postAccounts) return { ok: false, reason: "disabled", summary: a.summary };
      return { ...(await d.postAccounts({ pr, issue, summary: a.summary })), summary: a.summary };
    }],
    ["POST", /^\/api\/tasks$/, async (_, b) => {
      const isNew = !b?.id;
      const t = await hub.setTask(b?.lead || null, b || {});
      // Creating by title: show the lead what is already open so a renamed copy of the same work stands out.
      // A new task also gets the ETA of past runs in its lane, so the lead's estimate starts from real numbers.
      return isNew && t.lead ? { ...t, open: hub.openTasks(t.lead, t.id), etaHint: hub.etaHint(t.lane) } : t;
    }],
    ["POST", /^\/api\/tasks\/([\w-]+)\/remove$/, async ([id]) => { hub.removeTask(id); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/to-lead$/, async ([id], b) => { hub.messageLead(id, required(b?.text)); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/task$/, async ([id], b) => { hub.setSessionTask(id, typeof b?.task === "string" ? b.task : ""); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/parent$/, async ([id], b) => { hub.setParent(id, b.parent ? String(b.parent) : null); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/perm$/, async ([id], b) => { hub.setPerm(id, String(b.perm || "")); return { ok: true }; }],
    ["POST", /^\/api\/sessions\/([\w-]+)\/permission$/, async ([id], b) => {
      hub.respondPermission(id, b.requestId, b.behavior === "allow" ? "allow" : "deny", !!b.always, b.answers ?? null);
      return { ok: true };
    }],
    // Already logged in on this machine → just connect; otherwise run the CLI's browser login first.
    ["POST", /^\/api\/providers\/(claude|openai|gemini)\/login$/, async ([id]) => {
      if (!d.providers()[id]?.cliLoggedIn) await d.refreshProviders();
      if (d.providers()[id]?.cliLoggedIn) { d.setEnabled(id, true); await d.refreshProviders(); return { ok: true, connected: true }; }
      if (d.providers()[id]?.installed === false) throw fail(400, `${CLI_NAMES[id]}를 찾지 못했어요. 설치한 뒤 다시 눌러 주세요`);
      d.login(id, () => d.refreshProviders().catch(e => console.error("dispatch providers:", e.code ?? e.name)), ok => ok && d.setEnabled(id, true));
      return { ok: true, connected: false };
    }],
    ["POST", /^\/api\/providers\/(claude|openai|gemini)\/cancel$/, async ([id]) => { await d.cancelLogin(id); return { ok: true }; }],
    // Disconnects from Drawing only; the CLI stays logged in unless `cli: true` is passed.
    ["POST", /^\/api\/providers\/(claude|openai|gemini)\/logout$/, async ([id], b) => {
      // A login still running would connect again when it finishes.
      await d.cancelLogin(id);
      d.setEnabled(id, false);
      if (b.cli) await d.logout(id);
      await d.refreshProviders();
      return { ok: true };
    }],
    // Codex's own API-key login (as in Dispatch). The key goes straight to `codex login --with-api-key`'s
    // stdin: it is never logged, saved, put in state.json or echoed back in an error.
    ["POST", /^\/api\/providers\/(openai)\/key$/, async ([id], b) => {
      await d.cancelLogin(id);
      await d.loginWithKey(id, typeof b?.key === "string" ? b.key.trim() : "");
      d.setEnabled(id, true);
      await d.refreshProviders();
      return { ok: true, connected: !!d.providers()[id]?.connected };
    }],
    ["GET", /^\/api\/skills$/, async () => ({
      skills: await listSkills(d.skillDirs ?? [path.join(root, ".claude", "skills"), path.join(homedir(), ".claude", "skills")]),
    })],
    // Saved chat history (#968): .atelier/chat/, masked by chat-store.js before it reaches disk, never in git.
    ["GET", /^\/api\/chats$/, async () => ({ chats: await chats().list() })],
    ["GET", /^\/api\/chats\/([a-z0-9]+)$/, async ([id]) => {
      const chat = await chats().read(id);
      if (!chat) throw fail(404, "대화가 없어요");
      return { chat };
    }],
    ["POST", /^\/api\/chats$/, async (_, b) => ({ chat: await chats().save(b || {}) })],
    ["DELETE", /^\/api\/chats$/, async () => ({ removed: await chats().clear() })],
    ["DELETE", /^\/api\/chats\/([a-z0-9]+)$/, async ([id]) => {
      if (!(await chats().remove(id))) throw fail(404, "대화가 없어요");
      return { ok: true };
    }],
    ["POST", /^\/api\/providers\/refresh$/, async () => { await d.refreshProviders(); return d.providers(); }],
    // For the settings page (#1023). Kept out of /api/state and SSE, so the state agents usually read has no email.
    // Any local process can still GET it, as it could run `claude auth status` itself: no new exposure, not a secret.
    ["GET", /^\/api\/providers\/accounts$/, async () => ({ accounts: await d.accounts() })],
  ];
}
