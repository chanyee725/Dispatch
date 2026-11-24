import { test } from "node:test";
import assert from "node:assert/strict";
import { Burn, median, rateOf, warnOf } from "../../server/dispatch/burn.js";

const MIN = 60e3, H = 3600e3;

test("median", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("rateOf: dollars per hour over the last 30 minutes", () => {
  const now = 10 * H;
  // $1 before the window, $3 by now → $2 in 30 min = $4/h.
  const s = [{ t: now - 40 * MIN, cost: 0 }, { t: now - 35 * MIN, cost: 1 }, { t: now - 10 * MIN, cost: 3 }];
  assert.deepEqual(rateOf(s, now), { perHour: 4, windowMin: 30 });
});

test("rateOf: a young series counts from its first sample; too young has no rate yet", () => {
  const now = 10 * H;
  assert.deepEqual(rateOf([{ t: now - 10 * MIN, cost: 0 }, { t: now - MIN, cost: 1 }], now), { perHour: 6, windowMin: 10 });
  assert.deepEqual(rateOf([{ t: now - 2 * MIN, cost: 0 }], now), { perHour: null, windowMin: 2 });
  assert.equal(rateOf(undefined, now), null);
});

test("rateOf: an idle session decays to zero", () => {
  const now = 10 * H;
  assert.equal(rateOf([{ t: now - 2 * H, cost: 0 }, { t: now - H, cost: 9 }], now).perHour, 0);
});

test("warnOf: spike against the team median, with a floor", () => {
  const s = { status: "idle", ctx: 0, ctxWindow: 200000, startedAt: 0, canSpawn: true };
  assert.deepEqual(warnOf(s, 9, 2, H), { reasons: ["spike"], ratio: 4.5, medianPerHour: 2, advice: "swapLead" });
  assert.equal(warnOf(s, 5, 2, H), null);
  assert.equal(warnOf(s, 0.9, 0.1, H), null); // under $1/h is noise
});

test("warnOf: long-lived on a large context", () => {
  const s = { status: "idle", ctx: 130000, ctxWindow: 200000, startedAt: 0, canSpawn: false };
  assert.deepEqual(warnOf(s, null, null, 3.5 * H), { reasons: ["longLived"], ctxShare: 0.65, hours: 3, advice: null });
  assert.equal(warnOf(s, null, null, 2 * H), null);
  assert.equal(warnOf({ ...s, status: "done" }, null, null, 5 * H), null);
});

test("Burn: rates against the team and records each session's cost per day (numbers only)", () => {
  let t = Date.parse("2026-11-05T09:00:00");
  const store = { data: { daily: {} }, save() {} };
  const burn = new Burn(store, () => t);
  const mk = (id, cost, extra = {}) => ({ id, name: id, role: "impl", cost, ctx: 0, ctxWindow: 1, startedAt: t, status: "idle", last: "secret", ...extra });
  const team = [mk("a", 0, { role: "lead", canSpawn: true }), mk("b", 0), mk("c", 0), mk("x", null)];
  for (const s of team) burn.fields(s, team);
  t += 30 * MIN;
  team[0].cost = 9; team[1].cost = 1; team[2].cost = 1;
  const lead = burn.fields(team[0], team);
  burn.fields(team[1], team); burn.fields(team[2], team);
  const again = burn.fields(team[0], team);
  assert.equal(lead.burn.perHour, 18);
  assert.deepEqual(again.burnWarn.reasons, ["spike"]);
  assert.equal(again.burnWarn.advice, "swapLead");
  assert.equal(burn.fields(team[3], team).burn, null);
  const day = store.data.daily["2026-11-05"].sessions;
  assert.deepEqual(day.a, { name: "a", role: "lead", cost: 9 });
  assert.ok(!JSON.stringify(store.data).includes("secret"));
});

test("Burn.due: an idle session's rate falls to 0 with time alone and is re-sent", () => {
  let t = Date.parse("2026-11-05T09:00:00");
  const store = { data: { daily: {} }, save() {} };
  const burn = new Burn(store, () => t);
  const s = { id: "a", name: "a", role: "impl", cost: 0, ctx: 0, ctxWindow: 1, startedAt: t, status: "idle" };
  burn.fields(s, [s]);
  t += 10 * MIN;
  s.cost = 2; // a turn ends: no further events while it sits idle
  assert.equal(burn.fields(s, [s]).burn.perHour, 12);
  assert.deepEqual(burn.due([s]), []); // nothing moved yet
  t += 31 * MIN; // no event at all; the rise has left the 30-minute window
  assert.deepEqual(burn.due([s]).map(x => x.id), ["a"]);
  assert.equal(burn.fields(s, [s]).burn.perHour, 0);
  assert.deepEqual(burn.due([s]), []);
});

test("Hub.refreshBurn: emits only the sessions whose rate moved with time", async () => {
  const { Hub } = await import("../../server/dispatch/hub.js");
  let t = Date.parse("2026-11-05T09:00:00");
  const s = { id: "a", name: "a", role: "impl", cost: 0, ctx: 0, ctxWindow: 1, startedAt: t, status: "idle" };
  const store = { data: { daily: {}, sessions: { a: s }, settings: {} }, save() {} };
  const hub = new Hub({ root: "/tmp", store, models: [], roles: [], port: 0 });
  hub.burn = new Burn(store, () => t);
  const sent = [];
  hub.on("session", x => sent.push(x.burn?.perHour));
  hub.publicSession(s);
  t += 10 * MIN; s.cost = 2; hub.publicSession(s);
  hub.refreshBurn();
  assert.deepEqual(sent, []);
  t += 31 * MIN;
  hub.refreshBurn();
  assert.deepEqual(sent, [0]);
});
