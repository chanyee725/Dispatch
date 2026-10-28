import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareWorkdir } from "./git.js";
import { SPAWN_PROMPT } from "./roles.js";

const MCP_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp.js");
const MAX_TRANSCRIPT = 400;
const MAX_CHILDREN = 8;
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

    // Sessions from a previous run have no process; they resume on the next message.
    for (const s of Object.values(store.data.sessions)) {
      if (s.status === "running" || s.status === "waiting") s.status = "idle";
    }
  }

  get sessions() { return Object.values(this.store.data.sessions); }
  get(id) { return this.store.data.sessions[id]; }
  rt(id) {
    let r = this.live.get(id);
    if (!r) this.live.set(id, r = { proc: null, transcript: [], perms: new Map(), seenMsgIds: new Set() });
    return r;
  }

  publicSession(s) {
    const r = this.live.get(s.id);
    return { ...s, pending: r ? [...r.perms.values()] : [] };
  }

  touch(s, patch = {}) {
    Object.assign(s, patch, { updatedAt: Date.now() });
    this.store.save();
    this.emit("session", this.publicSession(s));
  }

  push(s, entry) {
    const r = this.rt(s.id);
    entry.at = Date.now();
    r.transcript.push(entry);
    if (r.transcript.length > MAX_TRANSCRIPT) r.transcript.splice(0, r.transcript.length - MAX_TRANSCRIPT);
    this.emit("message", { id: s.id, entry });
  }

  transcript(id) { return this.live.get(id)?.transcript ?? []; }

  guardCheck(count) {
    const g = this.store.data.settings.guard;
    if (!g.enabled) return null;
    if (this.limits.five != null && this.limits.five >= g.five) return `5시간 한도 ${Math.round(this.limits.five * 100)}% — 차단 기준 이상이에요`;
    if (this.limits.seven != null && this.limits.seven >= g.seven) return `주간 한도 ${Math.round(this.limits.seven * 100)}% — 차단 기준 이상이에요`;
    return null;
  }

  /* ---------------- create ---------------- */

  // items: [{ role, model, effort, perm, prompt, n }]
  async create({ items, commonPrompt, worktree = true, parent = null }) {
    const total = items.reduce((a, x) => a + (x.n || 1), 0);
    if (!total) throw new Error("만들 세션이 없어요");
    // The limit gauges come from Claude, so they only gate Claude sessions.
    const usesClaude = items.some(it => {
      const id = it.model || this.roles.find(r => r.id === it.role)?.model;
      return this.models.find(m => m.id === id)?.provider === "claude";
    });
    const blocked = usesClaude && this.guardCheck(total);
    if (blocked) throw new Error(blocked);
    if (parent) {
      const active = this.sessions.filter(s => s.parent === parent && !["done", "error"].includes(s.status)).length;
      if (active + total > MAX_CHILDREN) throw new Error(`관리자 한 명이 동시에 둘 수 있는 세션은 ${MAX_CHILDREN}개까지예요 (현재 ${active}개)`);
    }

    const made = [];
    for (const it of items) {
      const role = this.roles.find(r => r.id === it.role);
      if (!role) throw new Error(`알 수 없는 역할: ${it.role}`);
      const model = this.models.find(m => m.id === (it.model || role.model));
      if (!model) throw new Error(`알 수 없는 모델: ${it.model}`);
      for (let k = 0; k < (it.n || 1); k++) {
        const n = ++this.store.data.seq;
        const slug = `${role.id}-${n}`;
        const wd = await prepareWorkdir(this.root, slug, worktree);
        const s = {
          id: randomUUID(), n, name: `${role.name} #${n}`, role: role.id, roleName: role.name,
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

  send(id, text) {
    const s = this.get(id);
    if (!s) throw new Error("세션이 없어요");
    this.push(s, { kind: "user", text });
    const r = this.rt(id);
    if (s.provider === "claude" && r.proc) {
      r.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
      this.touch(s, { status: "running", last: text });
    } else if (s.provider === "openai" && r.proc) {
      throw new Error("Codex는 응답이 끝난 뒤에 다음 메시지를 보낼 수 있어요");
    } else {
      this.start(s, text);
    }
  }

  interrupt(id) {
    const s = this.get(id), r = this.live.get(id);
    if (!s || !r?.proc) return;
    if (s.provider === "claude") {
      r.proc.stdin.write(JSON.stringify({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } }) + "\n");
    } else {
      r.proc.kill("SIGINT");
    }
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
    this.kill(id);
    delete this.store.data.sessions[id];
    this.live.delete(id);
    this.store.save();
    this.emit("removed", { id });
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

  stopAll() {
    for (const r of this.live.values()) r.proc?.kill("SIGTERM");
  }

  /* ---------------- runners ---------------- */

  mcpEnv(s) {
    return { DISPATCH_URL: `http://127.0.0.1:${this.port}`, DISPATCH_PARENT: s.id };
  }

  start(s, prompt) {
    s._killed = false;
    if (s.provider === "claude") this.startClaude(s, prompt);
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
    const system = [s.prompt, s.canSpawn ? SPAWN_PROMPT : ""].filter(Boolean).join("\n\n");
    if (system) args.push("--append-system-prompt", system);
    if (s.providerSessionId) args.push("--resume", s.providerSessionId);
    // Dispatch's own tools are pre-approved; the server enforces the guard and the child-session cap.
    if (s.canSpawn) {
      args.push("--mcp-config", JSON.stringify({ mcpServers: { dispatch: {
        command: process.execPath, args: [MCP_SCRIPT], env: this.mcpEnv(s) } } }),
        "--allowedTools", "mcp__dispatch");
    }
    const proc = spawn("claude", args, { cwd: s.cwd, stdio: ["pipe", "pipe", "pipe"] });
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
          if (c.type === "text" && c.text.trim()) { this.push(s, { kind: "assistant", text: c.text }); s.last = clip(c.text, 400); }
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
        this.touch(s, { status: "idle", turns: s.turns + 1 });
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
    if (s.canSpawn) {
      const env = this.mcpEnv(s);
      args.push("-c", `mcp_servers.dispatch.command=${JSON.stringify(process.execPath)}`,
        "-c", `mcp_servers.dispatch.args=[${JSON.stringify(MCP_SCRIPT)}]`,
        "-c", `mcp_servers.dispatch.env={DISPATCH_URL=${JSON.stringify(env.DISPATCH_URL)},DISPATCH_PARENT=${JSON.stringify(env.DISPATCH_PARENT)}}`,
        "-c", `mcp_servers.dispatch.default_tools_approval_mode="approve"`);
    }
    // Codex has no system-prompt flag in exec mode, so the role prompt leads the first turn.
    const system = [s.prompt, s.canSpawn ? SPAWN_PROMPT : ""].filter(Boolean).join("\n\n");
    args.push(first && system ? `[역할]\n${system}\n\n[작업]\n${prompt}` : prompt);
    const proc = spawn("codex", args, { cwd: s.cwd, stdio: ["ignore", "pipe", "pipe"] });
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
        if (it.type === "agent_message") { this.push(s, { kind: "assistant", text: it.text }); s.last = clip(it.text, 400); }
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
        this.touch(s, { status: "idle", turns: s.turns + 1 });
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
}
