// E56 agent cursor colours (#249): one random palette colour per session, kept for the whole session; white text on
// every colour passes WCAG AA (4.5:1) on both themes; no purple.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AGENT_COLORS, pickColor } from "../../server/dispatch/colors.js";
import { Hub } from "../../server/dispatch/hub.js";
import { diskView, Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hue = (hex) => {
  const [r, g, b] = rgb(hex);
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (!d) return null;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

// The name tag is white text on the session colour in both themes (web/src/index.css).
const css = readFileSync(new URL("../../web/src/index.css", import.meta.url), "utf8");

test("palette: white text on every colour has contrast >= 4.5, no purple, no repeats", () => {
  assert.ok(AGENT_COLORS.length >= 6);
  assert.equal(new Set(AGENT_COLORS).size, AGENT_COLORS.length);
  for (const c of AGENT_COLORS) {
    assert.match(c, /^#[0-9a-f]{6}$/);
    assert.ok(contrast(c, "#ffffff") >= 4.5, `${c}: ${contrast(c, "#ffffff").toFixed(2)}`);
    const h = hue(c);
    assert.ok(h !== null && !(h >= 250 && h <= 330), `${c} is purple-ish (hue ${h})`);
  }
  // The tag's text is white in both themes, and the fallback colour (a cursor event without one) passes too.
  const tag = css.match(/\.agent-cursor-tag \{[^}]*\}/)?.[0] ?? "";
  assert.match(tag, /(?<![-\w])color: #fff;/);
  const fallback = css.match(/\.agent-cursor \{[^}]*--agent: (#[0-9a-f]{6})/)?.[1];
  assert.ok(fallback && contrast(fallback, "#ffffff") >= 4.5, `fallback ${fallback}`);
  // No theme overrides the cursor colour: one value for dark and light.
  assert.doesNotMatch(css, /\[data-theme[^\]]*\][^{]*\.agent-cursor/);
});

test("pickColor: random, prefers colours no session has yet", () => {
  assert.equal(pickColor([], () => 0), AGENT_COLORS[0]);
  assert.equal(pickColor([], () => 0.9999), AGENT_COLORS.at(-1));
  assert.equal(pickColor([AGENT_COLORS[0]], () => 0), AGENT_COLORS[1]);
  // All taken: any palette colour.
  assert.ok(AGENT_COLORS.includes(pickColor(AGENT_COLORS, Math.random)));
  const seen = new Set(Array.from({ length: 200 }, () => pickColor()));
  assert.ok(seen.size > 1, "not a fixed colour");
});

const MODELS = [{ id: "claude-fable-5-2", provider: "claude", efforts: ["low"], contextWindow: 200000 }];
const ROLES = [{ id: "impl", name: "구현자", model: "claude-fable-5-2", perm: "plan", prompt: "ROLE PROMPT" }];

test("a session gets its colour when it is created, keeps it, and it is saved as metadata", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-colors-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  store.save = () => {};
  // An older session without a colour gets one on load.
  store.data.sessions.old = { id: "old", n: 1, name: "Juno", role: "impl", status: "idle", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")),
    spawnCli: () => { throw Object.assign(new Error("no CLI in this test"), { code: "ECLIDENIED" }); } });
  after(() => hub.stopAll());
  assert.ok(AGENT_COLORS.includes(store.data.sessions.old.color));
  const made = await hub.create({ items: [{ role: "impl", n: 2 }], commonPrompt: "hi", worktree: false });
  assert.equal(made.length, 2);
  const colors = made.map((s) => s.color);
  for (const c of colors) assert.ok(AGENT_COLORS.includes(c), c);
  // Three sessions, eight colours: all different.
  assert.equal(new Set([store.data.sessions.old.color, ...colors]).size, 3);
  // Kept through status changes.
  const s = store.data.sessions[made[0].id];
  hub.mark(s, { status: "idle" });
  assert.equal(hub.publicSession(s).color, colors[0]);
  assert.equal(diskView(store.data).sessions[s.id].color, colors[0]);
});

test("a colour given to an older session on load is saved, so a restart keeps it", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-colors-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  store.data.sessions.old = { id: "old", n: 1, name: "Juno", role: "impl", status: "idle", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let saves = 0;
  const save = store.save.bind(store);
  store.save = () => { saves++; return save(); };
  const make = (st) => new Hub({ root, store: st, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")),
    spawnCli: () => { throw Object.assign(new Error("no CLI in this test"), { code: "ECLIDENIED" }); } });
  const hub = make(store);
  after(() => hub.stopAll());
  const color = store.data.sessions.old.color;
  assert.ok(AGENT_COLORS.includes(color));
  assert.equal(saves, 1);
  await store.flush();
  // A restart reads the same colour back and does not save again.
  const again = new Store(root);
  await again.load();
  assert.equal(again.data.sessions.old.color, color);
  let saves2 = 0;
  again.save = () => { saves2++; };
  const hub2 = make(again);
  after(() => hub2.stopAll());
  assert.equal(again.data.sessions.old.color, color);
  assert.equal(saves2, 0);
});
