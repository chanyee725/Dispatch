// The Dispatch state file: writes run one at a time, and close() writes the last state and stops writing,
// so a child that exits after shutdown cannot race the next server on the same .dispatch/state.json (E205).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../server/dispatch/dispatch-store.js";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(path.join(tmpdir(), "drawing-store-")); dirs.push(d); return d; };

test("store: flushes that overlap do not trip over the shared temp file", async () => {
  const root = scratch();
  const store = new Store(root);
  store.data.seq = 1;
  const writes = Array.from({ length: 8 }, (_, i) => { store.data.seq = i + 1; return store.flush(); });
  await Promise.all(writes);
  assert.equal(JSON.parse(readFileSync(store.file, "utf8")).seq, 8);
  assert.equal(existsSync(store.file + ".tmp"), false);
});

test("store: close() writes the pending save once and later saves write nothing", async () => {
  const root = scratch();
  const store = new Store(root);
  store.data.seq = 5;
  store.save();
  await store.close();
  assert.equal(JSON.parse(readFileSync(store.file, "utf8")).seq, 5);
  // A late save (a child that exits after shutdown) is dropped; a restart reads the closed state.
  store.data.seq = 6;
  store.save();
  assert.equal(store.timer, null);
  await store.writing;
  assert.equal(JSON.parse(readFileSync(store.file, "utf8")).seq, 5);
});
