import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { runCli, spawnCli } from "./cli.js";
import { redact } from "./redact.js";
import { permissionResponse } from "./permission-response.js";
import { branchStatus, dropWorktree, integrationBranch, prepareWorkdir, verifyMerged } from "./git.js";
import { defaultEta, enterStage } from "./tasks.js";
import { AUTO_CLOSE_STAGES, closeEvidence } from "./task-close.js";
import { NAMES } from "./roles.js";
import { MODE_IDS } from "./mode-profiles.js";
import { checkLane, etaHint, laneItems, recordRunTime } from "./lanes.js";
import { codexGuard, effectiveRoles, teamSettings } from "./settings.js";
import { codexLimits, geminiResetFrom, geminiUsage, SharedLimits } from "./limits.js";
import { recordState, trimToWindow, WINDOW_MS } from "../../shared/dispatch/timeline.ts";
import { askOf, attentionOf, ctxOver, ctxShare, longOver, mtokens, recordCheck, sessionState, sessionStuck, stuckSig, taskStuck } from "./state.js";
import { AGENT_COLORS, pickColor } from "./colors.js";
import { deriveFolder } from "./session-folder.js";
import { LiveTracker } from "./live.js";
import { issueNumber } from "./ledger.js";
import {
  mixin, badRequest, PROVIDERS, UNSUPPORTED_MODEL, PROVIDER_NAMES, checkPerm, checkEffort, MAX_TRANSCRIPT, RESUME_TEXT, isOpenStatus, clip, RESUME_ID, userContent, activityOf, maskedPerm,
} from "./hub-util.js";
import { HubAutoRemove } from "./hub-auto-remove.js";
import { HubTickets } from "./hub-tickets.js";
import { HubRunners } from "./hub-runners.js";
export { AGY_MODES, CODEX_SANDBOX, PROVIDERS, PROVIDER_NAMES, UNSUPPORTED_MODEL, activityOf, checkEffort, checkPerm, userContent } from "./hub-util.js";

export class Hub extends EventEmitter {
  constructor({ root, store, models, roles, port, limits, workspaceDir = null, spawnCli: spawner = spawnCli }) {
    super();
    // Every agent CLI starts through this (server/dispatch/cli.js); tests pass a fake.
    this.spawnCli = spawner;
    this.root = root;
    this.store = store;
    this.models = models;
    this.roles = roles;
    // The port is known only once the server listens: a number or a getter.
    this.portOf = typeof port === "function" ? port : () => port;
    // Claude limits and the Gemini quota are account-wide: shared by every server via ~/.atelier/limits.json.
    this.shared = limits || new SharedLimits();
    this.shared.on("change", () => { this.emit("limits", this.currentLimits()); this.checkTickets(); });
    this.live = new Map(); // id -> { proc, transcript, perms, seenMsgIds }
    // The live view per session (#728): metadata only, in memory, sent as throttled `live` events.
    this.liveView = new LiveTracker({ workspaceDir, emit: ev => this.emit("live", ev), known: id => !!this.get(id) });
    this.isConnected = () => true; // replaced by the server with the Dispatch-level connection check
    // Pipeline hooks (server/pipeline, E20). createGate(parent) -> refusal text or null: a lead whose plan
    // waits for approval may not create teammates. taskStepCheck(lead, step) -> refusal text or null.
    this.createGate = null;
    this.taskStepCheck = null;
    // E27: holdTeam(lead) -> true while the person stopped that lead's plan (멈추기): its team's reports and
    // restart resumes wait. ticketNote(lead) -> text added to a limit ticket's resume message, or "".
    this.holdTeam = null;
    // topFolders() -> paths of the workspace's top-level folders (set by index.js); a session's `folder` must be one.
    this.topFolders = null;
    this.ticketNote = null;
    // Wait before dropping a removed session's worktree, so its process has exited (tests set 0).
    this.dropDelayMs = 1500;

    // Transcripts live in memory only (a ring buffer per session); nothing is written to disk, so a
    // restart starts every session with an empty transcript. Resuming uses the CLI's own session id.

    // Sessions from a previous run have no process. Ones cut off mid-turn are resumed by resumeInterrupted().
    let colored = false;
    for (const s of Object.values(store.data.sessions)) {
      // Sessions from before cursor colours (E56) get theirs now, saved so a restart does not pick another.
      if (!AGENT_COLORS.includes(s.color)) { s.color = pickColor(this.sessions.map(x => x.color)); colored = true; }
      // A saved session of a provider that does not run stays readable but never resumes: not interrupted, done.
      if (!PROVIDERS.includes(s.provider)) {
        if (s.status !== "done" || s.interrupted) colored = true;
        s.status = "done"; s.interrupted = false;
        continue;
      }
      if (s.status === "running" || s.status === "waiting" || s.status === "starting") { s.status = "idle"; s.interrupted = true; }
    }
    // Sessions from before the folder field (E505c) get one from the plan they are still linked to, else null; saved so it stays.
    for (const s of Object.values(store.data.sessions)) {
      if (s.folder === undefined) { s.folder = deriveFolder(s, store.data.pipelines); colored = true; }
    }
    if (colored) store.save();
  }

  get port() { return this.portOf(); }
  get limits() { return this.shared.claude; }
  get sessions() { return Object.values(this.store.data.sessions); }
  get(id) { return this.store.data.sessions[id]; }
  /**
   * True while the session can still carry its team: it has a process, is mid-turn, waits for its auto-resume after a
   * restart (interrupted), or has run in this server run (Codex and Gemini start one process per turn, so they sit idle
   * without one between turns). A session saved idle before a restart that never ran since, or a done one, is not.
   */
  alive(id) {
    const s = this.get(id);
    if (!s || s.status === "done") return false;
    if (s.interrupted || ["running", "starting", "waiting"].includes(s.status)) return true;
    const r = this.live.get(id);
    return !!(r?.proc || r?.ran);
  }
  rt(id) {
    let r = this.live.get(id);
    if (!r) {
      this.live.set(id, r = { proc: null, transcript: [], seq: 0, perms: new Map(), seenMsgIds: new Set(), pendingReport: null,
        fails: new Map(), checks: new Map(), lastEventAt: Date.now() });
      // A repeat-fail flag survives a restart: seed its counter so the next failure continues the count.
      const st = this.get(id)?.stuck;
      if (st?.reason === "repeat-fail" && st.key) r.fails.set(st.key, { count: st.count, firstAt: st.sinceMs, lastAt: st.sinceMs, kind: st.kind ?? null });
    }
    return r;
  }

  /** Current team settings (설정 page), defaults seeded from the environment. */
  team() { return teamSettings(this.store); }

  publicSession(s) {
    const r = this.live.get(s.id);
    const busy = s.status === "running" || s.status === "starting";
    // The UI gets a masked copy; the raw input stays in r.perms for the allow answer.
    const pending = r ? [...r.perms.values()].map(maskedPerm) : [];
    // stateSince moves only on a change of state, so "사람 기다림 · 8분째" counts from the real start.
    const state = sessionState(s, pending.length);
    if (state !== s.state) { s.state = state; s.stateSince = Date.now(); }
    // Timeline history: `[at, state]` only, capped per session. Sessions from before it was kept start
    // from their current state.
    const h = (s.history ||= []);
    const before = h.length && h[h.length - 1][1];
    recordState(h, state, s.stateSince ?? Date.now());
    if (h[h.length - 1][1] !== before) this.store.save();
    const { history: _h, ...rest } = s;
    return { ...rest, pending, activity: busy ? r?.activity ?? null : null,
      attention: attentionOf(s, state, pending.length, s.stateSince), ...this.burn?.fields(s, this.sessions) };
  }

  /** State history of every session over the timeline window, `{ now, windowMs, sessions: { id: [[at, state], …] } }`. */
  timeline(now = Date.now(), windowMs = WINDOW_MS) {
    const sessions = {};
    for (const s of this.sessions) { this.publicSession(s); sessions[s.id] = trimToWindow(s.history || [], now, windowMs); }
    return { now, windowMs, sessions };
  }

  /** Re-sends sessions whose burn rate has moved with time alone (idle sessions decay to 0 $/h). */
  refreshBurn() {
    if (!this.burn) return;
    for (const s of this.burn.due(this.sessions)) this.emit("session", this.publicSession(s));
  }

  touch(s, patch = {}) {
    // A turn that ends by asking its reader something leaves the session waiting on a person, not resting.
    // Only on a real change of status: Codex/Gemini touch idle again when the process exits, after
    // reportToParent() has cleared lastText, and that must not wipe the question.
    // The question is read from this turn's answer only and kept as `ask`, so every view shows what to answer (#886).
    if (patch.status && patch.status !== s.status && !("asksUser" in patch)) {
      const r = this.live.get(s.id);
      // A new turn drops the previous turn's answer: a turn that ends without text must not re-ask an old question.
      if (r && patch.status === "running" && (s.status === "idle" || s.status === "error")) r.lastText = null;
      // Masked before it is clipped: a key cut at the clip edge would no longer look like a key.
      const ask = patch.status === "idle" ? askOf(r?.lastText && redact(r.lastText)) : "";
      patch.asksUser = !!ask;
      patch.ask = ask || null;
    }
    const prev = s.status;
    // Error and reply clips reach the UI and memory only after key- and email-shaped parts are masked.
    for (const k of ["error", "last"]) if (typeof patch[k] === "string") patch[k] = redact(patch[k]);
    Object.assign(s, patch, { updatedAt: Date.now() });
    // A removed session's process exits a moment after remove(); its late "done" must not reach the
    // UI, which would add the session back until the page is reloaded.
    if (this.get(s.id) !== s) return;
    // A finished turn ends its activity, so the next turn's clock starts fresh.
    if (patch.status && patch.status !== "running" && patch.status !== "starting") {
      const r = this.live.get(s.id);
      if (r) r.activity = null;
      this.liveView?.idle(s.id);
    }
    if (patch.status === "running" && patch.status !== prev) { const r = this.live.get(s.id); if (r) r.lastEventAt = Date.now(); }
    // A new turn, a permission request or a stop ends the auto-remove grace period.
    if (patch.status && patch.status !== "idle") this.cancelAutoRemove(s.id);
    if (patch.status === "error" && prev !== "error") this.noticeError(s);
    if (s.stuck && patch.status) this.refreshStuck(s, Date.now(), false);
    this.store.save();
    this.emit("session", this.publicSession(s));
  }

  push(s, entry) {
    const r = this.rt(s.id);
    // Everything in the ring buffer (and so everything the UI and the lead get) is masked first.
    if (typeof entry.text === "string") entry.text = redact(entry.text);
    entry.at = Date.now();
    // Per-session sequence number: the UI merges a loaded transcript with live events by it.
    entry.id = ++r.seq;
    r.lastEventAt = entry.at;
    if (s.stuck?.reason === "silent") this.refreshStuck(s, entry.at);
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
    this.liveView?.note(s, entry);
    r.transcript.push(entry);
    if (r.transcript.length > MAX_TRANSCRIPT) r.transcript.splice(0, r.transcript.length - MAX_TRANSCRIPT);
    this.emit("message", { id: s.id, entry });
  }

  transcript(id) { return this.get(id) ? this.rt(id).transcript : []; }

  /** The live view of one session (#728): `{ tool, recent, files }`, metadata only. */
  liveState(id) { return this.liveView ? this.liveView.snapshot(id) : { tool: null, recent: [], files: [] }; }

  // Patch without bumping updatedAt (watchdog flags must not look like activity).
  mark(s, patch) {
    Object.assign(s, patch);
    if (this.get(s.id) !== s) return; // removed: see touch()
    this.store.save();
    this.emit("session", this.publicSession(s));
  }

  /* ---------------- Stuck detection ---------------- */

  /** A check command (test, build, …) finished: count consecutive failures per normalised-command hash. */
  noteCheck(s, check, ok, now = Date.now()) {
    if (!check?.key) return;
    recordCheck(this.rt(s.id).fails, check.key, ok, now, check.kind);
    this.refreshStuck(s, now);
  }

  /**
   * Recomputes s.stuck. Emits only when the flag's identity changes (reason, command hash, …), so a
   * fourth failure of a loop already reported updates the count in place without a second event.
   */
  refreshStuck(s, now = Date.now(), emit = true) {
    const r = this.live.get(s.id);
    // Without a runtime (after a restart, before the session runs again) only a repeat-fail flag stays.
    const next = r ? sessionStuck(s, r, now, this.team())
      : isOpenStatus(s.status) && s.stuck?.reason === "repeat-fail" ? s.stuck : null;
    if (stuckSig(next) !== stuckSig(s.stuck)) {
      if (emit) this.mark(s, { stuck: next }); else s.stuck = next;
    } else if (next) Object.assign(s.stuck, next);
  }

  /** The session a task's owner names ("Juno" or "Juno(구현자)"), preferring an open one under the task's lead. */
  ownerSession(t) {
    const name = t.owner && String(t.owner).split(/[\s(·,/]/)[0];
    if (!name) return null;
    const hits = this.sessions.filter(x => x.name === name);
    return hits.find(x => x.parent === t.lead && isOpenStatus(x.status)) || hits.find(x => isOpenStatus(x.status)) || hits[0] || null;
  }

  taskStuckOf(t, now = Date.now()) {
    const owner = this.ownerSession(t);
    const busy = owner && (owner.status === "running" || owner.status === "starting");
    return taskStuck(t, owner, busy ? this.live.get(owner.id)?.activity : null, now, this.team());
  }

  /** Re-checks every open task's flag; one "tasks" event when any flag's identity changed. */
  checkTaskStuck(now = Date.now()) {
    let changed = false;
    for (const t of Object.values(this.store.data.tasks || {})) {
      const next = this.taskStuckOf(t, now);
      if (stuckSig(next) !== stuckSig(t.stuck)) { t.stuck = next; changed = true; }
      else if (next) Object.assign(t.stuck, next);
    }
    if (changed) { this.store.save(); this.emit("tasks", this.tasks); }
  }

  // A window whose reset time has passed is empty until Claude reports again; stale gauges must not block.
  currentLimits(now = Date.now()) {
    const l = { ...this.limits };
    if (l.fiveReset && l.fiveReset <= now) l.five = 0;
    if (l.sevenReset && l.sevenReset <= now) l.seven = 0;
    if (l.fableReset && l.fableReset <= now) l.fable = 0;
    return l;
  }

  setGeminiQuota(text) {
    this.shared.setGemini({ reached: true, reset: geminiResetFrom(text) })
      .catch(e => console.error("limits:", e.message))
      .finally(() => this.emit("limits", this.currentLimits()));
  }

  /**
   * Limits per provider for the top bar: Claude windows (and Fable's own weekly window once a Fable
   * turn reported it), Codex windows, Gemini reached/ok plus its windows from agy's /usage (#878).
   */
  async providerLimits(now = Date.now()) {
    const c = this.currentLimits(now);
    const g = this.shared.gemini;
    const geminiReached = !!g?.reached && (!g.reset || g.reset > now);
    return {
      claude: { windows: [
        { label: "5시간", used: c.five, reset: c.fiveReset },
        { label: "주간", used: c.seven, reset: c.sevenReset },
      ] },
      // Shown on its own once a Fable turn has reported it; null until then.
      fable: c.fable == null ? null : { windows: [{ label: "Fable 주간", used: c.fable, reset: c.fableReset }] },
      // ~/.codex/sessions is read only once the user has connected OpenAI Codex in Drawing.
      openai: this.isConnected("openai") ? (this.codexLast = await codexLimits()) : null,
      gemini: {
        reached: geminiReached, reset: geminiReached ? g.reset ?? null : null,
        // agy is started for /usage only once the user has connected Gemini (cached five minutes).
        windows: this.isConnected("gemini") ? ((await this.geminiUsage(runCli).catch(() => null))?.windows ?? []) : [],
      },
    };
  }

  /** Gemini's windows from agy's /usage (limits.js geminiUsage); a seam so tests can stub it. */
  geminiUsage(run) { return geminiUsage(run); }

  /** Reads Codex's windows again (cached for a minute by codexLimits) for providerHold. */
  async refreshCodex() {
    if (this.isConnected("openai")) this.codexLast = await codexLimits().catch(() => null);
  }

  /**
   * Per-provider usage hold for Codex and Gemini (Claude's windows hold every new turn through limitHit): a Codex
   * window at or over its threshold (guard.openai) or a reached Gemini quota refuses new turns of that provider only.
   */
  providerHold(provider, now = Date.now()) {
    const g = this.store.data.settings.guard;
    if (!g?.enabled) return null;
    if (provider === "openai") {
      const t = codexGuard(g);
      for (const w of this.codexLast?.windows || []) {
        const at = w.slot === "seven" ? t.seven : t.five;
        if (w.used != null && w.used >= at && (!w.reset || w.reset > now)) return `Codex ${w.label} 한도 ${Math.round(w.used * 100)}% — 차단 기준 이상이에요`;
      }
    }
    if (provider === "gemini") {
      const q = this.shared.gemini;
      if (q?.reached && (!q.reset || q.reset > now)) return "Gemini 한도에 닿았어요. 풀리면 다시 보낼 수 있어요.";
    }
    return null;
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
    const title = redact(String(input.title || "").trim()).slice(0, 120);
    // A step id ties the task to a step of the lead's approved plan; checked before anything changes.
    const step = input.step === undefined ? undefined : input.step ? String(input.step).trim() : null;
    if (step) {
      const why = this.taskStepCheck ? this.taskStepCheck(lead, step) : "실행 중인 계획이 없어요";
      if (why) throw Object.assign(new Error(why), { status: 409 });
    }
    let created = false;
    let t = (input.id && all[input.id]) || Object.values(all).find(x => x.lead === lead && x.title === title && x.stage !== "done");
    if (!t) {
      if (!title) throw new Error("title이 필요해요");
      // Closing work by creating a fresh "done" task left the real one open with a stale eta.
      const open = lead ? this.openTasks(lead) : [];
      if (input.stage === "done" && open.length) {
        throw Object.assign(new Error(`새 작업을 done으로 만들 수 없어요. 끝난 일은 기존 작업의 id로 닫으세요: ${open.map(x => `${x.title} (id ${x.id})`).join(", ")}`), { status: 400 });
      }
      const now = Date.now();
      t = { id: randomUUID(), lead, title, stage: "plan", createdAt: now, stageAt: now, stages: [{ stage: "plan", at: now }], owner: null, etaAt: null, note: "" };
      all[t.id] = t;
      created = true;
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
    if (stage) enterStage(t, stage);
    if (input.lane !== undefined) t.lane = checkLane(input.lane) ?? null;
    // A merged task is one past run of its lane; new tasks get an ETA hint from those (#768).
    if (stage === "done" && t.mergeCheck?.ok) {
      this.store.data.runTimes = recordRunTime(this.store.data.runTimes, { lane: t.lane, minutes: (Date.now() - t.createdAt) / 60_000 });
    }
    if (step !== undefined) t.step = step;
    if (input.owner !== undefined) t.owner = input.owner ? String(input.owner).slice(0, 60) : null;
    if (input.eta_minutes !== undefined) {
      t.etaAt = input.eta_minutes == null ? null : Date.now() + Math.max(0, Number(input.eta_minutes)) * 60_000;
      t.etaSetAt = t.etaAt ? Date.now() : null;
      t.etaEstimated = false;
    } else if (stage || created) {
      // A new stage without eta_minutes: estimate from finished tasks of this project (#1028).
      defaultEta(t, Object.values(all));
    }
    if (t.stage === "done") { t.etaAt = null; t.etaEstimated = false; }
    if (input.note !== undefined) t.note = redact(String(input.note || "")).slice(0, 200);
    t.updatedAt = Date.now();
    t.stuck = this.taskStuckOf(t);
    this.store.save();
    this.emit("tasks", this.tasks);
    return t;
  }

  /**
   * Moves open tasks whose work already landed to done (#930): commit on the integration branch, a merged PR tied
   * to the task, or a closed issue it names (task-close.js). The evidence goes to `mergeCheck`; a task without any
   * keeps its stage and gets `autoCheck.reason`. `issues` is index.js's createIssueList (null: commit check only).
   * One run at a time; returns the ids it closed.
   */
  async autoCloseTasks(issues = null) {
    if (this.autoClosing) return [];
    this.autoClosing = true;
    try {
      // Tasks of a removed lead are included: no one is left to close them, and they still pile up in the store.
      const open = Object.values(this.store.data.tasks || {}).filter(t => AUTO_CLOSE_STAGES.has(t.stage));
      if (!open.length) return [];
      let prs = null;
      if (issues?.allPrs) {
        const r = await issues.allPrs().catch(() => null);
        prs = r?.ok ? r.prs : null;
      }
      const issueState = issues?.issueState ? n => issues.issueState(n).catch(() => null) : async () => null;
      const verify = c => verifyMerged(this.root, c);
      let base = null;
      const branchState = async b => {
        // A leading "-" would read as an option to git.
        if (typeof b !== "string" || !b || b.startsWith("-")) return null;
        base ??= await integrationBranch(this.root);
        return (await branchStatus(this.root, b, base).catch(() => null))?.state ?? null;
      };
      const closed = [];
      let changed = false;
      for (const t of open) {
        const ev = await closeEvidence(t, { verify, branchState, prs, issueState });
        // The lead may have moved the task while gh or git answered.
        if (!AUTO_CLOSE_STAGES.has(t.stage)) continue;
        const now = Date.now();
        if (ev.ok) {
          t.mergeCheck = { ok: true, commit: ev.commit ?? null, base: ev.base ?? null, reason: null, auto: true, via: ev.via, evidence: ev.evidence, at: now };
          enterStage(t, "done", now);
          t.etaAt = null;
          t.stuck = null;
          delete t.autoCheck;
          t.updatedAt = now;
          closed.push(t.id);
          changed = true;
        } else if (t.autoCheck?.reason !== ev.reason) {
          t.autoCheck = { reason: ev.reason, at: now };
          changed = true;
        }
      }
      if (changed) { this.store.save(); this.emit("tasks", this.tasks); }
      return closed;
    } finally {
      this.autoClosing = false;
    }
  }

  /** Median and slowest minutes of past merged runs in `lane` (#768), or null before the first one. */
  etaHint(lane) { return etaHint(this.store.data.runTimes, lane || undefined); }

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
    const guess = t => (t.etaEstimated ? "(예상)" : "");
    const left = t => !t.etaAt ? "예상 없음" : t.etaAt < now ? `${Math.round((now - t.etaAt) / 60000)}분 지연${guess(t)}` : `${Math.round((t.etaAt - now) / 60000)}분 남음${guess(t)}`;
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
    if (limits.five != null && limits.five >= g.five) return `Claude 5시간 한도 ${Math.round(limits.five * 100)}% — 차단 기준 이상이에요`;
    if (limits.seven != null && limits.seven >= g.seven) return `Claude 주간 한도 ${Math.round(limits.seven * 100)}% — 차단 기준 이상이에요`;
    // Fable has its own weekly window; its own threshold (`fable`, else the weekly one).
    if (limits.fable != null && limits.fable >= (g.fable ?? g.seven)) return `Fable 주간 한도 ${Math.round(limits.fable * 100)}% — 차단 기준 이상이에요`;
    return null;
  }

  /* ---------------- create ---------------- */

  // items: [{ role, model, effort, perm, prompt, n, mode }]. `mode` (per item, else the call's) picks the harness
  // profile of that mode (#748, mode-profiles.js); an item's own model, effort and perm still win over it.
  // `lane` (#768, lanes.js): quickfix skips the plan gate, refuses reviewer/tester roles and defaults to the quickfix mode.
  // `images` (#968, checked by routes.js) go with the first message of a single Claude session (the chat's helper).
  // An item's `resume` is a saved CLI session id: the session continues that conversation (`claude --resume`).
  async create({ items, commonPrompt, worktree = true, parent = null, folder, mode, lane, images = null }) {
    const total = items.reduce((a, x) => a + (x.n || 1), 0);
    if (!total) throw new Error("만들 세션이 없어요");
    if (images?.length && total > 1) throw badRequest("이미지는 세션 하나에만 보낼 수 있어요");
    for (const it of items) if (it.resume != null && !RESUME_ID.test(String(it.resume))) throw badRequest("이어 갈 대화 id가 올바르지 않아요");
    items = laneItems(items, lane, mode);
    const gate = parent && checkLane(lane) !== "quickfix" && this.createGate?.(parent);
    if (gate) throw Object.assign(new Error(gate), { status: 409 });
    items = await Promise.all(items.map(it => this.applyProfile(it, it.mode ?? mode)));
    const roles = effectiveRoles(this.roles, this.store, this.models);
    // The model of an item: its own, else its role's. Unknown models and roles are refused before anything starts.
    const modelOf = it => {
      const id = it.model || roles.find(r => r.id === it.role)?.model;
      const model = this.models.find(m => m.id === id);
      if (!model) throw badRequest(`알 수 없는 모델: ${String(id ?? "").slice(0, 60)}`);
      return model;
    };
    if (items.some(it => { try { return modelOf(it).provider === "openai"; } catch { return false; } })) await this.refreshCodex();
    for (const it of items) {
      if (!roles.some(r => r.id === it.role)) throw badRequest(`알 수 없는 역할: ${it.role}`);
      const { provider } = modelOf(it);
      if (provider !== "claude" && (images?.length || it.resume != null)) throw badRequest("이미지와 대화 이어 가기는 Claude 세션만 돼요");
      if (!this.isConnected(provider)) throw new Error(`${PROVIDER_NAMES[provider] ?? provider}가 Drawing에 연결되지 않았어요. 연결하기에서 먼저 연결하세요.`);
      const hold = this.providerHold(provider);
      if (hold) throw Object.assign(new Error(hold), { status: 409 });
    }
    // A folder is a top-level workspace folder that exists; without one the session inherits its parent's.
    const top = await this.resolveFolder(folder, parent);
    // Check every item's mode and effort before anything starts, so a bad item makes nothing.
    for (const it of items) {
      const role = roles.find(r => r.id === it.role);
      const model = modelOf(it);
      checkPerm(model.provider, it.perm || role.perm);
      checkEffort(model, it.effort);
    }
    // The limit gauges come from Claude, so they only gate Claude sessions.
    const blocked = items.some(it => modelOf(it).provider === "claude") && this.guardCheck(total);
    if (blocked) throw new Error(blocked);
    if (parent) {
      const active = this.sessions.filter(s => s.parent === parent && !["done", "error"].includes(s.status)).length;
      const max = this.team().maxChildren;
      if (active + total > max) throw new Error(`관리자 한 명이 동시에 둘 수 있는 세션은 ${max}개까지예요 (현재 ${active}개)`);
    }

    const made = [];
    for (const it of items) {
      const role = roles.find(r => r.id === it.role);
      const model = modelOf(it);
      for (let k = 0; k < (it.n || 1); k++) {
        const n = ++this.store.data.seq;
        const slug = `${role.id}-${n}`;
        const wd = await prepareWorkdir(this.root, slug, worktree, { shareDeps: this.team().shareDeps, ...(this.store.layout && { worktrees: this.store.layout.worktrees }) });
        const s = this.newSession({ n, role, model, it, wd, parent, folder: top });
        this.store.data.sessions[s.id] = s;
        if (wd.warning) this.push(s, { kind: "system", text: wd.warning });
        if (it.profileNote) this.push(s, { kind: "system", text: `모드 프로필: ${it.profileNote}` });
        const first = it.task || commonPrompt;
        const shown = images?.length ? [first, `[이미지 ${images.length}장]`].filter(Boolean).join("\n") : first;
        this.push(s, { kind: "user", text: shown, label: parent ? "관리자 지시" : "공통 프롬프트" });
        this.touch(s);
        this.start(s, first, images);
        made.push(s);
      }
    }
    return made.map(s => this.publicSession(s));
  }

  /** A fresh session record (not stored yet): `wd` is its work folder { cwd, branch, worktree }. */
  newSession({ n, role, model, it, wd, parent, folder }) {
    return {
      id: randomUUID(), n, name: this.pickName(n), role: role.id, roleName: role.name,
      color: pickColor(this.sessions.map(x => x.color)),
      provider: model.provider, model: model.id, modelLabel: model.label,
      effort: it.effort || null, perm: it.perm || role.perm,
      // The account label of the provider connection as it is now (#747): a snapshot, never an email or id.
      accountLabel: this.accountLabel?.(model.provider) ?? null, issue: issueNumber(it.issue),
      ...(it.mode && { mode: it.mode }), ...(it.lane && { lane: it.lane }), ...(it.profileNote && { profileNote: it.profileNote }),
      prompt: it.prompt ?? role.prompt, canSpawn: !!role.canSpawn,
      cwd: wd.cwd, branch: wd.branch, worktree: wd.worktree, parent, folder,
      status: "starting", startedAt: Date.now(), updatedAt: Date.now(),
      last: "", turns: 0, ctx: 0, ctxWindow: model.contextWindow,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: model.provider === "claude" ? 0 : null,
      providerSessionId: it.resume != null && model.provider === "claude" && RESUME_ID.test(String(it.resume)) ? String(it.resume) : null,
      error: null,
    };
  }

  /**
   * An item with its mode's profile filled in (#748): only when a known mode is named and the item names no model.
   * The item's own effort and perm win; `profileNote` keeps the fallback reason (metadata only).
   */
  async applyProfile({ mode: _m, profileNote: _n, ...it }, mode) {
    if (!MODE_IDS.includes(mode)) return it;
    if (it.model || !this.resolveProfile) return { ...it, mode };
    const p = await this.resolveProfile(mode, it.role, { perm: it.perm });
    if (!p) return { ...it, mode };
    return { ...it, mode, model: p.model, effort: it.effort || p.effort || undefined, perm: it.perm || p.perm, ...(p.note && { profileNote: p.note }) };
  }

  /** The folder a new session gets: the asked-for top folder (must exist, else 400), else the parent's, else null. */
  async resolveFolder(folder, parent) {
    if (folder != null && folder !== "") {
      const paths = typeof folder === "string" && this.topFolders ? await this.topFolders() : [];
      if (!paths.includes(folder)) throw Object.assign(new Error("folder는 워크스페이스에 있는 프로젝트 폴더여야 해요"), { status: 400 });
      return folder;
    }
    const p = parent && this.get(parent);
    return p?.folder ?? null;
  }

  /** Cost and tokens of one project folder's sessions, from the sessions' own counters. */
  folderUsage(folder) {
    const mine = this.sessions.filter(s => (s.folder ?? null) === folder);
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let cost = 0;
    for (const s of mine) {
      cost += s.cost || 0;
      for (const k in tokens) tokens[k] += s.usage?.[k] || 0;
    }
    return { folder, sessions: mine.length, cost, tokens };
  }

  /* ---------------- control ---------------- */

  /** True while a guard window is over its threshold: no new turns until the reset. */
  get paused() { return !!this.limitHit(); }

  send(id, text, { force = false, images = null } = {}) {
    const s = this.get(id);
    if (!s) throw Object.assign(new Error("세션이 없어요"), { status: 404 });
    if (images?.length && s.provider !== "claude") throw Object.assign(new Error("이미지는 Claude 세션에만 보낼 수 있어요"), { status: 400 });
    if (!force && this.paused) throw new Error("사용량 한도로 일시정지 중이에요. 남은 작업은 티켓으로 저장됐고, 초기화되면 이어서 진행해요.");
    if (s.provider === "openai") void this.refreshCodex(); // fresh windows for the next turn's hold check
    const blocked = this.runBlock(s); // before anything is recorded or started
    if (blocked) throw new Error(blocked);
    const r = this.rt(id);
    // Notices for a lead (auto-removed teammates, kept worktrees) ride on its next message; put back if it
    // does not go out.
    const notes = r.leadNotes?.length ? r.leadNotes.splice(0) : [];
    if (notes.length) text = `${text}\n\n${notes.join("\n")}`;
    try { this.deliver(s, r, text, images); } catch (e) { r.leadNotes = [...notes, ...(r.leadNotes || [])]; throw e; }
    // Whoever writes to a teammate in its grace period keeps it: the auto-remove timer stops once the
    // message went out. A refused message (a running Codex or Gemini turn) leaves the timer armed.
    this.cancelAutoRemove(id);
  }

  deliver(s, r, text, images = null) {
    // Past the length guard (#969): the message goes to a fresh session instead, with the handoff in front.
    if (this.replaceDue(s) && this.replaceSession(s, { text, images })) return;
    // A pending length-guard note is attached here and cleared only on a path that delivers the message.
    const pend = s.longPending;
    if (pend) text = `${text}\n\n${pend}`;
    const sent = () => { if (pend && s.longPending === pend) s.longPending = null; };
    // Images (#968) go to the CLI only; the transcript keeps a count, never the bytes.
    this.push(s, { kind: "user", text: images?.length ? [text, `[이미지 ${images.length}장]`].filter(Boolean).join("\n") : text });
    if (this.shouldRotate(s)) { sent(); return this.rotate(s, text, images); }
    if (s.provider === "claude" && r.proc) {
      r.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: userContent(text, images) } }) + "\n");
      sent();
      this.touch(s, { status: "running" });
    } else if (s.provider === "openai" && r.proc) {
      throw new Error("Codex는 응답이 끝난 뒤에 다음 메시지를 보낼 수 있어요");
    } else if (s.provider === "gemini" && r.proc) {
      throw new Error("Gemini는 응답이 끝난 뒤에 다음 메시지를 보낼 수 있어요");
    } else {
      this.start(s, text, images);
    }
  }

  /**
   * Why a saved session cannot run now, or null: its provider is unsupported or no longer connected
   * in Drawing, or its model is not in the model list (a disconnected provider, or a model that is gone).
   */
  runBlock(s) {
    if (!PROVIDERS.includes(s.provider)) return UNSUPPORTED_MODEL;
    const name = PROVIDER_NAMES[s.provider];
    if (!this.isConnected(s.provider)) return `${name}가 Drawing에 연결되지 않았어요. 연결하기에서 먼저 연결하세요.`;
    if (!this.models.some(m => m.id === s.model && m.provider === s.provider)) return `${String(s.model ?? "").slice(0, 60)} 모델을 지금은 쓸 수 없어요. ${name} 연결과 모델 목록을 확인하세요.`;
    return this.providerHold(s.provider);
  }

  /** Idle (between turns) and past the turn budget, or over the context guard, since its CLI session started. */
  shouldRotate(s) {
    if (!s.providerSessionId || (s.status !== "idle" && s.status !== "error")) return false;
    if (ctxOver(s, this.team())) return true;
    const after = s.canSpawn ? this.team().rotateLead : this.team().rotateOthers;
    return after > 0 && (s.turnsSinceRotate ?? s.turns ?? 0) >= after;
  }

  /**
   * Context guard. Turn-count rotation only runs between turns, so a session that keeps one turn going
   * (a lead's follow-ups land mid-turn) can fill its window with no warning. Once a session crosses
   * `ctxHandoff`: flag it (attention, lead's list_sessions), and tell a running Claude session once,
   * mid-turn, to commit and wrap up. Its next message then starts a fresh CLI session (shouldRotate).
   */
  checkCtx(s, now = Date.now()) {
    if (!ctxOver(s, this.team())) return;
    const pct = Math.round(ctxShare(s) * 100);
    if (!s.ctxHigh) this.mark(s, { ctxHigh: { pct, sinceMs: now } });
    else s.ctxHigh.pct = pct;
    const r = this.live.get(s.id);
    if (r?.ctxNoticed || s.provider !== "claude" || !r?.proc || s.status !== "running") return;
    r.ctxNoticed = true;
    const text = `[Dispatch] 컨텍스트를 ${pct}% 썼다. 새 조사·탐색은 시작하지 마라. 지금까지 한 일을 커밋하고, 끝낸 것·남은 것·다음 단계를 짧게 정리해 답하고 이 턴을 끝내라. 다음 지시는 새 CLI 세션에서 이어 받는다.`;
    this.push(s, { kind: "info", text: `컨텍스트 ${pct}%: 마무리하고 새 세션으로 넘기라고 알렸어요` });
    r.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
  }

  /**
   * Session length guard (issue #29). Rotation keeps each call's context small, but a session kept for
   * hundreds of turns still costs a re-read per call and drifts. Past `handoffMTokens` total tokens:
   * flag it (attention, list_sessions), and say once who should act. A teammate's lead is told to stop it
   * and give the rest to a fresh teammate. A lead is told to write a handover and ask for a fresh lead:
   * mid-turn through stdin when it is running (Claude), otherwise with its next message.
   */
  checkLong(s, now = Date.now()) {
    if (!longOver(s, this.team())) return;
    const mtok = Math.round(mtokens(s));
    if (!s.longRun) this.mark(s, { longRun: { mtok, sinceMs: now, noticed: false } });
    else s.longRun.mtok = mtok;
    // `noticed` is saved with the session, so a server restart does not repeat the notice.
    if (s.longRun.noticed) return;
    s.longRun.noticed = true;
    this.store.save();
    if (s.parent) {
      // Rides on the teammate's next report: no extra turn for the lead, nothing to retry when it is busy.
      s.longNote = `[Dispatch] ${s.name}(${s.roleName ?? s.role}) 세션이 누적 ${mtok}M 토큰을 넘었다. 지금 맡은 단계가 끝나면 stop_session(remove: true)으로 정리하고, 남은 일은 브랜치·커밋·다음 할 일만 적어 새 팀원에게 맡겨라. 이 세션에 새 일을 이어 붙이지 마라.${this.team().autoRotateLong ? " 이 세션에 다시 지시하면 시스템이 같은 설정의 새 팀원으로 바꿔 그 지시를 넘긴다." : ""}`;
      this.push(s, { kind: "info", text: `누적 ${mtok}M 토큰: 다음 보고에 새 팀원으로 바꾸라는 안내를 붙여요` });
      return;
    }
    let text = `[Dispatch] 이 세션이 누적 ${mtok}M 토큰을 넘었다. 새 일을 시작하지 마라. 남은 일을 40줄 이내로 인계(작업마다 담당·브랜치·커밋·단계·다음 할 일)해 답하고, 새 ${s.canSpawn ? "관리자" : "세션"}로 바꿔 달라고 요청하며 이 턴을 끝내라.`;
    if (this.team().autoRotateLong) text = `[Dispatch] 이 세션이 누적 ${mtok}M 토큰을 넘었다. 새 일을 시작하지 마라. 남은 일을 40줄 이내로 인계(작업마다 담당·브랜치·커밋·단계·다음 할 일)해 답하고 이 턴을 끝내라. 턴이 끝나면 시스템이 이 인계를 붙여 같은 설정의 새 ${s.canSpawn ? "관리자" : "세션"}로 바꾼다.`;
    this.push(s, { kind: "info", text: `누적 ${mtok}M 토큰: 인계하고 새 세션으로 바꾸라고 알렸어요` });
    const r = this.live.get(s.id);
    if (s.provider === "claude" && r?.proc && s.status === "running") {
      r.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
    } else {
      s.longPending = text; // goes out with the next delivered message, so an idle session is not woken for it
    }
  }

  /** What a handoff carries over: the session's last answer and its open teammates (rotate, replaceSession). */
  handoffParts(s, lastText) {
    const kids = this.sessions.filter(c => c.parent === s.id && !["done"].includes(c.status));
    const team = kids.length
      ? `\n\n[팀원]\n${kids.map(c => `- ${c.name} (${c.roleName}, id ${c.id}, ${c.status}${c.branch ? `, 브랜치 ${c.branch}` : ""}): ${clip(c.last || "", 160)}`).join("\n")}`
      : "";
    return { last: clip(lastText || s.last || "", 2500), team };
  }

  /** Ends the current CLI session and starts a fresh one with a handoff note plus `text`. */
  rotate(s, text, images = null) {
    const r = this.rt(s.id);
    const old = r.proc;
    r.proc = null; // the exit handler ignores a process that is no longer current
    r.perms.clear();
    old?.kill("SIGTERM");
    const { last, team } = this.handoffParts(s, r.lastText);
    const why = s.ctxHigh ? `컨텍스트를 ${s.ctxHigh.pct}% 써서` : `컨텍스트를 줄이려고 ${s.turnsSinceRotate ?? s.turns}턴 만에`;
    const note = `[Dispatch] ${why} 새 CLI 세션으로 이어 간다. 이전 대화는 이 세션에 없다. 필요한 상태는 작업 폴더·브랜치·git log·docs로 다시 확인하라.\n\n[직전 내 응답]\n${last || "(없음)"}${team}\n\n[이어서 할 일]\n${text}`;
    this.push(s, { kind: "info", text: s.ctxHigh
      ? `새 세션으로 이어 감 (컨텍스트 ${s.ctxHigh.pct}%, 대화 요약을 넘김)`
      : `새 세션으로 이어 감 (${s.turnsSinceRotate ?? s.turns}턴, 대화 요약을 넘김)` });
    s.rotations = (s.rotations ?? 0) + 1;
    s.providerSessionId = null;
    s.turnsSinceRotate = 0;
    s.ctx = 0;
    s.ctxHigh = null;
    r.ctxNoticed = false;
    this.start(s, note, images);
  }

  /* ---------------- Auto-replace long sessions (#969) ---------------- */

  /**
   * True when `s` should be swapped for a fresh session now: the auto swap is on, it is past `handoffMTokens`, it is
   * between turns (idle, no permission asked), it can run (provider, model, limits) and, for a teammate, its lead was
   * already told to replace it (the swap then comes with the teammate's next turn).
   */
  replaceDue(s) {
    const t = this.team();
    if (!s || !t.autoRotateLong || !longOver(s, t) || s.status !== "idle" || s._killed) return false;
    const r = this.live.get(s.id);
    if (r?.replacing || r?.perms?.size || s.asksUser) return false;
    if (s.parent && !s.longRun?.told) return false;
    if (this.paused || this.runBlock(s) || this.holdTeam?.(s.parent ?? s.id)) return false;
    if (s.provider === "claude" && this.guardCheck(1)) return false;
    return true;
  }

  /** A turn ended: report to the lead, then swap a lead (or a session without one) that is past the length guard. */
  endTurn(s) {
    const last = this.live.get(s.id)?.lastText ?? null;
    this.reportToParent(s);
    if (!s.parent && this.replaceDue(s)) this.replaceSession(s, { last });
  }

  /**
   * Swaps `old` for a fresh session with the same role, model, effort, perm, work folder, branch, parent and project
   * folder (#969). The new one starts with the rotate handoff (last answer, open teammates) plus `text`; teammates,
   * board tasks, tickets and plans move to it; `old` is removed with its worktree kept (the new session works in it).
   * Returns the new session, or null when it could not be made (the old one stays).
   */
  replaceSession(old, { last = null, text = null, images = null } = {}) {
    const r = this.rt(old.id);
    if (r.replacing) return null;
    r.replacing = true;
    let s;
    try {
      const roles = effectiveRoles(this.roles, this.store, this.models);
      const role = roles.find(x => x.id === old.role) ?? { id: old.role, name: old.roleName, canSpawn: old.canSpawn, perm: old.perm };
      const model = this.models.find(m => m.id === old.model && m.provider === old.provider);
      if (!model) throw new Error("모델을 찾지 못했어요");
      const n = ++this.store.data.seq;
      s = this.newSession({ n, role: { ...role, canSpawn: old.canSpawn }, model,
        it: { effort: old.effort, perm: old.perm, prompt: old.prompt, issue: old.issue, mode: old.mode, lane: old.lane },
        wd: { cwd: old.cwd, branch: old.branch, worktree: old.worktree }, parent: old.parent ?? null, folder: old.folder ?? null });
    } catch (e) {
      r.replacing = false;
      this.push(old, { kind: "info", text: `새 세션으로 바꾸지 못했어요: ${clip(e.message, 200)}` });
      return null;
    }
    const mtok = Math.round(mtokens(old));
    s.rotatedFrom = { id: old.id, name: old.name, mtok, at: Date.now() };
    const { last: prev, team } = this.handoffParts(old, last ?? r.lastText);
    const next = text || "인계 내용대로 하던 일을 이어 가라.";
    const moved = old.canSpawn ? " 팀원과 작업 보드는 이 세션으로 옮겨졌다." : "";
    const note = `[Dispatch] 이전 세션 ${old.name}이(가) 누적 ${mtok}M 토큰을 넘어 같은 설정의 새 세션인 너로 바꿨다.${moved} 이전 대화는 이 세션에 없다. 필요한 상태는 작업 폴더·브랜치·git log·docs로 다시 확인하라.\n\n[직전 응답]\n${prev || "(없음)"}${team}\n\n[이어서 할 일]\n${next}`;
    this.store.data.sessions[s.id] = s;
    // Teammates, the board, limit tickets and plans follow the lead; the old id is gone after remove().
    for (const c of this.sessions) if (c.parent === old.id) c.parent = s.id;
    for (const bag of [this.store.data.tasks, this.store.data.tickets, this.store.data.pipelines])
      for (const v of Object.values(bag || {})) if (v?.lead === old.id) v.lead = s.id;
    const nr = this.rt(s.id);
    if (r.leadNotes?.length) nr.leadNotes = r.leadNotes.splice(0);
    if (r.pendingReport) { nr.pendingReport = r.pendingReport; r.pendingReport = null; }
    const said = `누적 ${mtok}M 토큰이라 새 세션 ${s.name}로 바꿨어요`;
    this.push(s, { kind: "info", text: `${said} (이전 세션 ${old.name})` });
    this.push(s, { kind: "user", text: note, label: "인계" });
    this.touch(s);
    // The work folder now belongs to the new session, so the old one goes without dropping it.
    this.remove(old.id, { keepWorktree: true });
    this.start(s, note, images);
    for (const c of this.sessions) if (c.parent === s.id) this.touch(c);
    if (s.parent) this.notifyLead(s.parent, `[Dispatch] ${old.name}(${old.roleName ?? old.role}) 세션이 누적 ${mtok}M 토큰을 넘어 같은 설정의 새 팀원 ${s.name}(id ${s.id})로 바꿨어요${s.branch ? `(브랜치 ${s.branch})` : ""}. 앞으로는 이 id로 지시하세요.`);
    this.emit("tasks", this.tasks);
    return s;
  }

  interrupt(id) {
    const s = this.get(id), r = this.live.get(id);
    if (!s || !r?.proc) return;
    this.handoffOnInterrupt(s);
    if (r.agyTurn) r.agyTurn.ended = true; // agy: the [중단] note is this turn's only report
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

  remove(id, { strict = false, info, keepWorktree = false } = {}) {
    const gone = this.get(id);
    this.cancelAutoRemove(id);
    this.kill(id);
    delete this.store.data.sessions[id];
    // Its board goes with it: a removed lead can no longer close its tasks.
    for (const bag of [this.store.data.tasks, this.store.data.tickets])
      for (const [k, v] of Object.entries(bag || {})) if (v.lead === id) delete bag[k];
    this.live.delete(id);
    this.liveView?.drop(id);
    this.store.save();
    this.emit("removed", { id });
    // Its worktree goes too when nothing uncommitted is left in it; the branch stays.
    const dropped = gone?.worktree && !keepWorktree && this.team().dropWorktrees
      ? new Promise(res => setTimeout(() => dropWorktree(this.root, gone.cwd, { strict, info }).then(res, () => res(false)), this.dropDelayMs).unref?.())
      : Promise.resolve(null);
    this.emit("tasks", this.tasks);
    this.emit("tickets", this.tickets);
    return dropped; // true: worktree removed, false: kept (uncommitted changes), null: not tried
  }

  /** A teammate stopped with an error: it is not removed, and its lead hears about it at once. */
  noticeError(s) {
    if (s._killed || !this.team().autoRemoveDone || !s.parent || s.canSpawn) return;
    this.notifyLead(s.parent, `[Dispatch] ${s.name}(${s.roleName ?? s.role}) 세션이 오류로 멈췄어요${s.branch ? `(브랜치 ${s.branch})` : ""}: ${clip(s.error || "알 수 없는 오류", 300)}\n자동 정리하지 않았어요. 원인을 보고 다시 지시하거나 stop_session(remove: true)로 정리하세요.`, { wake: true });
  }

  /**
   * Tells a lead something without spending a turn on it: mid-turn when its Claude process is running,
   * otherwise with its next message (like the length guard's longPending). `wake` sends it now.
   */
  notifyLead(leadId, text, { wake = false } = {}) {
    const lead = this.get(leadId);
    if (!lead || lead.status === "done") return;
    const r = this.rt(leadId);
    const midTurn = lead.provider === "claude" && r.proc && (lead.status === "running" || lead.status === "waiting");
    if (wake || midTurn) { try { this.send(leadId, text); return; } catch { /* kept for the next message */ } }
    (r.leadNotes ||= []).push(text);
  }

  /** `answers`: AskUserQuestion's { "<question>": "<answer>" } (#1052); ignored for other tools. */
  respondPermission(id, requestId, behavior, always = false, answers = null) {
    const s = this.get(id), r = this.live.get(id);
    const req = r?.perms.get(requestId);
    if (!s || !req || !r.proc) throw new Error("대기 중인 권한 요청이 없어요");
    const response = permissionResponse(req, behavior, { always, answers });
    r.proc.stdin.write(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: requestId, response } }) + "\n");
    r.perms.delete(requestId);
    this.push(s, { kind: "system", text: `${req.tool} ${behavior === "allow" ? (always ? "항상 허용" : "허용") : "거부"}` });
    this.touch(s, { status: r.perms.size ? "waiting" : "running" });
  }

  // Claude: a live process switches at once through the control protocol; otherwise the next turn starts with it.
  // Codex and Gemini: the new mode (sandbox / --mode) applies from the next turn.
  setPerm(id, perm) {
    const s = this.get(id), r = this.live.get(id);
    if (!s) throw Object.assign(new Error("세션이 없어요"), { status: 404 });
    checkPerm(s.provider, perm);
    if (s.provider === "claude" && r?.proc) {
      r.proc.stdin.write(JSON.stringify({ type: "control_request", request_id: randomUUID(),
        request: { subtype: "set_permission_mode", mode: perm } }) + "\n");
    }
    this.push(s, { kind: "system", text: `권한 모드 ${s.perm} → ${perm}` });
    this.touch(s, { perm });
  }

  /**
   * The short work summary a lead leaves on a session for its card (#912): one line, at most 80 characters; empty
   * clears it. Metadata only, never taken from the transcript.
   */
  setSessionTask(id, text) {
    const s = this.get(id);
    if (!s) throw Object.assign(new Error("세션이 없어요"), { status: 404 });
    const task = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
    this.touch(s, { task });
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
      // Not runnable yet (provider not connected, model list not loaded): stays interrupted for a later try.
      if (!s.interrupted || this.runBlock(s) || this.paused) continue; // paused: the ticket resumes it
      if (this.holdTeam?.(s.parent ?? s.id)) continue; // a stopped plan: 이어서 하기 resumes it
      s.interrupted = false;
      try { this.send(s.id, RESUME_TEXT); } catch { /* resumes on the next message instead */ }
    }
    this.store.save();
  }

  stopAll() {
    for (const r of this.live.values()) r.proc?.kill("SIGTERM");
  }
}

mixin(Hub, HubRunners, HubTickets, HubAutoRemove);
