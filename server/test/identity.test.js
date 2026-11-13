import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../sessions.js";

// A session's system prompt names it and lists the project's leads (issue #45).
function makeHub(sessions) {
  const store = { data: { seq: 0, sessions: {}, tasks: {}, tickets: {}, settings: { guard: { enabled: false }, team: {} } }, save() {}, addDaily() {} };
  for (const s of sessions) store.data.sessions[s.id] = { provider: "claude", status: "idle", prompt: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ...s };
  const limits = Object.assign(new EventEmitter(), { claude: {} });
  const hub = new Hub({ root: mkdtempSync(join(tmpdir(), "dispatch-id-")), store, models: [], roles: [], port: 0, limits });
  return { hub, get: id => store.data.sessions[id] };
}

const TEAM = [
  { id: "L1", name: "Jae", roleName: "관리자", role: "lead", canSpawn: true },
  { id: "L2", name: "Dex", roleName: "관리자", role: "lead", canSpawn: true },
  { id: "L3", name: "Old", roleName: "관리자", role: "lead", canSpawn: true, status: "done" },
  { id: "K1", name: "Pax", roleName: "구현자", role: "impl", parent: "L1" },
];

test("the prompt opens with the session's own name, role and id", () => {
  const { hub, get } = makeHub(TEAM);
  const p = hub.systemPrompt(get("K1"));
  assert.ok(p.startsWith("[나는 누구인가] 당신은 Pax(구현자)이다. 세션 id K1."));
  assert.match(hub.systemPrompt(get("L2")), /당신은 Dex\(관리자\)이다/);
});

test("lists the project's open leads with role and id, marks itself, says it is a start-time snapshot", () => {
  const { hub, get } = makeHub(TEAM);
  const p = hub.systemPrompt(get("L1"));
  assert.match(p, /세션 시작 시점 기준/);
  assert.match(p, /^- Jae\(관리자\), id L1 \(당신\)$/m);
  assert.match(p, /^- Dex\(관리자\), id L2$/m);
  assert.doesNotMatch(p, /Old\(관리자\)/, "a finished lead is left out");
  assert.doesNotMatch(p, /Pax\(구현자\), id/, "teammates are not in the lead list");
  const kid = hub.systemPrompt(get("K1"));
  assert.match(kid, /^- Jae\(관리자\), id L1$/m);
  assert.doesNotMatch(kid, /\(당신\)/);
});

test("leads of another project are not listed", () => {
  const a = makeHub([TEAM[0]]);
  makeHub([{ id: "X1", name: "Zed", roleName: "관리자", role: "lead", canSpawn: true }]);
  const p = a.hub.systemPrompt(a.get("L1"));
  assert.doesNotMatch(p, /Zed|X1/);
});

test("no lead list when the project has no lead", () => {
  const { hub, get } = makeHub([{ id: "S", name: "Solo", roleName: "구현자", role: "impl" }]);
  const p = hub.systemPrompt(get("S"));
  assert.match(p, /당신은 Solo\(구현자\)이다/);
  assert.doesNotMatch(p, /이 프로젝트의 관리자/);
});

test("only name, role and id: no account details or conversation", () => {
  const { hub, get } = makeHub([{ ...TEAM[0], last: "secret reply", email: "x@example.com", providerSessionId: "tok" }]);
  const note = hub.identityNote(get("L1"));
  assert.doesNotMatch(note, /secret|@example|tok/);
});
