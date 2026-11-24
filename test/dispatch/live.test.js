import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub } from "../../server/dispatch/hub.js";
import { commandTarget, LIVE_FILES, LIVE_RECENT, LiveTracker, liveOf, shellReadFiles, shownPath } from "../../server/dispatch/live.js";
import { applyLiveDelta } from "../../shared/dispatch/live.ts";

const CWD = "/tmp/proj/.dispatch/wt/a";
const WS = "/tmp/proj/docs";
const where = { cwd: CWD, workspaceDir: WS };

test("liveOf: Claude read, edit, search and shell calls", () => {
  assert.deepEqual(liveOf("Read", JSON.stringify({ file_path: `${CWD}/src/a.ts` }), where),
    { kind: "read", label: "코드 읽기", tool: "Read", target: "src/a.ts", files: [{ path: "src/a.ts", doc: false, edited: false }] });
  assert.deepEqual(liveOf("Edit", JSON.stringify({ file_path: `${CWD}/src/a.ts`, old_string: "x", new_string: "y" }), where).files,
    [{ path: "src/a.ts", doc: false, edited: true }]);
  const g = liveOf("Grep", JSON.stringify({ pattern: "useAgent" }), where);
  assert.deepEqual([g.kind, g.target, g.files], ["search", "useAgent", []]);
  const b = liveOf("Bash", JSON.stringify({ command: "CI=1 npm test -- app.spec\necho more" }), where);
  assert.deepEqual([b.kind, b.label, b.target], ["test", "단위 테스트", "npm test -- app.spec"]);
});

test("liveOf: clipped JSON still yields the file", () => {
  const text = JSON.stringify({ file_path: `${CWD}/web/big.tsx`, content: "x".repeat(2000) }).slice(0, 600) + "…";
  assert.equal(liveOf("Write", text, where).target, "web/big.tsx");
});

test("liveOf: Codex shell and file_change, Gemini tools, MCP", () => {
  assert.deepEqual(liveOf("shell", "git commit -m 'msg'", where).label, "커밋");
  const e = liveOf("edit", `update ${CWD}/a.js\nadd ${CWD}/b.js`, where);
  assert.deepEqual([e.kind, e.target, e.files.map(f => f.path)], ["edit", "a.js", ["a.js", "b.js"]]);
  assert.equal(liveOf("read_file", JSON.stringify({ absolute_path: `${CWD}/x.md` }), where).kind, "read");
  assert.equal(liveOf("replace", JSON.stringify({ file_path: `${CWD}/x.md` }), where).kind, "edit");
  assert.equal(liveOf("run_shell_command", JSON.stringify({ command: "npx vitest run" }), where).kind, "test");
  const m = liveOf("mcp__plugin_playwright_playwright__browser_snapshot", "{}", where);
  assert.deepEqual([m.kind, m.tool, m.label], ["browser", "browser_snapshot", "화면 확인"]);
});

test("shownPath: documents are workspace-relative, outside paths keep only the basename, .env is dropped", () => {
  assert.deepEqual(shownPath(`${WS}/plans/p.dpx.json`, where), { path: "plans/p.dpx.json", doc: true });
  assert.deepEqual(shownPath("/home/someone/.config/app/settings.json", where), { path: "settings.json", doc: false, outside: true });
  assert.deepEqual(shownPath("./src/a.ts", where), { path: "src/a.ts", doc: false });
  assert.equal(shownPath(`${CWD}/.env`, where), null);
  assert.equal(shownPath(`${CWD}/server/.env.local`, where), null);
  assert.equal(shownPath("", where), null);
});

test("commandTarget: first line, no env assignments, masked, clipped", () => {
  assert.equal(commandTarget("TOKEN=abc123 curl -s http://127.0.0.1"), "curl -s http://127.0.0.1");
  assert.ok(!commandTarget("curl -H 'Authorization: Bearer sk-ant-abcdefghijklmnopq' x").includes("sk-ant"));
  assert.equal(commandTarget("x".repeat(200)).length, 80);
});

function tracker(flushMs = 250) {
  let t = 1000;
  const events = [];
  const tr = new LiveTracker({ emit: ev => events.push(ev), workspaceDir: WS, flushMs, now: () => t });
  return { tr, events, advance: ms => { t += ms; } };
}

test("tracker: first change is sent at once, later ones coalesce into one delta", () => {
  const { tr, events, advance } = tracker();
  const s = { id: "a", cwd: CWD };
  tr.note(s, { kind: "tool", id: 1, name: "Read", text: JSON.stringify({ file_path: `${CWD}/a.ts` }), at: 1, callId: "c0" });
  assert.equal(events.length, 1);
  assert.equal(events[0].current.target, "a.ts");
  tr.note(s, { kind: "tool_result", id: 2, text: "body", callId: "c0" });
  tr.note(s, { kind: "tool", id: 3, name: "Edit", text: JSON.stringify({ file_path: `${CWD}/a.ts` }), at: 3, callId: "c1" });
  tr.note(s, { kind: "tool_result", id: 4, text: "boom", error: true, callId: "c1" });
  tr.note(s, { kind: "tool", id: 5, name: "Bash", text: JSON.stringify({ command: "npm run build" }), at: 5, callId: "c2" });
  assert.equal(events.length, 1, "inside the 250 ms window nothing more is sent");
  advance(250);
  tr.flush("a");
  assert.equal(events.length, 2);
  const d = events[1];
  assert.deepEqual(d.actions.map(x => [x.id, x.target, x.ok]), [[5, "npm run build", undefined], [3, "a.ts", false], [1, "a.ts", true]]);
  assert.deepEqual(d.files, [{ path: "a.ts", edited: true, at: 3, doc: false }]);
  assert.equal(d.current.id, 5);
  tr.flush("a");
  assert.equal(events.length, 2, "nothing changed, nothing sent");
  tr.drop("a");
});

test("tracker: Codex final entries and Gemini in-order results finish actions", () => {
  const { tr } = tracker(0);
  tr.note({ id: "c", cwd: CWD }, { kind: "tool", id: 1, name: "shell", text: "ls", final: true, error: true });
  assert.deepEqual([tr.snapshot("c").current, tr.snapshot("c").recent[0].ok], [null, false]);
  tr.note({ id: "g", cwd: CWD }, { kind: "tool", id: 1, name: "read_file", text: JSON.stringify({ file_path: `${CWD}/r.md` }) });
  assert.equal(tr.snapshot("g").current.id, 1);
  tr.note({ id: "g", cwd: CWD }, { kind: "tool_result", id: 2, text: "out", error: false });
  assert.deepEqual([tr.snapshot("g").current, tr.snapshot("g").recent[0].ok], [null, true]);
});

test("tracker: caps, idle, document writes, unknown ids", () => {
  const { tr, events } = tracker(0);
  const s = { id: "a", cwd: CWD };
  for (let i = 0; i < LIVE_FILES + 10; i++) tr.note(s, { kind: "tool", id: i + 1, name: "Read", text: JSON.stringify({ file_path: `${CWD}/f${i}.ts` }), at: i });
  tr.note(s, { kind: "tool", id: 100, name: "Edit", text: JSON.stringify({ file_path: `${CWD}/f0.ts` }) });
  tr.noteDoc("a", "plans/p.dpx.json", 5);
  tr.noteDoc("a", ".env", 6);
  const snap = tr.snapshot("a");
  assert.equal(snap.recent.length, LIVE_RECENT);
  assert.equal(snap.recent[0].id, 100);
  assert.equal(snap.files.length, LIVE_FILES);
  assert.deepEqual(snap.files.slice(0, 2).map(f => [f.path, f.edited, f.doc]), [["plans/p.dpx.json", true, true], ["f0.ts", true, false]]);
  tr.idle("a");
  assert.equal(events.at(-1).current, null);
  assert.deepEqual(tr.snapshot("zzz"), { sid: "zzz", current: null, recent: [], files: [] });
});

test("applyLiveDelta: upserts actions and files, clears a finished current", () => {
  const { tr, events } = tracker(0);
  const s = { id: "a", cwd: CWD };
  let live = tr.snapshot("a");
  tr.note(s, { kind: "tool", id: 1, name: "Edit", text: JSON.stringify({ file_path: `${CWD}/a.ts` }), callId: "c" });
  tr.note(s, { kind: "tool", id: 2, name: "Read", text: JSON.stringify({ file_path: `${CWD}/b.ts` }), callId: "d" });
  tr.note(s, { kind: "tool_result", id: 3, text: "", callId: "d" });
  for (const ev of events) live = applyLiveDelta(live, ev);
  assert.deepEqual(live, tr.snapshot("a"));
  assert.equal(applyLiveDelta(live, { sid: "other", current: null }), live);
});

// A Hub stand-in with just what push() and touch() reach for.
function fakeHub(s) {
  const events = [];
  const hub = Object.assign(Object.create(Hub.prototype), {
    live: new Map(), store: { data: { sessions: { [s.id]: s } }, save() {} },
    liveView: new LiveTracker({ emit: ev => events.push(ev), workspaceDir: WS, flushMs: 0 }),
    emit() {},
  });
  return { hub, events };
}

test("hub: live events carry no transcript text, tool output, secrets or home paths", () => {
  const s = { id: "a", cwd: CWD, status: "running", parent: null, updatedAt: 0 };
  const { hub, events } = fakeHub(s);
  hub.push(s, { kind: "assistant", text: "private reasoning text" });
  hub.push(s, { kind: "tool", name: "Bash", text: JSON.stringify({ command: "curl -H 'Authorization: Bearer sk-ant-abcdefghijklmnop' http://127.0.0.1" }), callId: "c" });
  hub.push(s, { kind: "tool_result", text: "secret output", error: true, callId: "c" });
  hub.push(s, { kind: "tool", name: "Write", text: JSON.stringify({ file_path: `${CWD}/notes.md`, content: "private file body" }) });
  hub.push(s, { kind: "tool", name: "Read", text: JSON.stringify({ file_path: "/home/someone/secret/.env" }) });
  const all = JSON.stringify([events, hub.liveState("a")]);
  for (const bad of ["private reasoning", "secret output", "sk-ant", "private file body", "/tmp/proj", "/home/someone", ".env"]) assert.ok(!all.includes(bad), bad);
  const live = hub.liveState("a");
  assert.deepEqual(live.recent.map(x => x.target), ["", "notes.md", live.recent[2].target]);
  assert.equal(live.recent[2].ok, false);
  hub.touch(s, { status: "idle" });
  assert.equal(hub.liveState("a").current, null);
});

test("commandTarget: home folders and the session folder never reach the UI", () => {
  const t = commandTarget(`cd ${CWD} && cat ${CWD}/src/x.ts /home/someone/work/a /Users/jane/x /root/y`, where);
  assert.equal(t, "cd . && cat src/x.ts ~/work/a ~/x ~/y");
  assert.equal(liveOf("Bash", JSON.stringify({ command: "ls /home/someone/secret" }), where).target, "ls ~/secret");
});

test("tracker: a re-touched file comes first in the delta", () => {
  const { tr, events } = tracker(1000);
  const s = { id: "a", cwd: CWD };
  const read = (id, f) => tr.note(s, { kind: "tool", id, name: "Read", text: JSON.stringify({ file_path: `${CWD}/${f}` }), final: true });
  read(1, "x");
  read(2, "a"); read(3, "b"); read(4, "a");
  tr.flush("a");
  assert.deepEqual(events.at(-1).files.map(f => f.path), ["a", "b"]);
  const live = events.reduce((l, ev) => applyLiveDelta(l, ev), { sid: "a", current: null, recent: [], files: [] });
  assert.deepEqual(live.files.map(f => f.path), tr.snapshot("a").files.map(f => f.path));
});

test("tracker: unknown ids (outside writers, removed sessions) get no state", () => {
  const ids = new Set(["a"]);
  const tr = new LiveTracker({ emit() {}, workspaceDir: WS, flushMs: 0, known: id => ids.has(id) });
  tr.noteDoc("outside:zz", "p.dpx.json", 1);
  assert.equal(tr.byId.has("outside:zz"), false);
  ids.delete("a");
  tr.note({ id: "a", cwd: CWD }, { kind: "tool", id: 1, name: "Read", text: "{}" });
  assert.equal(tr.byId.has("a"), false);
});

test("tracker: a file read outside the session's folder is marked outside, inside ones are not", () => {
  const { tr } = tracker(1000);
  const s = { id: "a", cwd: CWD };
  tr.note(s, { kind: "tool", id: 1, name: "Read", text: JSON.stringify({ file_path: "/etc/hosts" }), final: true });
  tr.note(s, { kind: "tool", id: 2, name: "Read", text: JSON.stringify({ file_path: `${CWD}/src/a.ts` }), final: true });
  const files = tr.snapshot("a").files;
  assert.equal(files.find(f => f.path === "hosts")?.outside, true);
  assert.equal("outside" in files.find(f => f.path === "src/a.ts"), false);
});

test("shellReadFiles: cat, sed -n, head and cd-prefixed reads name their files; globs, sed -i and other commands do not", () => {
  const paths = cmd => shellReadFiles(cmd, where).map(f => f.path);
  assert.deepEqual(paths("cat src/a.ts"), ["src/a.ts"]);
  assert.deepEqual(paths("sed -n 1,20p web/x.tsx"), ["web/x.tsx"]);
  assert.deepEqual(paths(`cd ${CWD} && sed -n 40,110p server/live.js`), ["server/live.js"]);
  assert.deepEqual(paths("head -n 5 a.ts b.ts | wc -l"), ["a.ts", "b.ts"]);
  assert.deepEqual(paths("sed -n p a.ts > out.txt"), ["a.ts"]);
  assert.deepEqual(paths("cat *.ts"), []);
  assert.deepEqual(paths("sed -i s/a/b/ a.ts"), []);
  assert.deepEqual(paths("grep -n foo a.ts"), []);
  assert.deepEqual(shellReadFiles("cat /etc/hosts", where), [{ path: "hosts", doc: false, outside: true, edited: false }]);
  assert.deepEqual(paths(`cat ${CWD}/.env`), []);
});

test("liveOf: a shell read is a read of its first file, with the file in the list", () => {
  const r = liveOf("Bash", JSON.stringify({ command: `cd ${CWD} && sed -n 1,9p web/a.tsx` }), where);
  assert.deepEqual([r.kind, r.label, r.target, r.files], ["read", "코드 읽기", "web/a.tsx", [{ path: "web/a.tsx", doc: false, edited: false }]]);
  assert.deepEqual(liveOf("Bash", JSON.stringify({ command: "ls src" }), where).files, []);
});
