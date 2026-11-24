import { spawnCli } from "./cli.js";
import { redact } from "./redact.js";
import { CHILD_PROMPT, SPAWN_PROMPT, WRITING } from "./roles.js";
import { replyStyle } from "./style.js";
import { effectiveRoles } from "./settings.js";
import { isQuotaError } from "./limits.js";
import { checkKey } from "./state.js";
import { badRequest, EFFORT_WORDS, AGY_MODES, CODEX_SANDBOX, checkPerm, checkEffort, MCP_SCRIPT, sessionEnv, clip, userContent, onJsonLines, activityOf } from "./hub-util.js";

/** Bash rules the Claude CLI refuses for a role: `gh pr create` outside the PR role, `gh pr merge` outside the merge role. */
export function ghPrDenied(role) {
  const out = [];
  if (role !== "pr") out.push("Bash(gh pr create:*)");
  if (role !== "merge") out.push("Bash(gh pr merge:*)");
  return out;
}

// Hub's CLI runners (claude / codex / gemini): start a turn, read its stream, end it.
// Mixed into Hub.prototype by hub.js, so `this` is the Hub.
export class HubRunners {
  /* ---------------- runners ---------------- */

  // Leads get the session-management tools; everyone else gets message_lead only.
  /** @this {import("./hub-util.js").HubThis} */
  mcpEnv(s) {
    return s.canSpawn
      ? { DISPATCH_URL: `http://127.0.0.1:${this.port}`, DISPATCH_PARENT: s.id }
      : { DISPATCH_URL: `http://127.0.0.1:${this.port}`, DISPATCH_SELF: s.id, DISPATCH_MODE: "child" };
  }

  /** @this {import("./hub-util.js").HubThis} */
  systemPrompt(s) {
    // A lead works in its own worktree; without the project folder spelled out it merged into its own branch.
    // Since #768 the lead merges the PR on GitHub, then fast-forwards the project folder.
    const where = s.canSpawn && s.worktree
      ? `\n\n[병합 위치] 네 작업 폴더 ${s.cwd}(브랜치 ${s.branch})는 통합 브랜치가 아니다. gh pr merge --merge 뒤 프로젝트 폴더를 맞춘다: git -C ${this.root} fetch, git -C ${this.root} merge --ff-only origin/develop. 보고에 git -C ${this.root} log --oneline -1 결과를 적는다.`
      : "";
    // The role prompt is not saved (state.json keeps metadata only): after a restart it comes from the role.
    const prompt = s.prompt ?? effectiveRoles(this.roles, this.store, this.models).find(r => r.id === s.role)?.prompt;
    // Docs mode (#856): every role writes in the documents style (i-have-adhd rules, #737), not only 문서화.
    const writing = s.mode === "docs" && !prompt?.includes(WRITING) ? WRITING : "";
    return [prompt, writing, (s.canSpawn ? SPAWN_PROMPT : CHILD_PROMPT) + where, this.team().replyStyle ? replyStyle() : ""].filter(Boolean).join("\n\n");
  }

  /** @this {import("./hub-util.js").HubThis} */
  start(s, prompt, images = null) {
    s._killed = false;
    // Turn clock and token baseline for the web "thinking" line.
    s.turnStartedAt = Date.now();
    s.turnTokensBase = s.usage.input + s.usage.output + s.usage.cacheRead + s.usage.cacheWrite;
    // Last gate before a CLI starts: a session saved with a mode or effort that is no longer
    // allowed (older state, a hand-edited file) stops with an error instead of running looser.
    try {
      const blocked = this.runBlock(s); // refuse before any spawn
      if (blocked) throw new Error(blocked);
      checkPerm(s.provider, s.perm);
      if (s.effort) checkEffort({ efforts: this.models.find(m => m.id === s.model)?.efforts || EFFORT_WORDS }, s.effort);
    } catch (e) {
      this.push(s, { kind: "error", text: e.message });
      this.touch(s, { status: "error", error: e.message });
      return;
    }
    try {
      if (s.provider === "claude") this.startClaude(s, prompt, images);
      else if (s.provider === "gemini") this.startGemini(s, prompt);
      else this.startCodex(s, prompt);
    } catch (e) {
      // spawnCli refused (not an allowed CLI, or a real CLI under npm test): nothing started.
      this.push(s, { kind: "error", text: e.message });
      this.touch(s, { status: "error", error: e.message });
    }
  }

  /** @this {import("./hub-util.js").HubThis} */
  attach(s, proc) {
    const r = this.rt(s.id);
    r.proc = proc;
    r.ran = true; // see alive(): a per-turn CLI keeps its team alive between turns
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

  /** @this {import("./hub-util.js").HubThis} */
  startClaude(s, prompt, images = null) {
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
    // Only the PR and merge roles open or merge PRs (#1031); for Claude the CLI itself refuses it to the rest (#1034).
    // Codex and agy have no per-command deny, so there the rule stays in the prompt.
    const gh = ghPrDenied(s.role);
    if (gh.length) args.push("--disallowedTools", ...gh);
    // DISPATCH_URL / DISPATCH_SESSION let the plugin's length hook (hooks/long-session.mjs) find this session.
    const proc = this.spawnCli("claude", args, { cwd: s.cwd, env: { ...sessionEnv(s), DISPATCH_URL: `http://127.0.0.1:${this.port}`, DISPATCH_SESSION: s.id }, stdio: ["pipe", "pipe", "pipe"] });
    s._costBase = s.cost;
    this.attach(s, proc);
    onJsonLines(proc.stdout, m => this.onClaude(s, m));
    proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: userContent(prompt, images) } }) + "\n");
    this.touch(s, { status: "running", error: null });
  }

  /** @this {import("./hub-util.js").HubThis} */
  onClaude(s, m) {
    const r = this.rt(s.id);
    // Work signals end an auto-remove grace period (a queued message may start a turn while status is idle).
    if (["assistant", "user", "control_request"].includes(m.type) || (m.type === "system" && m.subtype === "init")) this.cancelAutoRemove(s.id);
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
          this.checkCtx(s); this.checkLong(s);
        }
        for (const c of msg.content || []) {
          if (c.type === "text" && c.text.trim()) { this.push(s, { kind: "assistant", text: c.text }); s.last = redact(clip(c.text, 400)); r.lastText = c.text; }
          else if (c.type === "tool_use") {
            this.push(s, { kind: "tool", name: c.name, text: clip(JSON.stringify(c.input), 600), ...(c.id ? { callId: c.id } : {}) });
            const key = c.name === "Bash" && checkKey(c.input?.command);
            if (key && c.id) r.checks.set(c.id, { key, kind: activityOf("Bash", c.input.command) });
          }
        }
        this.touch(s, { status: r.perms.size ? "waiting" : "running" });
        break;
      }
      case "user":
        for (const c of (Array.isArray(m.message?.content) ? m.message.content : [])) {
          if (c.type === "tool_result") {
            const text = Array.isArray(c.content) ? c.content.map(x => x.text || "").join("") : c.content;
            this.push(s, { kind: "tool_result", text: clip(text, 1500), error: !!c.is_error, ...(c.tool_use_id ? { callId: c.tool_use_id } : {}) });
            const check = r.checks.get(c.tool_use_id);
            if (check) { r.checks.delete(c.tool_use_id); this.noteCheck(s, check, !c.is_error); }
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
        const fableWin = w.seven_day_overage_included;
        const l = this.limits;
        this.shared.setClaude({
          five: w.five_hour?.utilization ?? l.five, fiveReset: w.five_hour?.resetsAt ? w.five_hour.resetsAt * 1000 : l.fiveReset,
          seven: w.seven_day?.utilization ?? l.seven, sevenReset: w.seven_day?.resetsAt ? w.seven_day.resetsAt * 1000 : l.sevenReset,
          fable: fableWin?.utilization ?? l.fable, fableReset: fableWin?.resetsAt ? fableWin.resetsAt * 1000 : l.fableReset,
        }).catch(e => console.error("limits:", e.message)).finally(() => {
          this.emit("limits", this.limits);
          this.checkTickets();
        });
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
        this.endTurn(s);
        break;
      }
    }
  }

  /** @this {import("./hub-util.js").HubThis} */
  startCodex(s, prompt) {
    // checkPerm (in start) already refused manual and acceptEdits; the sandbox never runs looser than the mode.
    const sandbox = CODEX_SANDBOX[s.perm];
    if (!sandbox) throw badRequest("알 수 없는 권한 모드예요");
    const first = !s.providerSessionId;
    const args = ["exec", ...(first ? [] : ["resume", s.providerSessionId]), "--json", "--skip-git-repo-check",
      "-m", s.model, "-c", `sandbox_mode="${sandbox}"`];
    if (s.effort) args.push("-c", `model_reasoning_effort="${checkEffort({ efforts: EFFORT_WORDS }, s.effort)}"`);
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
    const proc = this.spawnCli("codex", args, { cwd: s.cwd, env: sessionEnv(s), stdio: ["ignore", "pipe", "pipe"] });
    this.attach(s, proc);
    onJsonLines(proc.stdout, m => this.onCodex(s, m));
    this.touch(s, { status: "running", error: null });
  }

  /** @this {import("./hub-util.js").HubThis} */
  onCodex(s, m) {
    if (/^(item|turn\.started)/.test(m.type || "")) this.cancelAutoRemove(s.id);
    switch (m.type) {
      case "thread.started":
        this.touch(s, { providerSessionId: m.thread_id });
        break;
      case "item.completed": {
        const it = m.item || {};
        if (it.type === "agent_message") { this.push(s, { kind: "assistant", text: it.text }); s.last = redact(clip(it.text, 400)); this.rt(s.id).lastText = it.text; }
        else if (it.type === "command_execution") {
          // Codex reports a command only once it has finished: the tool entry is final (no result follows it, so
          // nothing may pair a later result with it) and carries the outcome itself.
          this.push(s, { kind: "tool", name: "shell", text: clip(it.command, 600), final: true, error: typeof it.exit_code === "number" && it.exit_code !== 0 });
          if (it.aggregated_output) this.push(s, { kind: "tool_result", text: clip(it.aggregated_output, 1500), error: it.exit_code !== 0, final: true });
          const key = typeof it.exit_code === "number" && checkKey(it.command);
          if (key) this.noteCheck(s, { key, kind: activityOf("shell", it.command) }, it.exit_code === 0);
        } else if (it.type === "file_change") this.push(s, { kind: "tool", name: "edit", text: clip((it.changes || []).map(c => `${c.kind} ${c.path}`).join("\n"), 600), final: true });
        else if (it.type === "mcp_tool_call") this.push(s, { kind: "tool", name: `${it.server}.${it.tool}`, text: clip(JSON.stringify(it.arguments), 600), final: true, error: it.status === "failed" });
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
        s.ctx = (u.input_tokens || 0) + (u.output_tokens || 0); this.checkCtx(s); this.checkLong(s);
        this.store.addDaily(s.model, s.role, delta);
        this.touch(s, { status: "idle", turns: s.turns + 1, turnsSinceRotate: (s.turnsSinceRotate ?? s.turns ?? 0) + 1 });
        this.endTurn(s);
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

  /** @this {import("./hub-util.js").HubThis} */
  startGemini(s, prompt) {
    // agy has no approval channel in headless mode: checkPerm (in start) refused manual, and the other
    // modes map to agy's own --mode. --dangerously-skip-permissions is never passed (CLAUDE.md: no
    // bypass, refuse instead). If agy cannot run a tool headless in a mode, the turn fails and says so.
    const mode = AGY_MODES[s.perm];
    if (!mode) throw badRequest("알 수 없는 권한 모드예요");
    const first = !s.providerSessionId;
    const system = this.systemPrompt(s);
    const textPrompt = first && system ? `[역할]\n${system}\n\n[작업]\n${prompt}` : prompt;
    const args = ["-p", textPrompt, "--output-format", "stream-json", "--model", s.model, "--mode", mode];
    if (s.effort) args.push("--effort", s.effort);
    if (s.providerSessionId) args.push("--conversation", s.providerSessionId);
    // Same environment as Claude/Codex (headless Playwright, own git env), plus the MCP variables.
    const env = { ...sessionEnv(s), ...this.mcpEnv(s) };
    const proc = this.spawnCli("agy", args, { cwd: s.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    this.attach(s, proc);
    // One agy process is one turn. Its answer arrives as text_delta chunks; they add up in `turn.text`.
    const turn = { text: "", ended: false };
    this.rt(s.id).agyTurn = turn;
    onJsonLines(proc.stdout, m => this.onGemini(s, m, turn));
    // No result event before agy exited cleanly (the line was lost): the turn still ends with what agy said,
    // so the lead gets the report. Only for exit code 0 of the current turn: a signal (interrupt, rotate,
    // stopAll) gives code null and is handled elsewhere; an old process closing after rotate() must not
    // touch the new turn. A failed exit is left to attach().
    proc.on("close", code => {
      if (code === 0 && !turn.ended && this.rt(s.id).agyTurn === turn && !s._killed && s.status !== "done") this.endGeminiTurn(s, turn);
    });
    this.touch(s, { status: "running", error: null });
  }

  /** Stores a finished agy turn's answer as `last` and hands it to the lead (once per turn). Every turn
   *  replaces `last` and reports, even one with no answer: agy ends a turn whose tool needed a permission
   *  headless mode cannot ask for with an empty response (denied_actions), and keeping the previous answer
   *  left the lead waiting for a report that never came (#846). */
  /** @this {import("./hub-util.js").HubThis} */
  endGeminiTurn(s, turn, response, denied) {
    turn.ended = true;
    let text = response && response.trim() ? response : turn.text.trim() ? turn.text : "";
    const blocked = (Array.isArray(denied) ? denied : [])
      .map(d => [d?.display_name, d?.action].filter(Boolean).join(" ")).filter(Boolean);
    if (blocked.length) {
      const note = `[Dispatch] agy가 headless에서 허락을 물을 수 없어 막은 도구: ${[...new Set(blocked)].join(", ")}. 이 턴은 거기서 끝났다.`;
      this.push(s, { kind: "info", text: note });
      text = text ? `${text.trimEnd()}\n\n${note}` : note;
    }
    if (!text) text = "[Dispatch] 답변 없이 턴이 끝났다.";
    s.last = redact(clip(text, 400));
    this.rt(s.id).lastText = text;
    this.touch(s, { status: "idle", turns: s.turns + 1, turnsSinceRotate: (s.turnsSinceRotate ?? s.turns ?? 0) + 1 });
    this.endTurn(s);
  }

  /** `turn` is the agy process's own turn; lines from a process that is no longer current (rotate) change no
   *  text, state or report, only add their token usage. Without `turn` the current one is used. */
  /** @this {import("./hub-util.js").HubThis} */
  onGemini(s, m, turn) {
    const r = this.rt(s.id);
    const cur = r.agyTurn ??= { text: "", ended: false };
    const stale = !!turn && turn !== cur;
    turn = cur;
    if (m.event === "step_update" && !stale) this.cancelAutoRemove(s.id);
    switch (m.event) {
      case "init":
        if (m.conversation_id && !stale) this.touch(s, { providerSessionId: m.conversation_id });
        break;
      case "step_update": {
        const su = m.step_update || {};
        if (su.step_type === "agent_response") {
          // text_delta is a chunk of the answer, not the whole of it. Only without one is `text` read, as the
          // answer so far (replaced, never appended, so a cumulative field cannot double the text).
          const chunk = su.text_delta ?? "";
          if (!stale && !turn.ended && (chunk || su.text)) {
            if (chunk) turn.text += chunk;
            else turn.text = String(su.text);
            const shown = chunk || String(su.text);
            if (shown.trim()) this.push(s, { kind: "assistant", text: shown });
            if (turn.text.trim()) {
              s.last = redact(clip(turn.text, 400));
              r.lastText = turn.text;
            }
          }
          if (su.usage) {
            const u = su.usage;
            const delta = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_tokens || 0, cacheWrite: 0 };
            for (const k in delta) s.usage[k] += delta[k];
            if (!stale) { s.ctx = delta.input + delta.output; this.checkCtx(s); this.checkLong(s); }
            this.store.addDaily(s.model, s.role, delta);
          }
        } else if (stale) {
          // an old process's tool steps are not shown
        } else if (su.step_type === "tool") {
          if (su.state === "ACTIVE") {
            this.push(s, { kind: "tool", name: su.tool_name, text: clip(JSON.stringify(su.tool_info?.parameters || {}), 600) });
          } else if (su.state === "DONE") {
            this.push(s, { kind: "tool_result", text: clip(su.tool_info?.output || "", 1500), error: false });
          }
        }
        this.touch(s);
        break;
      }
      case "result": {
        const res = m.result || {};
        if (stale || turn.ended) break;
        if (res.status === "ERROR") {
          turn.ended = true;
          if (res.response && res.response.trim()) {
            s.last = redact(clip(res.response, 400));
            this.rt(s.id).lastText = res.response;
          }
          if (isQuotaError(res.error)) this.setGeminiQuota(res.error);
          this.push(s, { kind: "error", text: clip(res.error || "Turn failed", 400) });
          this.touch(s, { status: "error", error: clip(res.error || "Turn failed", 300) });
        } else {
          this.endGeminiTurn(s, turn, res.response ?? m.response, res.denied_actions);
        }
        break;
      }
    }
  }
}
