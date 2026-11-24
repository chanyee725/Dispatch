// Changes made when the Dispatch Hub moved into Drawing (E11): port getter, memory-only transcripts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";

async function makeHub(port = 0) {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-dispatch-"));
  const store = new Store(root);
  await store.load();
  const limits = new SharedLimits(path.join(root, "limits.json"));
  const hub = new Hub({ root, store, models: [], roles: [], port, limits });
  return { root, store, hub };
}

test("Hub takes a port getter, read when a session needs it", async () => {
  let port = 0;
  const { root, hub } = await makeHub(() => port);
  port = 4391;
  assert.equal(hub.port, 4391);
  assert.equal(hub.mcpEnv({ id: "x", canSpawn: true }).DISPATCH_URL, "http://127.0.0.1:4391");
  rmSync(root, { recursive: true, force: true });
});

test("Hub still takes a plain port number", async () => {
  const { root, hub } = await makeHub(4317);
  assert.equal(hub.port, 4317);
  rmSync(root, { recursive: true, force: true });
});

test("transcripts stay in memory: nothing under .dispatch/ but state.json, no reply text on disk", async () => {
  const { root, store, hub } = await makeHub();
  const s = { id: "a", name: "Juno", status: "idle", usage: {}, turns: 0, updatedAt: 0, last: "" };
  store.data.sessions.a = s;
  hub.push(s, { kind: "user", text: "secret task text" });
  hub.push(s, { kind: "assistant", text: "secret reply text" });
  s.last = "secret reply text";
  await store.flush();
  assert.equal(hub.transcript("a").length, 2);
  assert.equal(existsSync(path.join(root, ".dispatch", "transcripts")), false);
  const disk = readFileSync(path.join(root, ".dispatch", "state.json"), "utf8");
  assert.doesNotMatch(disk, /secret/);
  assert.equal(JSON.parse(disk).sessions.a.name, "Juno");
  // Reloading gives an empty `last` and an empty transcript (a restart forgets the conversation).
  const again = new Store(root);
  await again.load();
  assert.equal(again.data.sessions.a.last, "");
  rmSync(root, { recursive: true, force: true });
});

test("the ring buffer keeps the newest 400 entries", async () => {
  const { root, store, hub } = await makeHub();
  const s = { id: "b", name: "Cal", status: "idle", usage: {}, turns: 0, updatedAt: 0, last: "" };
  store.data.sessions.b = s;
  for (let i = 0; i < 450; i++) hub.push(s, { kind: "assistant", text: `m${i}` });
  const t = hub.transcript("b");
  assert.equal(t.length, 400);
  assert.equal(t[0].text, "m50");
  rmSync(root, { recursive: true, force: true });
});
