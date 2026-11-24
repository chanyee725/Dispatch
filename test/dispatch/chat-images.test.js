// Chat images (#968 s2): POST /api/sessions/:id/message takes images [{ mediaType, data }] for Claude sessions;
// the CLI gets content blocks, the transcript keeps only "[이미지 N장]".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";
import { staticModels } from "../../server/dispatch/models.js";
import { ROLES } from "../../server/dispatch/roles.js";
import { Hub, userContent } from "../../server/dispatch/hub.js";
import { checkImages, IMAGE_LIMITS, messageBody, routeTable } from "../../server/dispatch/routes.js";

const png = { mediaType: "image/png", data: "iVBORw0KGgo=" };

test("messageBody: text alone as before; images make empty text fine", () => {
  assert.deepEqual(messageBody({ text: " hi " }), { text: "hi", images: null });
  assert.throws(() => messageBody({ text: " " }), /text가 비어 있어요/);
  assert.deepEqual(messageBody({ text: "", images: [png] }), { text: "", images: [png] });
  assert.deepEqual(messageBody({ text: "look", images: [] }), { text: "look", images: null });
  assert.throws(() => messageBody({ text: "", images: [] }), /text가 비어 있어요/);
});

test("checkImages: count, type, size and base64 shape are enforced", () => {
  assert.throws(() => checkImages("x"), e => e.status === 400);
  assert.throws(() => checkImages(Array(IMAGE_LIMITS.max + 1).fill(png)), /4장까지/);
  assert.throws(() => checkImages([{ mediaType: "image/svg+xml", data: "AAAA" }]), /PNG, JPEG, GIF, WebP/);
  assert.throws(() => checkImages([{ mediaType: "image/png", data: "not base64!" }]), /올바르지 않아요/);
  assert.throws(() => checkImages([{ mediaType: "image/png", data: "A".repeat(IMAGE_LIMITS.base64Bytes + 4) }]), /5MB/);
  // Extra fields are dropped.
  assert.deepEqual(checkImages([{ ...png, name: "a.png" }]), [png]);
  for (const t of IMAGE_LIMITS.types) assert.equal(checkImages([{ mediaType: t, data: "AAAA" }])[0].mediaType, t);
});

test("message route passes images to hub.send and keeps text-only calls unchanged", async () => {
  const calls = [];
  const hub = { send: (...a) => calls.push(a) };
  const table = routeTable({ root: "/x", store: {}, hub, models: [], broadcast: () => {} });
  const entry = table.find(([m, re]) => m === "POST" && re.test("/api/sessions/a1/message"));
  assert.ok(entry[3].maxBody >= IMAGE_LIMITS.max * IMAGE_LIMITS.base64Bytes, "the route reads a body big enough for 4 images");
  await entry[2](["a1"], { text: "hi" });
  await entry[2](["a1"], { images: [png] });
  assert.deepEqual(calls, [["a1", "hi", undefined], ["a1", "", { images: [png] }]]);
});

test("userContent: plain text without images, image blocks then text with them", () => {
  assert.equal(userContent("hi", null), "hi");
  assert.equal(userContent("hi", []), "hi");
  assert.deepEqual(userContent("hi", [png]), [
    { type: "image", source: { type: "base64", media_type: "image/png", data: png.data } },
    { type: "text", text: "hi" },
  ]);
  assert.deepEqual(userContent("", [png]).map(b => b.type), ["image"]);
});

// A Hub stand-in with what send() and deliver() reach for on a running Claude session.
function fakeHub(s) {
  const lines = [];
  const proc = { stdin: { write: l => lines.push(JSON.parse(l)) } };
  const r = { proc, transcript: [], seq: 0, perms: new Map() };
  const hub = Object.assign(Object.create(Hub.prototype), {
    live: new Map([[s.id, r]]), store: { data: { sessions: { [s.id]: s }, settings: { team: {} }, guard: {} }, save() {} },
    emit() {}, runBlock: () => null, replaceDue: () => false, shouldRotate: () => false, cancelAutoRemove() {}, touch() {},
  });
  Object.defineProperty(hub, "paused", { get: () => false });
  return { hub, lines, r };
}

test("hub.send: a running Claude session gets content blocks; the transcript gets only the count", () => {
  const s = { id: "a", name: "Mina", provider: "claude", status: "running" };
  const { hub, lines, r } = fakeHub(s);
  hub.send("a", "what is this", { images: [png, png] });
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].message.content.map(b => b.type), ["image", "image", "text"]);
  assert.equal(r.transcript.at(-1).text, "what is this\n[이미지 2장]");
  assert.doesNotMatch(JSON.stringify(r.transcript), new RegExp(png.data.replace(/[+/=]/g, ".")));
  hub.send("a", "plain");
  assert.equal(lines[1].message.content, "plain", "text-only stays a string");
});

test("hub.send: images to a non-Claude session are refused", () => {
  const s = { id: "a", name: "Mina", provider: "openai", status: "idle" };
  const { hub, lines } = fakeHub(s);
  assert.throws(() => hub.send("a", "x", { images: [png] }), e => e.status === 400);
  assert.equal(lines.length, 0);
});

// A real Hub in a temp root that records start() instead of spawning a CLI.
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
async function realHub() {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-968-images-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  const hub = new Hub({ root, store, models: staticModels(), roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")) });
  hub.isConnected = () => true;
  const started = [];
  hub.start = (s, prompt, images) => started.push({ id: s.id, prompt, images, resume: s.providerSessionId });
  return { hub, started };
}
const helper = (over = {}) => ({ role: "lead", model: "claude-sonnet-5-5", perm: "auto", n: 1, ...over });

test("create: the helper's first message carries images; the transcript keeps the count", async () => {
  const { hub, started } = await realHub();
  const [s] = await hub.create({ items: [helper()], commonPrompt: "", worktree: false, images: [png] });
  assert.deepEqual(started[0].images, [png]);
  assert.equal(started[0].prompt, "");
  assert.equal(hub.transcript(s.id).at(-1).text, "[이미지 1장]");
  await assert.rejects(hub.create({ items: [helper({ n: 2 })], commonPrompt: "x", worktree: false, images: [png] }), e => e.status === 400);
});

test("create: an item's resume id becomes the CLI session to continue; bad ids are refused", async () => {
  const { hub, started } = await realHub();
  await hub.create({ items: [helper({ resume: "abc-123_DEF" })], commonPrompt: "next", worktree: false });
  assert.equal(started[0].resume, "abc-123_DEF");
  await assert.rejects(hub.create({ items: [helper({ resume: "../x" })], commonPrompt: "x", worktree: false }), e => e.status === 400);
  await hub.create({ items: [helper()], commonPrompt: "fresh", worktree: false });
  assert.equal(started[1].resume, null);
});

test("POST /api/sessions passes checked images to hub.create", async () => {
  const calls = [];
  const table = routeTable({ root: "/x", store: {}, hub: { create: async a => { calls.push(a); return []; } }, models: [], broadcast: () => {} });
  const entry = table.find(([m, re]) => m === "POST" && re.test("/api/sessions"));
  await entry[2]([], { items: [helper()], commonPrompt: "hi" });
  await entry[2]([], { items: [helper()], commonPrompt: "", images: [png] });
  assert.equal(calls[0].images, undefined);
  assert.deepEqual(calls[1].images, [png]);
  await assert.rejects(entry[2]([], { items: [helper()], images: [{ mediaType: "text/html", data: "AAAA" }] }), e => e.status === 400);
});
