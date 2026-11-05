import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dropWorktree, prepareWorkdir, verifyMerged } from "./git.js";
import { CHILD_PROMPT, NAMES, PERMS, SPAWN_PROMPT } from "./roles.js";
import { replyStyle } from "./style.js";
import { effectiveRoles, teamSettings } from "./settings.js";
import { codexLimits, geminiResetFrom, isQuotaError } from "./limits.js";

const MCP_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp.js");
const MAX_TRANSCRIPT = 400;
const STALL_MS = 10 * 60 * 1000;
// After teamSettings().rotateLead / rotateOthers turns a session continues in a fresh CLI session
// (a handoff note carries the essentials), so a long-lived lead does not keep re-reading an
// ever-growing context. Leads take many short turns, so they rotate sooner. 0 turns it off.
const RESUME_TEXT = "[Dispatch] 서버가 재시작되어 직전 턴이 중간에 끊겼다. 작업 폴더와 브랜치 상태를 확인하고 하던 일을 이어서 끝내라.";
// Browser tools in team sessions run headless, each in its own throwaway profile, so checks never pop
// windows on the user's screen or steer another session's tab. A session can still opt out via its own env.
const SESSION_ENV = { PLAYWRIGHT_MCP_HEADLESS: "true", PLAYWRIGHT_MCP_ISOLATED: "true" };
const sessionEnv = () => ({ ...SESSION_ENV, ...process.env });
const isOpenStatus = st => !["done", "error"].includes(st);
const clip = (s, n = 2000) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; };

// Splits a child's stdout into JSON lines.
function onJsonLines(stream, fn) {
  let buf = "";
  stream.on("data", d => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      fn(msg);
    }
  });
}

/** A short Korean label for what a tool call is doing, from its name and (for shells) its command. */
export function activityOf(name = "", text = "") {
  const t = String(text);
  if (/^(Bash|shell)$/i.test(name)) {
    if (/playwright/.test(t)) return "e2e 실행";
    if (/vitest|jest|npm (run )?test\b|pytest/.test(t)) return "단위 테스트";
    if (/\btsc\b|typecheck/.test(t)) return "타입 검사";
    if (/eslint|npm run lint/.test(t)) return "lint";
    if (/next build|vite build|npm run build/.test(t)) return "빌드";
    if (/\bgit\b[^|;&]*\b(merge|cherry-pick|rebase)\b/.test(t)) return "병합";
    if (/\bgit\b[^|;&]*\bcommit\b/.test(t)) return "커밋";
    if (/\bgit\b[^|;&]*\b(diff|log|show|status)\b/.test(t)) return "변경 확인";
    if (/npm (i|install|ci)\b/.test(t)) return "패키지 설치";
    if (/^\W*"?(\{"command":"?)?\s*(cat|sed -n|grep|rg|ls|find|head|tail)\b/.test(t)) return "코드 읽기";
    return "명령 실행";
  }
  if (/^(Edit|Write|MultiEdit|NotebookEdit|edit)$/.test(name)) return "파일 수정";
  if (/^(Read|Grep|Glob)$/.test(name)) return "코드 읽기";
  if (name === "Skill") return "스킬 불러오기";
  if (/^mcp__dispatch__/.test(name) || /^dispatch\./.test(name)) return "팀 관리";
  if (/^mcp__.*playwright|^browser_/.test(name)) return "화면 확인";
  if (/^Web(Fetch|Search)$/.test(name)) return "웹 검색";
  if (/^(Monitor|TaskStop|TaskOutput|ToolSearch)$/.test(name)) return "기다리는 중";
  return name.replace(/^mcp__[^_]+__/, "");
}

export class Hub extends EventEmitter {
  constructor({ root, store, models, roles, port }) {
    super();
    this.root = root;
    this.store = store;
    this.models = models;
    this.roles = roles;
    this.port = port;
    this.limits = store.data.limits || { five: null, seven: null, fiveReset: null, sevenReset: null, updatedAt: null };
    this.live = new Map(); // id -> { proc, transcript, perms, seenMsgIds }
    this.isConnected = () => true; // replaced by the server with the Dispatch-level connection check

    // Transcripts are appended per session under .dispatch/transcripts so a restart keeps them.
    this.tdir = path.join(root, ".dispatch", "transcripts");
    mkdirSync(this.tdir, { recursive: true });

    // Sessions from a previous run have no process. Ones cut off mid-turn are resumed by resumeInterrupted().
    for (const s of Object.values(store.data.sessions)) {
      if (s.status === "running" || s.status === "waiting" || s.status === "starting") { s.status = "idle"; s.interrupted = true; }
    }
  }

  get sessions() { return Object.values(this.store.data.sessions); }
  get(id) { return this.store.data.sessions[id]; }
  rt(id) {
    let r = this.live.get(id);
    if (!r) {
      const transcript = this.readTranscript(id);
      this.live.set(id, r = { proc: null, transcript, written: transcript.length, perms: new Map(), seenMsgIds: new Set(), pendingReport: null });
    }
    return r;
  }

  tfile(id) { return path.join(this.tdir, `${id}.jsonl`); }

  readTranscript(id) {
    let lines = [];
    try { lines = readFileSync(this.tfile(id), "utf8").split("\n"); } catch { return []; }
    const out = [];
    for (const l of lines.slice(-MAX_TRANSCRIPT - 1)) { if (l) try { out.push(JSON.parse(l)); } catch { /* torn last line */ } }
    return out.slice(-MAX_TRANSCRIPT);
  }

  /** Current team settings (설정 page), defaults seeded from the environment. */
  team() { return teamSettings(this.store); }

  publicSession(s) {
    const r = this.live.get(s.id);
    const busy = s.status === "running" || s.status === "starting";
    return { ...s, pending: r ? [...r.perms.values()] : [], activity: busy ? r?.activity ?? null : null };
  }

  touch(s, patch = {}) {
    Object.assign(s, patch, { updatedAt: Date.now() });
    // A removed session's process exits a moment after remove(); its late "done" must not reach the
    // UI, which would add the session back until the page is reloaded.
    if (this.get(s.id) !== s) return;
    // A finished turn ends its activity, so the next turn's clock starts fresh.
    if (patch.status && patch.status !== "running" && patch.status !== "starting") {
      const r = this.live.get(s.id);
      if (r) r.activity = null;
    }
    this.store.save();
    this.emit("session", this.publicSession(s));
  }

  push(s, entry) {
    const r = this.rt(s.id);
    entry.at = Date.now();
    if (entry.kind === "tool") {
      r.lastTool = entry.name + (entry.text ? ` ${clip(entry.text, 80)}` : "");
      // What the session is doing right now, for the board ("e2e 실행 · 4분째"). The clock keeps
      // running across consecutive tools of the same kind, so a stuck test loop shows its real age.
      const label = activityOf(entry.name, entry.text);
      if (label !== r.activity?.label) {
        r.activity = { label, since: Date.now() };
        this.emit("session", this.publicSession(s));
      }
    }
    r.transcript.push(entry);
    if (r.transcript.length > MAX_TRANSCRIPT) r.transcript.splice(0, r.transcript.length - MAX_TRANSCRIPT);
    try {
      // Append; compact the file to the in-memory window once it doubles.
      if (++r.written > MAX_TRANSCRIPT * 2) {
        writeFileSync(this.tfile(s.id), r.transcript.map(e => JSON.stringify(e)).join("\n") + "\n");
        r.written = r.transcript.length;
      } else appendFileSync(this.tfile(s.id), JSON.stringify(entry) + "\n");
    } catch { /* disk trouble must not stop the session */ }
    this.emit("message", { id: s.id, entry });
  }

  transcript(id) { return this.get(id) ? this.rt(id).transcript : []; }

  // Patch without bumping updatedAt (watchdog flags must not look like activity).
  mark(s, patch) {
    Object.assign(s, patch);
    if (this.get(s.id) !== s) return; // removed: see touch()
    this.store.save();
    this.emit("session", this.publicSession(s));
  }

  // A window whose reset time has passed is empty until Claude reports again; stale gauges must not block.
  currentLimits(now = Date.now()) {
    const l = { ...this.limits };
    if (l.fiveReset && l.fiveReset <= now) l.five = 0;
    if (l.sevenReset && l.sevenReset <= now) l.seven = 0;
    return l;
  }

  setGeminiQuota(text) {
    this.store.data.geminiQuota = { reached: true, reset: geminiResetFrom(text), at: Date.now() };
    this.store.save();
    this.emit("limits", this.currentLimits());
  }

  /** Limits per provider for the top bar: Claude windows, Codex windows, Gemini reached/ok. */
  async providerLimits(now = Date.now()) {
    const c = this.currentLimits(now);
    const g = this.store.data.geminiQuota;
    const geminiReached = !!g?.reached && (!g.reset || g.reset > now);
    return {
      claude: { windows: [
        { label: "5시간", used: c.five, reset: c.fiveReset },
        { label: "주간", used: c.seven, reset: c.sevenReset },
      ] },
      openai: await codexLimits(),
      gemini: { reached: geminiReached, reset: geminiReached ? g.reset ?? null : null },
    };
  }

  /* ---------------- Task board ---------------- */
  // Leads keep a small board of what they are doing: one entry per piece of work with its stage,
  // owner and an ETA, so the UI can show what is left without reading transcripts.

  get tasks() {
    const cut = Date.now() - 6 * 3600_000; // finished work drops off after six hours
    const sessions = this.store.data.sessions || {};
    return Object.values(this.store.data.tasks ||= {})
      // A removed lead's tasks have no one left to close them.
      .filter(t => !t.lead || sessions[t.lead])
      .filter(t => t.stage !== "done" || t.updatedAt > cut)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Creates or updates a task (matched by id, else by lead + title). Closing one as done with a
   * `commit` (hash or branch) first checks the commit is on the integration branch; if not, the
   * task stays open and `mergeCheck` says why. Closing without a commit (abandoned work) skips it.
   */
  async setTask(lead, input) {
    const STAGES = ["plan", "impl", "review", "test", "merge", "done", "blocked"];
    const all = (this.store.data.tasks ||= {});
    const title = String(input.title || "").trim().slice(0, 120);
    let t = (input.id && all[input.id]) || Object.values(all).find(x => x.lead === lead && x.title === title && x.stage !== "done");
    if (!t) {
      if (!title) throw new Error("title이 필요해요");
      // Closing work by creating a fresh "done" task left the real one open with a stale eta.
      const open = lead ? this.openTasks(lead) : [];
      if (input.stage === "done" && open.length) {
        throw Object.assign(new Error(`새 작업을 done으로 만들 수 없어요. 끝난 일은 기존 작업의 id로 닫으세요: ${open.map(x => `${x.title} (id ${x.id})`).join(", ")}`), { status: 400 });
      }
      t = { id: randomUUID(), lead, title, stage: "plan", createdAt: Date.now(), stageAt: Date.now(), owner: null, etaAt: null, note: "" };
      all[t.id] = t;
    }
    if (title) t.title = title;
    if (input.commit !== undefined) t.commit = input.commit ? String(input.commit).trim().slice(0, 80) || null : null;
    let stage = input.stage && STAGES.includes(input.stage) && input.stage !== t.stage ? input.stage : null;
    if (stage === "done") {
      if (t.commit) {
        const check = await verifyMerged(this.root, t.commit);
        t.mergeCheck = { ...check, at: Date.now() };
        if (!check.ok) stage = null; // stays open; the attention strip shows mergeCheck
      } else {
        t.mergeCheck = { ok: null, commit: null, base: null, reason: "커밋 없이 닫혀 병합을 확인하지 않았어요", at: Date.now() };
      }
    }
    if (stage) { t.stage = stage; t.stageAt = Date.now(); }
    if (input.owner !== undefined) t.owner = input.owner ? String(input.owner).slice(0, 60) : null;
    if (input.eta_minutes !== undefined) t.etaAt = input.eta_minutes == null ? null : Date.now() + Math.max(0, Number(input.eta_minutes)) * 60_000;
    if (t.stage === "done") t.etaAt = null;
    if (input.note !== undefined) t.note = String(input.note || "").slice(0, 200);
    t.updatedAt = Date.now();
    this.store.save();
    this.emit("tasks", this.tasks);
    return t;
  }

  /** Open tasks of one lead other than `except`, as { id, title, stage }. */
  openTasks(lead, except) {
    return Object.values(this.store.data.tasks || {})
      .filter(t => t.lead === lead && t.id !== except && t.stage !== "done")
      .map(t => ({ id: t.id, title: t.title, stage: t.stage }));
  }

  /**
   * Rides on every report the lead gets anyway (no extra turn): its open tasks with ids and time
   * left, so the lead moves stage/owner/eta in the same turn and closes the right task by id.
   * Without it leads let etas go stale ("17분 남음" on merged work) and closed renamed copies.
   */
  boardNote(lead) {
    const now = Date.now();
    const open = this.tasks.filter(t => t.lead === lead && t.stage !== "done");
    if (!open.length) return "";
    const left = t => !t.etaAt ? "예상 없음" : t.etaAt < now ? `${Math.round((now - t.etaAt) / 60000)}분 지연` : `${Math.round((t.etaAt - now) / 60000)}분 남음`;
    const failed = t => (t.mergeCheck?.ok === false ? `, 닫기 보류: ${t.mergeCheck.reason}` : "");
    const lines = open.map(t => `- ${t.title} (id ${t.id}, ${t.stage}, ${t.owner || "담당 없음"}, ${left(t)}${failed(t)})`);
    return `\n\n[작업 보드] 이 보고로 바뀐 것을 같은 턴에 set_task(id)로 갱신한다(stage·owner·eta_minutes). 병합한 일은 이 id와 commit(브랜치나 커밋)으로 done, 그만둔 일은 commit 없이 done. 새 제목으로 다시 만들지 않는다:\n${lines.join("\n")}`;
  }

  /** A random name no listed session uses yet; once all are taken, the name gets the session number. */
  pickName(n) {
    const taken = new Set(Object.values(this.store.data.sessions || {}).map(s => s.name));
    const free = NAMES.filter(x => !taken.has(x));
    if (free.length) return free[Math.floor(Math.random() * free.length)];
    return `${NAMES[n % NAMES.length].slice(0, 3)}${n % 1000}`; // still ≤ 6 letters
  }

  removeTask(id) {
    delete (this.store.data.tasks ||= {})[id];
    this.store.save();
    this.emit("tasks", this.tasks);
  }

  /** Removes finished sessions (done or error) and, through remove(), their clean worktrees. */
  clearDone() {
    const ids = this.sessions.filter(s => s.status === "done" || s.status === "error").map(s => s.id);
    for (const id of ids) this.remove(id);
    return ids.length;
  }

  /** Stops and removes every session of this project. */
  clearAll() {
    const ids = this.sessions.map(s => s.id);
    for (const id of ids) this.remove(id);
    return ids.length;
  }

  guardCheck(count) {
    const g = this.store.data.settings.guard;
    if (!g.enabled) return null;
    const limits = this.currentLimits();
    if (limits.five != null && limits.five >= g.five) return `5시간 한도 ${Math.round(limits.five * 100)}% — 차단 기준 이상이에요`;
    if (limits.seven != null && limits.seven >= g.seven) return `주간 한도 ${Math.round(limits.seven * 100)}% — 차단 기준 이상이에요`;
    return null;
  }

  /* ---------------- create ---------------- */

  // items: [{ role, model, effort, perm, prompt, n }]
  async create({ items, commonPrompt, worktree = true, parent = null }) {
    const total = items.reduce((a, x) => a + (x.n || 1), 0);
    if (!total) throw new Error("만들 세션이 없어요");
    for (const it of items) {
      const id = it.model || this.roles.find(r => r.id === it.role)?.model;
      const provider = this.models.find(m => m.id === id)?.provider;
      if (provider && !this.isConnected(provider)) {
        const name = provider === "claude" ? "Claude" : provider === "gemini" ? "Gemini" : "OpenAI Codex";
        throw new Error(`${name}가 Dispatch에 연결되지 않았어요. 연결하기에서 먼저 연결하세요.`);
      }
    }
    // The limit gauges come from Claude, so they only gate Claude sessions.
    const usesClaude = items.some(it => {
      const id = it.model || this.roles.find(r => r.id === it.role)?.model;
      return this.models.find(m => m.id === id)?.provider === "claude";
    });
    const blocked = usesClaude && this.guardCheck(total);
    if (blocked) throw new Error(blocked);
    if (parent) {
      const active = this.sessions.filter(s => s.parent === parent && !["done", "error"].includes(s.status)).length;
      const max = this.team().maxChildren;
      if (active + total > max) throw new Error(`관리자 한 명이 동시에 둘 수 있는 세션은 ${max}개까지예요 (현재 ${active}개)`);
    }

    const made = [];
    for (const it of items) {
      const role = effectiveRoles(this.roles, this.store).find(r => r.id === it.role);
      if (!role) throw new Error(`알 수 없는 역할: ${it.role}`);
      const model = this.models.find(m => m.id === (it.model || role.model));
      if (!model) throw new Error(`알 수 없는 모델: ${it.model}`);
      for (let k = 0; k < (it.n || 1); k++) {
        const n = ++this.store.data.seq;
        const slug = `${role.id}-${n}`;
        const wd = await prepareWorkdir(this.root, slug, worktree, { shareDeps: this.team().shareDeps });
        const s = {
          id: randomUUID(), n, name: this.pickName(n), role: role.id, roleName: role.name,
          provider: model.provider, model: model.id, modelLabel: model.label,
          effort: it.effort || null, perm: it.perm || role.perm,
          prompt: it.prompt ?? role.prompt, canSpawn: !!role.canSpawn,
          cwd: wd.cwd, branch: wd.branch, worktree: wd.worktree, parent,
          status: "starting", startedAt: Date.now(), updatedAt: Date.now(),
          last: "", turns: 0, ctx: 0, ctxWindow: model.contextWindow,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          cost: model.provider === "claude" ? 0 : null,
          providerSessionId: null, error: null,
        };
        this.store.data.sessions[s.id] = s;
        if (wd.warning) this.push(s, { kind: "system", text: wd.warning });
        const first = it.task || commonPrompt;
        this.push(s, { kind: "user", text: first, label: parent ? "관리자 지시" : "공통 프롬프트" });
        this.touch(s);
        this.start(s, first);
        made.push(s);
      }
    }
    return made.map(s => this.publicSession(s));
  }

  /* ---------------- control ---------------- */

  /** True while a guard window is over its threshold: no new turns until the reset. */
  get paused() { return !!this.limitHit(); }

  send(id, text, { force = false } = {}) {
    const s = this.get(id);
    if (!s) throw new Error("세션이 없어요");
    if (!force && this.paused) throw new Error("사용량 한도로 일시정지 중이에요. 남은 작업은 티켓으로 저장됐고, 초기화되면 이어서 진행해요.");
    this.push(s, { kind: "user", text });
    const r = this.rt(id);
    if (this.shouldRotate(s)) return this.rotate(s, text);
    if (s.provider === "claude" && r.proc) {
      r.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
      this.touch(s, { status: "running" });
    } else if (s.provider === "openai" && r.proc) {
      throw new Error("Codex는 응답이 끝난 뒤에 다음 메시지를 보낼 수 있어요");
    } else if (s.provider === "gemini" && r.proc) {
      throw new Error("Gemini는 응답이 끝난 뒤에 다음 메시지를 보낼 수 있어요");
    } else {
      this.start(s, text);
    }
  }

  /** Idle (between turns) and past the turn budget since its CLI session started. */
  shouldRotate(s) {
    const after = s.canSpawn ? this.team().rotateLead : this.team().rotateOthers;
    return after > 0 && !!s.providerSessionId && (s.turnsSinceRotate ?? s.turns ?? 0) >= after
      && (s.status === "idle" || s.status === "error");
  }

  /** Ends the current CLI session and starts a fresh one with a handoff note plus `text`. */
  rotate(s, text) {
    const r = this.rt(s.id);
    const old = r.proc;
    r.proc = null; // the exit handler ignores a process that is no longer current
    r.perms.clear();
    old?.kill("SIGTERM");
    const kids = this.sessions.filter(c => c.parent === s.id && !["done"].includes(c.status));
    const team = kids.length
      ? `\n\n[팀원]\n${kids.map(c => `- ${c.name} (${c.roleName}, id ${c.id}, ${c.status}${c.branch ? `, 브랜치 ${c.branch}` : ""}): ${clip(c.last || "", 160)}`).join("\n")}`
      : "";
    const last = clip(r.lastText || s.last || "", 2500);
    const note = `[Dispatch] 컨텍스트를 줄이려고 ${s.turnsSinceRotate ?? s.turns}턴 만에 새 CLI 세션으로 이어 간다. 이전 대화는 이 세션에 없다. 필요한 상태는 작업 폴더·브랜치·git log·docs로 다시 확인하라.\n\n[직전 내 응답]\n${last || "(없음)"}${team}\n\n[이어서 할 일]\n${text}`;
    this.push(s, { kind: "info", text: `새 세션으로 이어 감 (${s.turnsSinceRotate ?? s.turns}턴, 대화 요약을 넘김)` });
    s.rotations = (s.rotations ?? 0) + 1;
    s.providerSessionId = null;
    s.turnsSinceRotate = 0;
    this.start(s, note);
  }

  interrupt(id) {
    const s = this.get(id), r = this.live.get(id);
    if (!s || !r?.proc) return;
    this.handoffOnInterrupt(s);
    if (s.provider === "claude") {
      r.proc.stdin.write(JSON.stringify({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } }) + "\n");
    } else {
      r.proc.kill("SIGINT");
    }
  }

  /**
   * On interrupt, hand the lead a short note of what this teammate was doing, so the lead reads a
   * one-line summary instead of the whole transcript. Held as a pending report (delivered now, or
   * after the pause); skipped for a lead's own session.
   */
  handoffOnInterrupt(s) {
    const r = this.live.get(s.id);
    if (!r || s.canSpawn || !s.parent) return;
    const doing = clip(r.lastText || "", 600) || (r.lastTool ? `도구 실행 중: ${r.lastTool}` : "작업 진행 중");
    r.pendingReport = `[${s.name}(${s.roleName}) 중단${s.branch ? ` · ${s.branch}` : ""}] 턴 중간에 멈췄다. 하던 일:\n${doing}\n(재개하려면 이 세션에 지시를 보내면 된다. 전체 대화를 다시 읽지 말고 이 요약과 git diff/log로 상태를 파악하라.)`;
    r.lastText = null;
    this.deliverReport(s);
  }

  kill(id) {
    const s = this.get(id), r = this.live.get(id);
    if (!s) return;
    s._killed = true;
    r?.proc?.kill("SIGTERM");
    r?.perms.clear();
    this.touch(s, { status: "done" });
  }

  remove(id) {
    const gone = this.get(id);
    this.kill(id);
    delete this.store.data.sessions[id];
    // Its board goes with it: a removed lead can no longer close its tasks.
    for (const bag of [this.store.data.tasks, this.store.data.tickets])
      for (const [k, v] of Object.entries(bag || {})) if (v.lead === id) delete bag[k];
    this.live.delete(id);
    rmSync(this.tfile(id), { force: true });
    this.store.save();
    this.emit("removed", { id });
    // Its worktree goes too when nothing uncommitted is left in it; the branch stays.
    if (gone?.worktree && this.team().dropWorktrees) setTimeout(() => dropWorktree(this.root, gone.cwd).catch(() => {}), 1500);
    this.emit("tasks", this.tasks);
    this.emit("tickets", this.tickets);
  }

  respondPermission(id, requestId, behavior, always = false) {
    const s = this.get(id), r = this.live.get(id);
    const req = r?.perms.get(requestId);
    if (!s || !req || !r.proc) throw new Error("대기 중인 권한 요청이 없어요");
    const response = behavior === "allow"
      ? { behavior: "allow", updatedInput: req.input, ...(always && req.suggestions?.length ? { updatedPermissions: req.suggestions } : {}) }
      : { behavior: "deny", message: "사용자가 Dispatch에서 거부했어요" };
    r.proc.stdin.write(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: requestId, response } }) + "\n");
    r.perms.delete(requestId);
    this.push(s, { kind: "system", text: `${req.tool} ${behavior === "allow" ? (always ? "항상 허용" : "허용") : "거부"}` });
    this.touch(s, { status: r.perms.size ? "waiting" : "running" });
  }

  // Claude: a live process switches at once through the control protocol; otherwise the next turn starts with it.
  // Codex: the sandbox follows the mode from the next turn.
  setPerm(id, perm) {
    const s = this.get(id), r = this.live.get(id);
    if (!s) throw Object.assign(new Error("세션이 없어요"), { status: 404 });
    if (!PERMS.includes(perm)) throw Object.assign(new Error("알 수 없는 권한 모드예요"), { status: 400 });
    if (s.provider === "claude" && r?.proc) {
      r.proc.stdin.write(JSON.stringify({ type: "control_request", request_id: randomUUID(),
        request: { subtype: "set_permission_mode", mode: perm } }) + "\n");
    }
    this.push(s, { kind: "system", text: `권한 모드 ${s.perm} → ${perm}` });
    this.touch(s, { perm });
  }

  // Attach a session to a lead after the fact (teams made before parents were set, or a lead replaced).
  // parent null detaches it.
  setParent(id, parent) {
    const s = this.get(id);
    if (!s) throw Object.assign(new Error("세션이 없어요"), { status: 404 });
    if (parent) {
      const p = this.get(parent);
      if (!p) throw Object.assign(new Error("관리자 세션이 없어요"), { status: 404 });
      if (p.id === s.id) throw Object.assign(new Error("자기 자신을 관리자로 둘 수 없어요"), { status: 400 });
      if (!p.canSpawn) throw Object.assign(new Error(`${p.name}은 관리자 역할이 아니에요`), { status: 400 });
      const active = this.sessions.filter(x => x.parent === p.id && x.id !== s.id && !["done", "error"].includes(x.status)).length;
      const max = this.team().maxChildren;
      if (active + 1 > max) throw Object.assign(new Error(`관리자 한 명이 동시에 둘 수 있는 세션은 ${max}개까지예요 (현재 ${active}개)`), { status: 400 });
    }
    this.touch(s, { parent: parent || null });
    this.deliverReport(s);
  }

  // A child asks or tells its lead something mid-turn (message_lead tool).
  messageLead(id, text) {
    const s = this.get(id);
    if (!s) throw Object.assign(new Error("세션이 없어요"), { status: 404 });
    const p = s.parent && this.get(s.parent);
    if (!p || p.status === "done") throw Object.assign(new Error("연결된 관리자가 없어요"), { status: 400 });
    if (!String(text).trim()) throw Object.assign(new Error("보낼 내용이 없어요"), { status: 400 });
    this.send(p.id, `[${s.name}(${s.roleName}) 메시지${s.branch ? ` · ${s.branch}` : ""}]\n${clip(text, 4000)}`);
  }

  // Resume every session a restart cut off mid-turn, once its provider is connected.
  resumeInterrupted() {
    for (const s of this.sessions) {
      if (!s.interrupted || !this.isConnected(s.provider) || this.paused) continue; // paused: the ticket resumes it
      s.interrupted = false;
      try { this.send(s.id, RESUME_TEXT); } catch { /* resumes on the next message instead */ }
    }
    this.store.save();
  }

  // Watchdog: retry undelivered reports, flag teammates no lead hears and teams idle for a long time.
  /* ---------------- Tickets: work saved when the usage limit is reached ---------------- */

  get tickets() {
    const cut = Date.now() - 3 * 86400_000;
    return Object.values(this.store.data.tickets ||= {})
      .filter(t => t.status === "open" || t.updatedAt > cut)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Which guard window is over its threshold now, if any. */
  limitHit() {
    const g = this.store.data.settings.guard;
    if (!g?.enabled) return null;
    const l = this.currentLimits();
    if (l.five != null && l.five >= g.five) return { key: `five:${l.fiveReset}`, reason: `5시간 한도 ${Math.round(l.five * 100)}%`, resetAt: l.fiveReset };
    if (l.seven != null && l.seven >= g.seven) return { key: `seven:${l.sevenReset}`, reason: `주간 한도 ${Math.round(l.seven * 100)}%`, resetAt: l.sevenReset };
    return null;
  }

  /**
   * At the guard threshold: save every unfinished board task (plus each lead's last word) as an
   * open ticket, once per limit window. After the reset, hand open tickets back to their leads.
   */
  checkTickets(now = Date.now()) {
    const all = (this.store.data.tickets ||= {});
    const hit = this.limitHit();
    if (hit && this.store.data.ticketedFor !== hit.key) {
      this.store.data.ticketedFor = hit.key;
      const open = this.tasks.filter(t => t.stage !== "done");
      const leads = new Set(open.map(t => t.lead).filter(Boolean));
      // A lead with running teammates but nothing on the board still gets one ticket.
      for (const s of this.sessions) if (s.canSpawn && this.sessions.some(c => c.parent === s.id && c.status === "running")) leads.add(s.id);
      for (const lead of leads) {
        const ls = this.get(lead);
        const items = open.filter(t => t.lead === lead);
        const id = randomUUID();
        all[id] = {
          id, lead, leadName: ls?.name ?? null, status: "open", reason: hit.reason, resetAt: hit.resetAt,
          createdAt: now, updatedAt: now,
          items: items.map(t => ({ title: t.title, stage: t.stage, owner: t.owner, note: t.note })),
          leadLast: clip(this.rt(lead).lastText || ls?.last || "", 1500),
          team: this.sessions.filter(c => c.parent === lead && c.status !== "done")
            .map(c => ({ name: c.name, status: c.status, branch: c.branch, last: clip(c.last || "", 200) })),
        };
      }
      this.store.save();
      this.emit("tickets", this.tickets);
      // Pause: interrupt every running turn so nothing keeps spending past the threshold.
      for (const s of this.sessions) {
        if (s.status === "running" || s.status === "starting" || s.status === "waiting") {
          this.push(s, { kind: "info", text: `사용량 한도(${hit.reason})로 일시정지 — 티켓으로 저장됨` });
          this.interrupt(s.id);
        }
      }
    }
    // While paused, a session that still runs (e.g. started before the hit was seen) is stopped too.
    if (hit) for (const s of this.sessions) if (s.status === "running" && !this.rt(s.id).pauseNoted) {
      this.rt(s.id).pauseNoted = true;
      this.interrupt(s.id);
    }
    if (!hit) for (const s of this.sessions) if (this.live.get(s.id)?.pauseNoted) this.rt(s.id).pauseNoted = false;
    // Reset passed and no limit is hit any more: resume.
    if (!hit) for (const t of Object.values(all)) {
      if (t.status === "open" && t.resetAt && t.resetAt <= now) this.resumeTicket(t.id);
    }
  }

  /** Sends a ticket back to its lead as the next instruction and marks it resumed. */
  resumeTicket(id) {
    const t = (this.store.data.tickets ||= {})[id];
    if (!t || t.status !== "open") return false;
    const lead = this.get(t.lead);
    const list = t.items.length
      ? t.items.map(i => `- ${i.title} (${i.stage}${i.owner ? `, ${i.owner}` : ""})${i.note ? `: ${i.note}` : ""}`).join("\n")
      : "(보드에 올린 작업 없음 — 아래 마지막 메모를 보고 이어 가라)";
    const team = t.team.length ? `\n\n[당시 팀원]\n${t.team.map(c => `- ${c.name} (${c.status}${c.branch ? `, ${c.branch}` : ""}): ${c.last}`).join("\n")}` : "";
    const text = `[Dispatch 티켓 재개] ${t.reason}에서 멈췄던 작업이다. 한도가 초기화됐으니 이어서 진행하라. 브랜치·git log로 상태를 다시 확인하고, 팀원이 정리됐으면 필요한 만큼 다시 만들어라.\n\n[남은 작업]\n${list}${team}\n\n[멈출 때 내 마지막 메모]\n${t.leadLast || "(없음)"}`;
    if (lead && lead.status !== "done") {
      try { this.send(lead.id, text, { force: true }); } catch { return false; }
    }
    t.status = lead && lead.status !== "done" ? "resumed" : "orphaned";
    t.updatedAt = Date.now();
    this.store.save();
    this.emit("tickets", this.tickets);
    return true;
  }

  closeTicket(id) {
    const t = (this.store.data.tickets ||= {})[id];
    if (!t) return;
    t.status = "closed";
    t.updatedAt = Date.now();
    this.store.save();
    this.emit("tickets", this.tickets);
  }

  checkTeams(now = Date.now()) {
    this.checkTickets(now);
    const leads = this.sessions.filter(s => s.canSpawn && isOpenStatus(s.status));
    for (const s of this.sessions) {
      if (this.live.get(s.id)?.pendingReport) this.deliverReport(s);
      let stall = null;
      if (isOpenStatus(s.status) && !s.canSpawn && !s.parent && leads.length) {
        stall = { reason: "관리자에 연결되지 않아 보고가 전달되지 않아요", since: s.startedAt };
      } else if (isOpenStatus(s.status) && s.canSpawn) {
        const team = [s, ...this.sessions.filter(x => x.parent === s.id && isOpenStatus(x.status))];
        const last = Math.max(...team.map(x => x.updatedAt));
        if (team.length > 1 && team.every(x => x.status === "idle") && now - last > STALL_MS) {
          stall = { reason: `팀 전체가 ${Math.round((now - last) / 60000)}분째 대기 중이에요. 사용자 확인을 기다리는지, 멈춘 것인지 확인하세요.`, since: last };
        }
      }
      if ((s.stall?.reason ?? null) !== (stall?.reason ?? null)) this.mark(s, { stall });
    }
  }

  // A child's turn ended: hand its last answer to the lead, so a lead that went idle wakes up instead of
  // waiting to poll. Children have no Dispatch tools of their own to report with.
  // A report waits in pendingReport until it reaches a lead: a session attached later, or a Codex lead
  // busy mid-turn, gets it from setParent() or the watchdog.
  reportToParent(s) {
    const r = this.live.get(s.id);
    if (!r?.lastText) return;
    r.pendingReport = `[${s.name}(${s.roleName}) 보고${s.branch ? ` · ${s.branch}` : ""}]\n${clip(r.lastText, 2500)}`;
    r.lastText = null;
    this.deliverReport(s);
  }

  deliverReport(s) {
    const r = this.live.get(s.id), parent = s.parent && this.get(s.parent);
    if (!r?.pendingReport || !parent || parent.status === "done") return;
    if (this.paused) return; // kept; delivered after the reset
    try { this.send(parent.id, r.pendingReport + this.boardNote(parent.id)); r.pendingReport = null; } catch { /* retried by checkTeams */ }
  }

  stopAll() {
    for (const r of this.live.values()) r.proc?.kill("SIGTERM");
  }

  /* ---------------- runners ---------------- */

  // Leads get the session-management tools; everyone else gets message_lead only.
  mcpEnv(s) {
    return s.canSpawn
      ? { DISPATCH_URL: `http://127.0.0.1:${this.port}`, DISPATCH_PARENT: s.id }
      : { DISPATCH_URL: `http://127.0.0.1:${this.port}`, DISPATCH_SELF: s.id, DISPATCH_MODE: "child" };
  }

  systemPrompt(s) {
    // A lead works in its own worktree; without the project folder spelled out it merged into its own branch.
    const where = s.canSpawn && s.worktree
      ? `\n\n[병합 위치] 너의 작업 폴더는 ${s.cwd} (브랜치 ${s.branch})이고 통합 브랜치가 아니다. 병합은 프로젝트 폴더 ${this.root}에서 한다: git -C ${this.root} merge --no-ff <브랜치> (또는 --ff-only). 병합 뒤 git -C ${this.root} log --oneline -1 로 통합 브랜치 HEAD를 확인하고 보고에 적는다.`
      : "";
    return [s.prompt, (s.canSpawn ? SPAWN_PROMPT : CHILD_PROMPT) + where, this.team().replyStyle ? replyStyle() : ""].filter(Boolean).join("\n\n");
  }

  start(s, prompt) {
    s._killed = false;
    // Turn clock and token baseline for the web "thinking" line.
    s.turnStartedAt = Date.now();
    s.turnTokensBase = s.usage.input + s.usage.output + s.usage.cacheRead + s.usage.cacheWrite;
    if (s.provider === "claude") this.startClaude(s, prompt);
    else if (s.provider === "gemini") this.startGemini(s, prompt);
    else this.startCodex(s, prompt);
  }

  attach(s, proc) {
    const r = this.rt(s.id);
    r.proc = proc;
    let stderr = "";
    proc.stderr.on("data", d => { stderr = (stderr + d).slice(-2000); });
    proc.on("error", e => {
      r.proc = null;
      this.touch(s, { status: "error", error: e.code === "ENOENT" ? "CLI를 찾을 수 없어요" : e.message });
    });
    proc.on("exit", code => {
      if (r.proc !== proc) return;
      r.proc = null;
      r.perms.clear();
      if (s._killed || s.status === "done") return this.touch(s, { status: "done" });
      if (code && code !== 130 && s.status !== "idle") {
        const err = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300) || `exit ${code}`;
        this.push(s, { kind: "error", text: err });
        return this.touch(s, { status: "error", error: err });
      }
      this.touch(s, { status: "idle" });
    });
  }

  startClaude(s, prompt) {
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
      "--model", s.model, "--permission-mode", s.perm, "--permission-prompt-tool", "stdio"];
    if (s.effort) args.push("--effort", s.effort);
    const system = this.systemPrompt(s);
    if (system) args.push("--append-system-prompt", system);
    if (s.providerSessionId) args.push("--resume", s.providerSessionId);
    // Dispatch's own tools are pre-approved; the server enforces the guard and the child-session cap.
    args.push("--mcp-config", JSON.stringify({ mcpServers: { dispatch: {
      command: process.execPath, args: [MCP_SCRIPT], env: this.mcpEnv(s) } } }),
      "--allowedTools", "mcp__dispatch");
    const proc = spawn("claude", args, { cwd: s.cwd, env: sessionEnv(), stdio: ["pipe", "pipe", "pipe"] });
    s._costBase = s.cost;
    this.attach(s, proc);
    onJsonLines(proc.stdout, m => this.onClaude(s, m));
    proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: prompt } }) + "\n");
    this.touch(s, { status: "running", error: null });
  }

  onClaude(s, m) {
    const r = this.rt(s.id);
    switch (m.type) {
      case "system":
        if (m.subtype === "init" && m.session_id) this.touch(s, { providerSessionId: m.session_id });
        break;
      case "assistant": {
        const msg = m.message || {};
        // One API message can arrive as several lines (one per content block); count usage once.
        if (msg.usage && msg.id && !r.seenMsgIds.has(msg.id)) {
          r.seenMsgIds.add(msg.id);
          const u = msg.usage;
          const delta = { input: u.input_tokens || 0, output: u.output_tokens || 0,
            cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
          for (const k in delta) s.usage[k] += delta[k];
          s.ctx = delta.input + delta.cacheRead + delta.cacheWrite + delta.output;
          this.store.addDaily(s.model, s.role, delta);
        }
        for (const c of msg.content || []) {
          if (c.type === "text" && c.text.trim()) { this.push(s, { kind: "assistant", text: c.text }); s.last = clip(c.text, 400); r.lastText = c.text; }
          else if (c.type === "tool_use") this.push(s, { kind: "tool", name: c.name, text: clip(JSON.stringify(c.input), 600) });
        }
        this.touch(s, { status: r.perms.size ? "waiting" : "running" });
        break;
      }
      case "user":
        for (const c of (Array.isArray(m.message?.content) ? m.message.content : [])) {
          if (c.type === "tool_result") {
            const text = Array.isArray(c.content) ? c.content.map(x => x.text || "").join("") : c.content;
            this.push(s, { kind: "tool_result", text: clip(text, 1500), error: !!c.is_error });
          }
        }
        break;
      case "control_request":
        if (m.request?.subtype === "can_use_tool") {
          const req = { requestId: m.request_id, tool: m.request.tool_name, input: m.request.input,
            description: m.request.description || "", suggestions: m.request.permission_suggestions || [] };
          r.perms.set(m.request_id, req);
          this.push(s, { kind: "perm", tool: req.tool, text: clip(JSON.stringify(req.input), 600), requestId: m.request_id });
          this.touch(s, { status: "waiting", last: `${req.tool} 권한을 요청했어요` });
        }
        break;
      case "rate_limit_event": {
        const w = m.rate_limit_info?.unifiedWindows || {};
        this.limits = {
          five: w.five_hour?.utilization ?? this.limits.five, fiveReset: w.five_hour?.resetsAt ? w.five_hour.resetsAt * 1000 : this.limits.fiveReset,
          seven: w.seven_day?.utilization ?? this.limits.seven, sevenReset: w.seven_day?.resetsAt ? w.seven_day.resetsAt * 1000 : this.limits.sevenReset,
          updatedAt: Date.now(),
        };
        this.store.data.limits = this.limits;
        this.store.save();
        this.emit("limits", this.limits);
        this.checkTickets();
        break;
      }
      case "result": {
        // total_cost_usd is cumulative for the CLI process; carry over what earlier processes spent.
        if (typeof m.total_cost_usd === "number") {
          const base = s._costBase ?? 0;
          const next = base + m.total_cost_usd;
          if (next > s.cost) { this.store.addDaily(s.model, s.role, { cost: next - s.cost }); s.cost = next; }
        }
        const win = Object.values(m.modelUsage || {})[0]?.contextWindow;
        if (win) s.ctxWindow = win;
        if (m.is_error) this.push(s, { kind: "error", text: clip(m.result || m.subtype, 400) });
        this.touch(s, { status: "idle", turns: s.turns + 1, turnsSinceRotate: (s.turnsSinceRotate ?? s.turns ?? 0) + 1 });
        this.reportToParent(s);
        break;
      }
    }
  }

  startCodex(s, prompt) {
    const sandbox = s.perm === "acceptEdits" || s.perm === "auto" ? "workspace-write" : "read-only";
    const first = !s.providerSessionId;
    const args = ["exec", ...(first ? [] : ["resume", s.providerSessionId]), "--json", "--skip-git-repo-check",
      "-m", s.model, "-c", `sandbox_mode="${sandbox}"`];
    if (s.effort) args.push("-c", `model_reasoning_effort="${s.effort}"`);
    {
      const env = Object.entries(this.mcpEnv(s)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(",");
      args.push("-c", `mcp_servers.dispatch.command=${JSON.stringify(process.execPath)}`,
        "-c", `mcp_servers.dispatch.args=[${JSON.stringify(MCP_SCRIPT)}]`,
        "-c", `mcp_servers.dispatch.env={${env}}`,
        "-c", `mcp_servers.dispatch.default_tools_approval_mode="approve"`);
    }
    // Codex has no system-prompt flag in exec mode, so the role prompt leads the first turn.
    const system = this.systemPrompt(s);
    args.push(first && system ? `[역할]\n${system}\n\n[작업]\n${prompt}` : prompt);
    const proc = spawn("codex", args, { cwd: s.cwd, env: sessionEnv(), stdio: ["ignore", "pipe", "pipe"] });
    this.attach(s, proc);
    onJsonLines(proc.stdout, m => this.onCodex(s, m));
    this.touch(s, { status: "running", error: null });
  }

  onCodex(s, m) {
    switch (m.type) {
      case "thread.started":
        this.touch(s, { providerSessionId: m.thread_id });
        break;
      case "item.completed": {
        const it = m.item || {};
        if (it.type === "agent_message") { this.push(s, { kind: "assistant", text: it.text }); s.last = clip(it.text, 400); this.rt(s.id).lastText = it.text; }
        else if (it.type === "command_execution") {
          this.push(s, { kind: "tool", name: "shell", text: clip(it.command, 600) });
          if (it.aggregated_output) this.push(s, { kind: "tool_result", text: clip(it.aggregated_output, 1500), error: it.exit_code !== 0 });
        } else if (it.type === "file_change") this.push(s, { kind: "tool", name: "edit", text: clip((it.changes || []).map(c => `${c.kind} ${c.path}`).join("\n"), 600) });
        else if (it.type === "mcp_tool_call") this.push(s, { kind: "tool", name: `${it.server}.${it.tool}`, text: clip(JSON.stringify(it.arguments), 600) });
        else if (it.type === "error") this.push(s, { kind: "system", text: clip(it.message, 400) });
        this.touch(s);
        break;
      }
      case "turn.completed": {
        const u = m.usage || {};
        const cached = u.cached_input_tokens || 0;
        const delta = { input: Math.max(0, (u.input_tokens || 0) - cached), output: (u.output_tokens || 0),
          cacheRead: cached, cacheWrite: u.cache_write_input_tokens || 0 };
        for (const k in delta) s.usage[k] += delta[k];
        s.ctx = (u.input_tokens || 0) + (u.output_tokens || 0);
        this.store.addDaily(s.model, s.role, delta);
        this.touch(s, { status: "idle", turns: s.turns + 1, turnsSinceRotate: (s.turnsSinceRotate ?? s.turns ?? 0) + 1 });
        this.reportToParent(s);
        break;
      }
      case "turn.failed":
        this.push(s, { kind: "error", text: clip(m.error?.message, 400) });
        this.touch(s, { status: "error", error: clip(m.error?.message, 300) });
        break;
      case "error":
        this.push(s, { kind: "error", text: clip(m.message, 400) });
        break;
    }
  }

  startGemini(s, prompt) {
    const mode = s.perm === "acceptEdits" || s.perm === "auto" ? "auto" : s.perm === "plan" ? "plan" : "auto";
    const first = !s.providerSessionId;
    const system = this.systemPrompt(s);
    const textPrompt = first && system ? `[역할]\n${system}\n\n[작업]\n${prompt}` : prompt;
    const args = [
      "-p", textPrompt,
      "--output-format", "stream-json",
      "--model", s.model,
      "--mode", mode,
      "--dangerously-skip-permissions",
    ];
    if (s.effort) args.push("--effort", s.effort);
    if (s.providerSessionId) args.push("--conversation", s.providerSessionId);

    const env = { ...process.env, ...this.mcpEnv(s) };
    const proc = spawn("agy", args, { cwd: s.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    this.attach(s, proc);
    onJsonLines(proc.stdout, m => this.onGemini(s, m));
    this.touch(s, { status: "running", error: null });
  }

  onGemini(s, m) {
    switch (m.event) {
      case "init":
        if (m.conversation_id) this.touch(s, { providerSessionId: m.conversation_id });
        break;
      case "step_update": {
        const su = m.step_update || {};
        if (su.step_type === "agent_response") {
          if (su.text_delta && su.text_delta.trim()) {
            this.push(s, { kind: "assistant", text: su.text_delta });
            s.last = clip(su.text_delta, 400);
            this.rt(s.id).lastText = su.text_delta;
          }
          if (su.usage) {
            const u = su.usage;
            const delta = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_tokens || 0, cacheWrite: 0 };
            for (const k in delta) s.usage[k] += delta[k];
            s.ctx = delta.input + delta.output;
            this.store.addDaily(s.model, s.role, delta);
          }
        } else if (su.step_type === "tool") {
          if (su.state === "ACTIVE") {
            const params = su.tool_info?.parameters || {};
            this.push(s, { kind: "tool", name: su.tool_name, text: clip(JSON.stringify(params), 600) });
          } else if (su.state === "DONE") {
            const out = su.tool_info?.output || "";
            this.push(s, { kind: "tool_result", text: clip(out, 1500), error: false });
          }
        }
        this.touch(s);
        break;
      }
      case "result": {
        const res = m.result || {};
        if (res.response && res.response.trim()) {
          s.last = clip(res.response, 400);
          this.rt(s.id).lastText = res.response;
        }
        if (res.status === "ERROR") {
          if (isQuotaError(res.error)) this.setGeminiQuota(res.error);
          this.push(s, { kind: "error", text: clip(res.error || "Turn failed", 400) });
          this.touch(s, { status: "error", error: clip(res.error || "Turn failed", 300) });
        } else {
          this.touch(s, { status: "idle", turns: s.turns + 1, turnsSinceRotate: (s.turnsSinceRotate ?? s.turns ?? 0) + 1 });
          this.reportToParent(s);
        }
        break;
      }
    }
  }
}
