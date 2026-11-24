// Chat history store (#968) in a scratch git repo: files under .atelier/chat/, masked on the way
// to disk, images as a placeholder, git exclude, list/read/delete/clear and the HTTP routes.
// Every personal-looking value here is made up and built from parts.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createChatStore } from "../server/dispatch/chat-store.js";
import { IMAGE, MASK } from "../server/dispatch/chat-redact.js";
import { routeTable } from "../server/dispatch/routes.js";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function repo() {
  const root = mkdtempSync(path.join(tmpdir(), "atelier-chat-"));
  dirs.push(root);
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "develop");
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(path.join(root, "README.md"), "x\n");
  git("add", ".");
  git("commit", "-qm", "init");
  return { root, git };
}

const MAIL = ["fake", "example.com"].join("@");
const KEY = ["sk", "ant", "api03", "y".repeat(24)].join("-");
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);

test("save masks every text field, keeps an image placeholder only and names the file by date and id", async () => {
  const { root, git } = repo();
  let t = T0;
  const store = createChatStore(root, { now: () => t });
  const saved = await store.save({
    sessionId: "00000000-0000-4000-8000-000000000000",
    messages: [
      { role: "user", text: `send to ${MAIL} from /home/fakeuser/a.txt`, images: [{ data: "iVBORw0KGgo=" }] },
      { role: "assistant", blocks: [
        { type: "text", text: `key ${KEY}` },
        { type: "image", source: { type: "base64", data: "iVBORw0KGgoAAAA=" } },
        { type: "tool_use", name: "Bash", input: { command: "cat ~/secret/notes.txt", extra: "dropped" } },
        { type: "tool_result", content: "full output never kept" },
      ] },
      { role: "user", text: "call 010-0000-0000, 김가짜님", extra: "dropped" },
    ],
    stray: "dropped",
  });
  assert.match(saved.id, /^[a-z0-9]{16}$/);
  assert.equal(saved.title, `send to ${MASK} from ${MASK}`);
  assert.equal(saved.sessionId, "00000000-0000-4000-8000-000000000000");
  assert.deepEqual(saved.messages, [
    { role: "user", text: `send to ${MASK} from ${MASK}\n${IMAGE}` },
    { role: "assistant", text: `key ${MASK}\n${IMAGE}`, tools: [{ name: "Bash", summary: `cat ${MASK}` }] },
    { role: "user", text: `call ${MASK}, ${MASK}님` },
  ]);

  const files = readdirSync(path.join(root, ".atelier", "chat"));
  assert.deepEqual(files, [`2026-11-20-${saved.id}.json`]);
  const raw = readFileSync(path.join(root, ".atelier", "chat", files[0]), "utf8");
  for (const secret of [MAIL, KEY, "fakeuser", "iVBORw0KGgo", "010-0000", "김가짜", "dropped", "full output"]) assert.ok(!raw.includes(secret), secret);
  assert.deepEqual(JSON.parse(raw), saved);

  // Kept out of git.
  assert.match(readFileSync(path.join(root, ".git", "info", "exclude"), "utf8"), /^\/\.atelier\/chat\/$/m);
  assert.equal(git("status", "--porcelain", "--untracked-files=all"), "");

  // Saving again with the id replaces the file, keeps createdAt and the file name.
  t = T0 + 86_400_000;
  const again = await store.save({ id: saved.id, title: "새 제목 Bearer abcdefghijklmnopqrstuvwxyz0123", messages: [{ role: "user", text: "hello" }] });
  assert.equal(again.createdAt, T0);
  assert.equal(again.updatedAt, T0 + 86_400_000);
  assert.equal(again.title, `새 제목 Bearer ${MASK}`);
  assert.deepEqual(readdirSync(path.join(root, ".atelier", "chat")), files);
});

test("list is newest first, read/remove/clear work, bad ids are refused", async () => {
  const { root } = repo();
  let t = T0;
  const store = createChatStore(root, { now: () => t });
  assert.deepEqual(await store.list(), []);
  const a = await store.save({ messages: [{ role: "user", text: "첫 질문" }] });
  t += 1000;
  const b = await store.save({ title: "둘째", sessionId: "../bad id", messages: [] });
  assert.equal(b.sessionId, null);
  assert.deepEqual((await store.list()).map(c => [c.id, c.title, c.count]), [[b.id, "둘째", 0], [a.id, "첫 질문", 1]]);
  assert.equal((await store.read(a.id)).messages[0].text, "첫 질문");
  assert.equal(await store.read("0000000000000000"), null);
  await assert.rejects(store.read("../../x"), { status: 400 });
  await assert.rejects(store.save({ id: "0000000000000000" }), { status: 404 });
  assert.equal(await store.remove(a.id), true);
  assert.equal(await store.remove(a.id), false);
  assert.equal(await store.clear(), 1);
  assert.deepEqual(await store.list(), []);
});

test("routes: GET list and one, POST save, DELETE one and all", async () => {
  const { root } = repo();
  const table = routeTable({ root, store: {}, hub: {}, models: [], broadcast: () => {} });
  const call = (method, p, body = {}) => {
    const hit = table.find(([m, re]) => m === method && re.test(p));
    assert.ok(hit, `${method} ${p}`);
    return hit[2](p.match(hit[1]).slice(1), body, new URL(`http://127.0.0.1${p}`));
  };
  const { chat } = await call("POST", "/api/chats", { messages: [{ role: "user", text: `mail ${MAIL}` }] });
  assert.equal(chat.title, `mail ${MASK}`);
  assert.deepEqual((await call("GET", "/api/chats")).chats.map(c => c.id), [chat.id]);
  assert.equal((await call("GET", `/api/chats/${chat.id}`)).chat.id, chat.id);
  await assert.rejects(call("GET", "/api/chats/0000000000000000"), { status: 404 });
  assert.deepEqual(await call("DELETE", `/api/chats/${chat.id}`), { ok: true });
  await assert.rejects(call("DELETE", `/api/chats/${chat.id}`), { status: 404 });
  await call("POST", "/api/chats", { messages: [{ role: "user", text: "a" }] });
  assert.deepEqual(await call("DELETE", "/api/chats"), { removed: 1 });
});
