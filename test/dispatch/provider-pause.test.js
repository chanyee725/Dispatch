import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub } from "../../server/dispatch/hub.js";

function fixture() {
  const store = { data: { sessions: {}, settings: { guard: { enabled: true, five: 0.9, seven: 0.95 } } }, save() {} };
  const hub = new Hub({ root: "/tmp", store, models: [], roles: [], port: 0 });
  hub.limitHit = () => ({ key: "seven:future", reason: "주간 한도 99%", resetAt: Date.now() + 60_000 });
  hub.runBlock = () => null;
  hub.refreshCodex = async () => {};
  const add = (id, provider, parent = null) => {
    const s = { id, name: id, provider, status: "running", canSpawn: !parent, parent, usage: {}, startedAt: Date.now() };
    store.data.sessions[id] = s;
    hub.rt(id);
    return s;
  };
  return { hub, store, add };
}

test("Claude limit stops and tickets Claude sessions only, including mixed teams", () => {
  const { hub, store, add } = fixture();
  add("claude", "claude"); add("codex", "openai"); add("gemini", "gemini");
  add("mixed-child", "claude", "codex");
  store.data.tasks = Object.fromEntries(["claude", "codex", "gemini"].map(id => [id, { id, title: id, lead: id, stage: "impl", createdAt: Date.now() }]));
  const stopped = [];
  hub.interrupt = id => { stopped.push(id); hub.get(id).status = "idle"; };
  hub.checkTickets();
  assert.deepEqual(stopped.sort(), ["claude", "mixed-child"]);
  assert.equal(hub.get("codex").status, "running");
  assert.equal(hub.get("gemini").status, "running");
  const tickets = Object.values(store.data.tickets);
  assert.deepEqual(tickets.map(t => t.lead).sort(), ["claude", "codex"]);
  assert.deepEqual(tickets.find(t => t.lead === "codex").items, []);
  hub.get("mixed-child").status = "running";
  hub.checkTickets();
  assert.equal(stopped.at(-1), "mixed-child");
});

test("Claude pause refuses only Claude follow-ups and preserves other provider holds", () => {
  const { hub, add } = fixture();
  for (const [id, provider] of [["c", "claude"], ["o", "openai"], ["g", "gemini"]]) add(id, provider);
  const delivered = [];
  hub.deliver = s => delivered.push(s.id);
  assert.throws(() => hub.send("c", "continue"), /사용량 한도/);
  hub.send("o", "continue"); hub.send("g", "continue");
  assert.deepEqual(delivered, ["o", "g"]);
  hub.runBlock = s => s.provider === "openai" ? "Codex own quota" : null;
  assert.throws(() => hub.send("o", "continue"), /Codex own quota/);
  assert.deepEqual(delivered, ["o", "g"]);
});

test("reports to an available provider are delivered while Claude reports wait", () => {
  const { hub, add } = fixture();
  add("o", "openai"); add("c", "claude");
  const a = add("a", "gemini", "o"), b = add("b", "openai", "c");
  hub.rt(a.id).pendingReport = "ready"; hub.rt(b.id).pendingReport = "wait";
  const sent = [];
  hub.send = id => sent.push(id); hub.boardNote = () => ""; hub.armAutoRemove = () => {};
  hub.deliverReport(a); hub.deliverReport(b);
  assert.deepEqual(sent, ["o"]);
  assert.equal(hub.rt(a.id).pendingReport, null);
  assert.equal(hub.rt(b.id).pendingReport, "wait");
});

test("restart resumes only available providers during a Claude pause", () => {
  const { hub, add } = fixture();
  for (const [id, provider] of [["c", "claude"], ["o", "openai"], ["g", "gemini"]]) add(id, provider).interrupted = true;
  const sent = []; hub.send = id => sent.push(id);
  hub.resumeInterrupted();
  assert.deepEqual(sent, ["o", "g"]);
  assert.equal(hub.get("c").interrupted, true);
});
