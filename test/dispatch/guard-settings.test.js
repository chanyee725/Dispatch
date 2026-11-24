import { test } from "node:test";
import assert from "node:assert/strict";
import { GUARD_DEFAULTS, patchGuard } from "../../server/dispatch/settings.js";

const cur = { enabled: true, five: 0.9, seven: 0.85 };

test("patchGuard saves fractions in range and rounds to 1%", () => {
  assert.deepEqual(patchGuard(cur, { five: 0.8, fable: 0.7 }), { enabled: true, five: 0.8, seven: 0.85, fable: 0.7 });
  assert.equal(patchGuard(cur, { seven: 0.857 }).seven, 0.86);
});

test("patchGuard rejects out-of-range or non-numeric values", () => {
  for (const bad of [0, 0.001, 1.5, -1, "abc", "", NaN, true]) assert.throws(() => patchGuard(cur, { five: bad }), { status: 400 }, String(bad));
});

test("patchGuard cannot switch the guard off; fable null follows weekly again", () => {
  assert.equal(patchGuard(cur, { enabled: false }).enabled, true);
  assert.equal("fable" in patchGuard({ ...cur, fable: 0.7 }, { fable: null }), false);
});

test("defaults match the store's seed", () => {
  assert.equal(GUARD_DEFAULTS.five, 0.9);
  assert.equal(GUARD_DEFAULTS.seven, 0.85);
});
