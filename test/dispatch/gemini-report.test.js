// #831: a Gemini (agy) teammate's final answer becomes its `last` and reaches its lead as "[이름(역할) 보고]", run
// through the fake agy (test/fixtures/fake-cli/agy.mjs). agy's stream-json sends the answer as text_delta chunks
// (deltas, not the whole text); the result may carry no `response`, may be the last line without a trailing
// newline, or may be missing when agy exits.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { fakeCliBin, fakeSpawner, until } from "../fixtures/fake-cli/index.mjs";

const MODELS = [
  { id: "claude-fable-5-2", provider: "claude", efforts: ["low"], contextWindow: 200000 },
  { id: "gemini-fake-flash", provider: "gemini", efforts: ["low"], contextWindow: 1000000 },
];
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const delta = text => ({ event: "step_update", step_update: { step_type: "agent_response", text_delta: text, usage: { input_tokens: 1, output_tokens: 1 } } });

async function run(lines) {
  const t = setup(lines);
  t.hub.startGemini(t.kid, "테스트 돌려줘");
  await until(() => t.sent.length && !t.hub.rt("K").proc);
  return t;
}

function setup(lines) {
  const bin = fakeCliBin({ scenarios: { agy: lines } });
  dirs.push(bin.dir);
  const root = mkdtempSync(path.join(tmpdir(), "gemini-report-"));
  dirs.push(root);
  const store = { data: { seq: 0, sessions: {}, tasks: {}, tickets: {}, settings: { guard: { enabled: false } } }, save() {}, addDaily() {} };
  const hub = new Hub({ root, store, models: MODELS, roles: [], port: 0, limits: Object.assign(new EventEmitter(), { claude: {} }), spawnCli: fakeSpawner(bin) });
  after(() => hub.stopAll());
  const usage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  const sent = [];
  store.data.sessions.L = { id: "L", name: "Dex", roleName: "관리자", role: "lead", provider: "claude", model: "claude-fable-5-2", status: "idle", usage: usage(), turns: 1, canSpawn: true };
  hub.rt("L").proc = { stdin: { write: l => sent.push(JSON.parse(l).message.content) }, kill() {} };
  const kid = store.data.sessions.K = { id: "K", name: "Wes", roleName: "테스터", role: "test", parent: "L", provider: "gemini", model: "gemini-fake-flash",
    perm: "auto", cwd: root, status: "idle", usage: usage(), turns: 0, last: "" };
  return { hub, kid, sent, bin };
}

const pause = ms => new Promise(r => setTimeout(r, ms));
const reports = sent => sent.filter(t => /^\[Wes\(테스터\) 보고/.test(t));

test("text_delta chunks add up to the answer, and a result without response still reports it", async () => {
  const { kid, sent } = await run([
    { event: "init", conversation_id: "c1" },
    delta("테스트 "), delta("통과했어요"),
    { event: "result", result: { status: "OK" } },
  ]);
  assert.equal(kid.last, "테스트 통과했어요");
  assert.match(sent[0], /^\[Wes\(테스터\) 보고\]\n테스트 통과했어요/);
  assert.equal(kid.status, "idle");
});

test("a turn that ends without a result event still reports what agy said", async () => {
  const { kid, sent } = await run([{ event: "init", conversation_id: "c2" }, delta("끝났어요")]);
  assert.equal(kid.last, "끝났어요");
  assert.match(sent[0], /^\[Wes\(테스터\) 보고\]\n끝났어요/);
});

test("a result on the last line without a trailing newline is read", async () => {
  const { kid, sent } = await run([
    { event: "init", conversation_id: "c3" },
    { $raw: JSON.stringify({ event: "result", result: { status: "OK", response: "최종 답변" } }) },
  ]);
  assert.equal(kid.last, "최종 답변");
  assert.match(sent[0], /^\[Wes\(테스터\) 보고\]\n최종 답변/);
});

test("one report per turn when deltas and a result both arrive", async () => {
  const { sent } = await run([delta("a"), delta("b"), { event: "result", result: { status: "OK", response: "ab" } }]);
  assert.equal(sent.filter(t => t.includes("보고]")).length, 1);
  assert.match(sent[0], /\nab/);
});

test("an interrupted agy turn sends only the [중단] note: no second report, no extra turn", async () => {
  const gate = path.join(mkdtempSync(path.join(tmpdir(), "gemini-gate-")), "never");
  dirs.push(path.dirname(gate));
  const { hub, kid, sent } = setup([delta("half "), { $waitFor: gate }]);
  hub.startGemini(kid, "go");
  await until(() => kid.last === "half ");
  hub.interrupt("K");
  await until(() => !hub.rt("K").proc);
  await pause(200); // the process's close comes after its exit
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^\[Wes\(테스터\) 중단\]/);
  assert.equal(reports(sent).length, 0);
  assert.equal(kid.turns, 0);
});

test("after rotate() the old agy closing leaves the new turn running and reports nothing of its own", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gemini-gate-"));
  dirs.push(dir);
  const gate = path.join(dir, "go");
  const { hub, kid, sent, bin } = setup([delta("x "), { $waitFor: gate }, { event: "result", result: { status: "OK" } }]);
  hub.startGemini(kid, "go");
  await until(() => kid.last === "x ");
  const old = hub.rt("K").proc;
  const oldClosed = new Promise(r => old.on("close", r));
  hub.rotate(kid, "next");
  await oldClosed;
  await until(() => bin.calls().filter(c => c.bin === "agy").length === 2);
  await pause(100);
  assert.deepEqual(sent, []);
  assert.equal(kid.status, "running");
  writeFileSync(gate, "");
  await until(() => sent.length && !hub.rt("K").proc);
  assert.equal(reports(sent).length, 1);
  assert.match(sent[0], /보고\]\nx $/, "only the new turn's text");
});

test("stopAll() (server shutdown) reports nothing for a running agy turn", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gemini-gate-"));
  dirs.push(dir);
  const { hub, kid, sent } = setup([delta("y "), { $waitFor: path.join(dir, "never") }]);
  hub.startGemini(kid, "go");
  await until(() => kid.last === "y ");
  const proc = hub.rt("K").proc;
  const closed = new Promise(r => proc.on("close", r));
  hub.stopAll();
  await closed;
  await pause(50);
  assert.deepEqual(sent, []);
  assert.equal(kid.turns, 0);
});

test("without text_delta, step_update.text is the answer so far: replaced, not appended", () => {
  const { hub, kid } = setup([]);
  hub.onGemini(kid, { event: "step_update", step_update: { step_type: "agent_response", text: "ab" } });
  hub.onGemini(kid, { event: "step_update", step_update: { step_type: "agent_response", text: "abc" } });
  assert.equal(kid.last, "abc");
});

// #846: a later turn (agy resumed with --conversation) replaces `last` and reaches the lead, also when it ends
// with no answer. Shapes are agy 1.5's stream-json: the answer of a turn that ran a tool needing a permission
// headless mode cannot ask for is an empty response plus denied_actions, with no text_delta at all.
async function twoTurns(second) {
  const t = setup([
    { event: "init", conversation_id: "conv-1" },
    delta("준비됐어요"),
    { event: "result", result: { status: "SUCCESS", response: "준비됐어요" } },
  ]);
  t.hub.startGemini(t.kid, "준비되면 알려줘");
  await until(() => t.sent.length === 1 && !t.hub.rt("K").proc);
  writeFileSync(t.bin.env.FAKE_CLI_SCENARIO_AGY, second.map(l => JSON.stringify(l)).join("\n") + "\n");
  t.hub.send("K", "작업 시작해");
  await until(() => t.sent.length === 2 && !t.hub.rt("K").proc);
  return t;
}

test("the second (resumed) agy turn's answer replaces last and reaches the lead", async () => {
  const { kid, sent, bin } = await twoTurns([
    { event: "init", conversation_id: "conv-1" },
    { event: "step_update", step_update: { step_index: 2, state: "DONE", step_type: "user_input" } },
    delta("디자인 "), delta("검토 끝났어요"),
    { event: "result", result: { status: "SUCCESS", response: "디자인 검토 끝났어요\n" } },
  ]);
  const agy = bin.calls().filter(c => c.bin === "agy");
  assert.equal(agy.length, 2);
  assert.ok(agy[1].args.includes("--conversation") && agy[1].args.includes("conv-1"), "the second turn resumes");
  assert.match(sent[0], /^\[Wes\(테스터\) 보고\]\n준비됐어요/);
  assert.match(sent[1], /^\[Wes\(테스터\) 보고\]\n디자인 검토 끝났어요/);
  assert.equal(kid.last, "디자인 검토 끝났어요\n");
  assert.equal(kid.turns, 2);
  assert.equal(kid.status, "idle");
});

test("a second turn that ends on a denied tool with an empty response still replaces last and reports", async () => {
  const { kid, sent } = await twoTurns([
    { event: "init", conversation_id: "conv-1" },
    { event: "step_update", step_update: { step_type: "agent_response", state: "DONE", usage: { input_tokens: 5, output_tokens: 37 } } },
    { event: "step_update", step_update: { step_type: "tool", state: "ACTIVE", tool_name: "run_command", tool_info: { parameters: { CommandLine: "npm test" } } } },
    { event: "step_update", step_update: { step_type: "tool", state: "DONE", tool_name: "run_command" } },
    { event: "result", result: { status: "SUCCESS", response: "", denied_actions: [{ action: "command", display_name: "Bash" }] } },
  ]);
  assert.notEqual(kid.last, "준비됐어요", "the first turn's answer is not kept");
  assert.match(kid.last, /막은 도구: Bash command/);
  assert.match(sent[1], /^\[Wes\(테스터\) 보고\]\n\[Dispatch\] agy가 headless에서 허락을 물을 수 없어 막은 도구: Bash command/);
  assert.equal(kid.turns, 2);
});

test("a second turn with no answer and no result still replaces last and reports", async () => {
  const { kid, sent } = await twoTurns([{ event: "init", conversation_id: "conv-1" }]);
  assert.equal(kid.last, "[Dispatch] 답변 없이 턴이 끝났다.");
  assert.match(sent[1], /보고\]\n\[Dispatch\] 답변 없이 턴이 끝났다\./);
});

test("text said before a denied tool is kept, with the note after it", async () => {
  const { kid } = await twoTurns([
    delta("확인해 볼게요\n"),
    { event: "result", result: { status: "SUCCESS", response: "", denied_actions: [{ action: "command", display_name: "Bash" }] } },
  ]);
  assert.match(kid.last, /^확인해 볼게요\n\n\[Dispatch\] agy가/);
});
