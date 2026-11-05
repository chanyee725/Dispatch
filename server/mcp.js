#!/usr/bin/env node
// Minimal MCP stdio server that lets a manager session drive Dispatch over its local HTTP API.
// Spawned by Claude Code (--mcp-config) or Codex (mcp_servers.dispatch) with DISPATCH_URL / DISPATCH_PARENT.

const BASE = process.env.DISPATCH_URL || "http://127.0.0.1:4317";
const PARENT = process.env.DISPATCH_PARENT || null;
const SELF = process.env.DISPATCH_SELF || null;
const CHILD = process.env.DISPATCH_MODE === "child";

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", "x-dispatch": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const brief = s => ({
  id: s.id, name: s.name, role: s.role, model: s.model, status: s.status,
  last: s.last, turns: s.turns, cost: s.cost, branch: s.branch, parent: s.parent,
  pendingPermissions: (s.pending || []).length,
});

// Teammates get one tool: reach their lead mid-turn.
const CHILD_TOOLS = [
  {
    name: "message_lead",
    description: "턴 중간에 관리자에게 질문이나 알림을 보낸다. 턴이 끝날 때의 마지막 답변은 따로 보내지 않아도 자동으로 보고된다.",
    inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
    run: async ({ text }) => { await api("POST", `/api/sessions/${SELF}/to-lead`, { text }); return { ok: true }; },
  },
];

const LEAD_TOOLS = [
  {
    name: "list_roles",
    description: "사용할 수 있는 역할 프리셋과 모델 목록을 돌려준다.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const st = await api("GET", "/api/state");
      return {
        roles: st.roles.map(r => ({ id: r.id, name: r.name, defaultModel: r.model, perm: r.perm })),
        models: st.models.map(m => ({ id: m.id, provider: m.provider, connected: st.providers[m.provider]?.connected, efforts: m.efforts })),
      };
    },
  },
  {
    name: "create_sessions",
    description: "역할별로 새 세션을 만든다. 각 항목의 task 가 그 세션의 첫 지시가 된다. 생성된 세션은 이 관리자 세션의 하위로 묶인다.",
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
              role: { type: "string", description: "역할 id (list_roles 참고)" },
              task: { type: "string", description: "이 세션에게 줄 구체적인 지시" },
              model: { type: "string", description: "모델 id. 생략하면 역할 기본값" },
              effort: { type: "string" },
              perm: { type: "string", enum: ["manual", "acceptEdits", "auto", "plan"] },
              count: { type: "integer", minimum: 1, maximum: 4 },
            },
          },
        },
        worktree: { type: "boolean", description: "세션마다 git worktree 분리 (기본 true)" },
      },
    },
    run: async ({ sessions, worktree = true }) => {
      const items = sessions.map(x => ({ role: x.role, task: x.task, model: x.model, effort: x.effort, perm: x.perm, n: x.count || 1 }));
      const res = await api("POST", "/api/sessions", { items, worktree, parent: PARENT });
      return res.sessions.map(brief);
    },
  },
  {
    name: "list_sessions",
    description: "세션 목록과 상태를 돌려준다. mine=true 면 이 관리자가 만든 세션만.",
    inputSchema: { type: "object", properties: { mine: { type: "boolean" } } },
    run: async ({ mine = true }) => {
      const st = await api("GET", "/api/state");
      return st.sessions.filter(s => !mine || s.parent === PARENT).map(brief);
    },
  },
  {
    name: "get_session",
    description: "세션 상태와 최근 대화 일부를 돌려준다. 각 메시지는 요약(앞부분)만 온다 — 전체를 반복해서 읽으면 토큰 낭비이니 꼭 필요한 세션만 본다.",
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
    description: "작업 보드를 갱신한다. 맡은 일 하나마다 한 번만 만들고(title), 그 뒤로는 돌려받은 id로 stage·owner·eta_minutes·note를 고친다. 같은 일을 제목만 바꿔 새로 만들지 않는다(제목을 바꿀 때도 id와 함께 보낸다). develop에 병합한 일은 commit(병합한 브랜치 이름이나 끝 커밋)과 함께 stage done으로 닫는다. 서버가 그 커밋이 통합 브랜치에 들어 있는지 확인하고, 없으면 닫지 않고 merge_check에 이유를 돌려준다. 그만둔 일은 commit 없이 done으로 닫는다. 새로 만들면 결과의 open에 이미 열려 있는 내 작업이 온다. 같은 일이 있으면 그 id를 쓰고 방금 만든 것은 done으로 닫는다.",
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
        commit: { type: "string", description: "병합한 브랜치 이름이나 커밋. done으로 닫을 때 통합 브랜치 포함 여부를 확인한다. 빈 문자열이면 지운다" },
      },
    },
    run: async args => {
      const t = await api("POST", "/api/tasks", { ...args, lead: PARENT });
      return {
        id: t.id, title: t.title, stage: t.stage,
        ...(args.stage === "done" && t.mergeCheck && { merge_check: t.mergeCheck }),
        ...(t.open?.length && { open: t.open }),
      };
    },
  },
  {
    name: "stop_session",
    description: "세션을 종료한다. 다시 쓸 일이 없는 끝난 세션은 remove: true로 목록에서도 지운다(대화 기록도 지워진다). 결과를 아직 확인해야 하면 remove 없이 종료만 한다.",
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
