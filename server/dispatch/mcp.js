#!/usr/bin/env node
// Minimal MCP stdio server that lets a lead session drive Atelier's session hub over its local HTTP API.
// Spawned by Claude Code (--mcp-config), Codex (mcp_servers.dispatch) or agy with DISPATCH_URL / DISPATCH_PARENT.

import { LANES } from "./lanes.js";

// Only this machine's loopback: a DISPATCH_URL pointing anywhere else is refused, and there is no
// default port to fall back to (the server passes its own URL when it starts a session).
const BASE = /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.DISPATCH_URL || "") ? process.env.DISPATCH_URL : null;
const PARENT = process.env.DISPATCH_PARENT || null;
const SELF = process.env.DISPATCH_SELF || null;
const CHILD = process.env.DISPATCH_MODE === "child";

async function api(method, path, body) {
  if (!BASE) throw new Error("DISPATCH_URL must be http://127.0.0.1:<port>");
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", "x-drawing": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Harness modes (#748; ids must match MODES in mode-profiles.js, checked by test/dispatch/mode-apply.test.js).
const MODE_HELP = [
  { id: "plan", name: "계획/설계", use: "설계·여러 단계의 복잡한 작업" },
  { id: "impl", name: "구현", use: "기능 구현" },
  { id: "review", name: "리뷰·테스트", use: "리뷰와 테스트" },
  { id: "docs", name: "문서", use: "문서 쓰기" },
  { id: "quickfix", name: "빠른 수정", use: "1-3개 파일의 작은 수정" },
  { id: "research", name: "조사", use: "서치·자료 조사" },
];
const LANE_PROP = { type: "string", enum: LANES, description: "quickfix: 1-3개 파일, 계획 승인·리뷰어 없이 구현자 하나. normal: 기능 하나, 리뷰어 1명. risky: 인증·데이터·삭제·구조, 리뷰어 2명, 병합 전 메인 세션 확인" };
const MODE_PROP = { type: "string", enum: MODE_HELP.map(m => m.id), description: "작업 종류. 주어지지 않으면 과제를 보고 고른다(웹 서치·자료 조사면 research). 그 모드의 프로필(제공사·모델·강도·권한)을 쓴다. model을 적으면 model이 우선" };

const brief = s => ({
  id: s.id, name: s.name, role: s.role, model: s.model, status: s.status, state: s.state,
  last: s.last, turns: s.turns, cost: s.cost, branch: s.branch, parent: s.parent,
  ctxPct: s.ctxWindow > 0 ? Math.round((100 * (s.ctx || 0)) / s.ctxWindow) : null,
  // Total tokens processed, in millions; past the length guard (`long: true`) replace the session.
  mtok: Math.round((((s.usage?.input || 0) + (s.usage?.cacheRead || 0) + (s.usage?.cacheWrite || 0) + (s.usage?.output || 0)) / 1e5)) / 10,
  long: !!s.longRun,
  ...(s.mode && { mode: s.mode }), ...(s.profileNote && { profileNote: s.profileNote }),
  pendingPermissions: (s.pending || []).length,
});

// Teammates get one tool: reach their lead mid-turn.
const CHILD_TOOLS = [
  {
    name: "message_lead",
    description: "턴 중간에 관리자에게 묻거나 알린다. 턴을 끝낼 때의 답변은 자동으로 보고되니 따로 보내지 않는다.",
    inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
    run: async ({ text }) => { await api("POST", `/api/sessions/${SELF}/to-lead`, { text }); return { ok: true }; },
  },
];

const LEAD_TOOLS = [
  {
    name: "list_roles",
    description: "역할, 모델, 모드 목록.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const st = await api("GET", "/api/state");
      return {
        roles: st.roles.map(r => ({ id: r.id, name: r.name, defaultModel: r.model, perm: r.perm })),
        models: st.models.map(m => ({ id: m.id, provider: m.provider, connected: st.providers[m.provider]?.connected, efforts: m.efforts })),
        modes: MODE_HELP,
      };
    },
  },
  {
    name: "create_sessions",
    description: "팀원 세션을 만든다. 각 항목의 task가 첫 지시다(끝 조건, 작은 조각, 보고 형식). lane: \"quickfix\"면 계획 승인 없이 구현자 하나.",
    inputSchema: {
      type: "object",
      required: ["sessions"],
      properties: {
        sessions: {
          type: "array",
          items: {
            type: "object",
            required: ["role", "task"],
            properties: {
              role: { type: "string", description: "역할 id: impl, review, test, design, docs (list_roles 참고). implementer·reviewer·tester·designer도 받아요" },
              task: { type: "string", description: "이 세션에게 줄 지시" },
              model: { type: "string", description: "모델 id (list_roles 참고). 생략하면 mode의 프로필, mode도 없으면 역할 기본값" },
              effort: { type: "string" },
              perm: { type: "string", enum: ["manual", "acceptEdits", "auto", "plan"] },
              mode: MODE_PROP,
              count: { type: "integer", minimum: 1, maximum: 4 },
              issue: { type: "integer", description: "맡은 GitHub 이슈 번호(이슈별 기록용)" },
            },
          },
        },
        worktree: { type: "boolean", description: "세션마다 git worktree 분리 (기본 true)" },
        folder: { type: "string", description: "프로젝트 폴더(워크스페이스 최상위 폴더) 경로. 생략하면 이 관리자의 폴더" },
        mode: MODE_PROP,
        lane: LANE_PROP,
      },
    },
    run: async ({ sessions, worktree = true, folder, mode, lane }) => {
      const items = sessions.map(x => ({ role: x.role, task: x.task, model: x.model, effort: x.effort, perm: x.perm, n: x.count || 1, ...(x.issue && { issue: x.issue }), ...(x.mode && { mode: x.mode }) }));
      const res = await api("POST", "/api/sessions", { items, worktree, parent: PARENT, ...(folder && { folder }), ...(mode && { mode }), ...(lane && { lane }) });
      return res.sessions.map(brief);
    },
  },
  {
    name: "list_sessions",
    description: "세션 목록과 상태. mine=true면 내가 만든 세션만.",
    inputSchema: { type: "object", properties: { mine: { type: "boolean" } } },
    run: async ({ mine = true }) => {
      const st = await api("GET", "/api/state");
      return st.sessions.filter(s => !mine || s.parent === PARENT).map(brief);
    },
  },
  {
    name: "get_session",
    description: "한 세션의 상태와 최근 메시지 앞부분. 꼭 필요할 때만 쓴다.",
    inputSchema: { type: "object", required: ["session_id"], properties: { session_id: { type: "string" }, last: { type: "integer", description: "최근 메시지 개수 (기본 6, 최대 20)" } } },
    run: async ({ session_id, last = 6 }) => {
      const res = await api("GET", `/api/sessions/${session_id}/messages`);
      const n = Math.min(Math.max(1, last), 20);
      const clip = t => { t = String(t ?? ""); return t.length > 400 ? t.slice(0, 400) + "…" : t; };
      return { session: brief(res.session), recent: res.messages.slice(-n).map(m => ({ kind: m.kind, name: m.name, text: clip(m.text) })) };
    },
  },
  {
    name: "send_message",
    description: "세션에 추가 지시를 보낸다.",
    inputSchema: { type: "object", required: ["session_id", "text"], properties: { session_id: { type: "string" }, text: { type: "string" } } },
    run: async ({ session_id, text }) => { await api("POST", `/api/sessions/${session_id}/message`, { text }); return { ok: true }; },
  },
  {
    name: "set_task",
    description: "작업 보드. 일 하나에 한 번 만들고(title), 그 뒤로는 받은 id로 stage·owner·eta_minutes·note를 고친다. 병합한 일은 commit(브랜치나 커밋)과 함께 done으로 닫는다. 서버가 통합 브랜치에 있는지 확인하고, 없으면 merge_check에 이유를 돌려준다. 그만둔 일은 commit 없이 done. 새로 만들면 열린 내 작업(open)과 같은 lane 과거 실행 시간(past_runs)이 온다.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        id: { type: "string" },
        title: { type: "string", description: "짧은 작업 이름 (예: 홈 레이아웃 정리)" },
        stage: { type: "string", enum: ["plan", "impl", "review", "test", "merge", "done", "blocked"] },
        owner: { type: "string", description: "지금 맡은 세션 이름 (예: Juno)" },
        eta_minutes: { type: "number", description: "끝날 때까지 남은 예상 분" },
        note: { type: "string", description: "한 줄 상태" },
        commit: { type: "string", description: "병합한 브랜치나 커밋. 빈 문자열이면 지운다" },
        step: { type: "string", description: "승인된 계획의 단계 id" },
        lane: LANE_PROP,
      },
    },
    run: async args => {
      const t = await api("POST", "/api/tasks", { ...args, lead: PARENT });
      return {
        id: t.id, title: t.title, stage: t.stage,
        ...(args.stage === "done" && t.mergeCheck && { merge_check: t.mergeCheck }),
        ...(t.open?.length && { open: t.open }),
        ...(t.etaHint && { past_runs: t.etaHint }),
      };
    },
  },
  {
    name: "set_session_task",
    description: "세션 카드에 뜨는 작업 요약 한 줄(80자 이내)을 남긴다. 이슈 없이 시킨 일에 쓴다. session_id를 생략하면 나. 빈 문자열이면 지운다. 개인정보는 넣지 않는다.",
    inputSchema: { type: "object", required: ["task"], properties: { session_id: { type: "string" }, task: { type: "string", description: "짧은 작업 요약 (예: 로그인 버튼 정리)" } } },
    run: async ({ session_id, task }) => {
      const id = session_id || PARENT;
      if (!id) throw new Error("session_id가 필요해요");
      await api("POST", `/api/sessions/${id}/task`, { task });
      return { ok: true };
    },
  },
  {
    name: "post_accounts",
    description: "이슈의 PR에 세션·모델·계정 요약(roles: …) 댓글 하나를 올린다. 다시 부르면 같은 댓글을 고친다. pr을 빼면 그 이슈의 PR을 찾아 쓴다.",
    inputSchema: { type: "object", required: ["issue"], properties: { issue: { type: "integer", description: "GitHub 이슈 번호" }, pr: { type: "integer", description: "PR 번호 (선택)" } } },
    run: async ({ issue, pr }) => api("POST", `/api/issues/${Number(issue)}/accounts/comment`, pr == null ? {} : { pr }),
  },
  {
    name: "stop_session",
    description: "세션을 끝낸다. 다시 쓸 일이 없으면 remove: true로 목록에서도 지운다.",
    inputSchema: { type: "object", required: ["session_id"], properties: { session_id: { type: "string" }, remove: { type: "boolean", description: "목록에서도 지움 (기본 false)" } } },
    run: async ({ session_id, remove }) => {
      await api("POST", `/api/sessions/${session_id}/${remove ? "remove" : "kill"}`);
      return { ok: true, removed: !!remove };
    },
  },
];

const TOOLS = CHILD ? CHILD_TOOLS : LEAD_TOOLS;

function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n"); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "dispatch", version: "0.1.0" },
      });
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find(t => t.name === params?.name);
      if (!tool) return fail(id, -32602, `unknown tool ${params?.name}`);
      try {
        const args = params.arguments || {};
        // A misnamed argument (e.g. `message` for `text`) used to reach the server as "" and report ok.
        const props = tool.inputSchema.properties || {};
        const unknown = Object.keys(args).filter(k => !(k in props));
        const itemProps = Object.entries(props).filter(([, p]) => p.type === "array" && p.items?.properties)
          .map(([k, p]) => `${k}[]: ${Object.keys(p.items.properties).join(", ")}`);
        const empty = v => v == null || String(v).trim() === "";
        const missing = (tool.inputSchema.required || []).filter(k => empty(args[k]));
        // Array items too: create_sessions with `text`/`instruction` instead of `task` started blank sessions.
        for (const [k, p] of Object.entries(props)) {
          if (p.type !== "array" || !Array.isArray(args[k]) || !p.items?.required) continue;
          args[k].forEach((it, i) => {
            for (const r of p.items.required) if (empty(it?.[r])) missing.push(`${k}[${i}].${r}`);
            const extra = Object.keys(it || {}).filter(x => !(x in (p.items.properties || {})));
            if (extra.length && missing.some(m => m.startsWith(`${k}[${i}].`))) unknown.push(...extra.map(x => `${k}[${i}].${x}`));
          });
        }
        if (missing.length) { // extra harmless fields alone pass; they are only named to explain the miss
          throw new Error([
            missing.length && `필수 인자 ${missing.join(", ")}이(가) 비어 있어요`,
            unknown.length && `모르는 인자 ${unknown.join(", ")}`,
          ].filter(Boolean).join(". ") + `. 받는 인자: ${[Object.keys(props).join(", "), ...itemProps].join(" / ")}. 아무것도 보내지 않았으니 고쳐서 다시 호출하세요.`);
        }
        const out = await tool.run(args);
        return reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return reply(id, { content: [{ type: "text", text: `오류: ${e.message}` }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", d => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); } catch { /* ignore malformed input */ }
  }
});
