#!/usr/bin/env node
// Minimal MCP stdio server that lets a manager session drive Dispatch over its local HTTP API.
// Spawned by Claude Code (--mcp-config) or Codex (mcp_servers.dispatch) with DISPATCH_URL / DISPATCH_PARENT.

const BASE = process.env.DISPATCH_URL || "http://127.0.0.1:4317";
const PARENT = process.env.DISPATCH_PARENT || null;

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

const TOOLS = [
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
    description: "세션 상태와 최근 대화 일부를 돌려준다.",
    inputSchema: { type: "object", required: ["session_id"], properties: { session_id: { type: "string" }, last: { type: "integer", description: "최근 메시지 개수 (기본 10)" } } },
    run: async ({ session_id, last = 10 }) => {
      const res = await api("GET", `/api/sessions/${session_id}/messages`);
      return { session: brief(res.session), recent: res.messages.slice(-last).map(m => ({ kind: m.kind, name: m.name, text: m.text })) };
    },
  },
  {
    name: "send_message",
    description: "세션에 추가 지시를 보낸다.",
    inputSchema: { type: "object", required: ["session_id", "text"], properties: { session_id: { type: "string" }, text: { type: "string" } } },
    run: async ({ session_id, text }) => { await api("POST", `/api/sessions/${session_id}/message`, { text }); return { ok: true }; },
  },
  {
    name: "stop_session",
    description: "세션을 종료한다.",
    inputSchema: { type: "object", required: ["session_id"], properties: { session_id: { type: "string" } } },
    run: async ({ session_id }) => { await api("POST", `/api/sessions/${session_id}/kill`); return { ok: true }; },
  },
];

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
        const out = await tool.run(params.arguments || {});
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
