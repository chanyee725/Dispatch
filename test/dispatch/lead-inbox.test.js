import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { PassThrough, Readable } from "node:stream";
import { diskView } from "../../server/dispatch/dispatch-store.js";
import { Hub } from "../../server/dispatch/hub.js";
import { onJsonLines } from "../../server/dispatch/hub-util.js";
import { adapt, routeTable } from "../../server/dispatch/routes.js";
import { patchTeam } from "../../server/dispatch/settings.js";

function fixture({ provider = "claude", limit = 4 } = {}) {
  const store = { data: { seq: 0, sessions: {}, tasks: {}, settings: { guard: { enabled: false }, team: { maxLeadInbox: limit, rotateLead: 0 } } }, save() {} };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const models = [{ id: "fake", provider, contextWindow: 100_000 }];
  const hub = new Hub({ root: "/tmp", store, models, roles: [], port: 0, limits: Object.assign(new EventEmitter(), { claude: {} }) });
  hub.refreshCodex = async () => {};
  hub.boardNote = () => "";
  const add = (id, parent = null) => (store.data.sessions[id] = {
    id, parent, name: id, roleName: parent ? "팀원" : "관리자", canSpawn: !parent, perm: "auto", provider, model: "fake",
    turns: 0, status: parent ? "idle" : "running", usage: { ...usage }, startedAt: Date.now(),
  });
  const lead = add("lead");
  const a = add("a", lead.id), b = add("b", lead.id);
  const work = [];
  const attach = (lead) => {
    const proc = Object.assign(new EventEmitter(), {
      stdin: { write: (line, callback) => { const { message } = JSON.parse(line); if (message) work.push(message.content); callback?.(); } },
      stdout: new PassThrough(), stderr: new EventEmitter(), kill() {},
    });
    hub.attach(lead, proc, provider === "claude" ? "exit" : "close");
    return proc;
  };
  const proc = attach(lead);
  hub.start = (s, text, _images, onStart) => {
    work.push(text);
    attach(s);
    hub.touch(s, { status: "running" });
    onStart?.(true);
  };
  const report = (s, text) => { hub.rt(s.id).lastText = text; hub.reportToParent(s); };
  const done = (s = lead) => hub.onClaude(s, { type: "result" });
  const inboxCount = (s = lead) => hub.publicSession(s).leadInboxCount;
  const messages = () => work.map(text => text.split("\n")[1]);
  return { hub, store, lead, a, b, work, report, done, proc, inboxCount, add, attach, messages };
}

function messagePost(hub, pathname) {
  const entry = routeTable({ hub, root: "/tmp", store: {}, models: [] })
    .find(([method, path]) => method === "POST" && path.test(pathname));
  const route = adapt(entry);
  return async (body) => {
    const req = Readable.from([JSON.stringify(body)]);
    const result = {};
    const res = {
      writeHead: (status) => { result.status = status; },
      end: (text) => { result.body = JSON.parse(text); },
    };
    await route.handler(req, res, null, route.path.exec(pathname));
    return result;
  };
}

test("busy Claude lead accepts burst traffic FIFO and drains one item per completed turn", () => {
  const { hub, lead, a, b, done, report, inboxCount, messages } = fixture();
  hub.messageLead(a.id, "first", "one");
  report(b, "second");
  hub.messageLead(a.id, "third", "three");
  assert.equal(inboxCount(), 3);
  assert.deepEqual(messages(), []);
  assert.deepEqual(hub.transcript(lead.id), []);
  for (const [index, text] of ["first", "second", "third"].entries()) {
    done();
    assert.equal(inboxCount(), 2 - index);
    assert.equal(messages().at(-1), text);
    assert.equal(messages().length, index + 1);
  }
  done();
  assert.deepEqual(messages(), ["first", "second", "third"]);
  assert.equal(hub.transcript(lead.id).filter(e => e.kind === "user").length, 3);
});

test("Codex and Gemini wait for the old process to close before starting the next queued turn", () => {
  for (const provider of ["openai", "gemini"]) {
    const { hub, lead, a, b, proc, report, inboxCount, messages } = fixture({ provider });
    if (provider === "gemini") {
      hub.spawnCli = () => proc;
      hub.startGemini(lead, "lead turn");
    }
    report(a, "first");
    report(b, "second");
    for (let index = 0; index < 3; index++) hub.checkTeams();
    assert.deepEqual(hub.transcript(lead.id), [], provider);
    if (provider === "gemini") {
      proc.stdout.write(JSON.stringify({ event: "result", result: { status: "OK", response: "finished" } }) + "\n");
    } else {
      hub.touch(lead, { status: "idle" });
      hub.endTurn(lead);
    }
    assert.equal(lead.status, "idle", provider);
    assert.equal(inboxCount(), 2, provider);
    assert.deepEqual(messages(), [], provider);
    proc.emit("close", 0);
    assert.deepEqual(messages(), ["first"], provider);
    assert.equal(inboxCount(), 1, provider);
  }
});

test("full requests are explicit, sender reports stay pending in cross-sender order, and retries are idempotent", () => {
  const { hub, store, lead, a, b, done, report, inboxCount, messages } = fixture({ limit: 1 });
  assert.deepEqual(hub.messageLead(a.id, "same text", "one"), { ok: true });
  assert.deepEqual(hub.messageLead(a.id, "same text", "one"), { ok: true, duplicate: true });
  assert.throws(() => hub.messageLead(a.id, "same text", "two"), e => e.status === 429 && e.code === "lead_inbox_full" && e.waiting === 1 && e.limit === 1);
  report(b, "private-pending report B");
  report(a, "private-pending report A");
  assert.equal(inboxCount(), 1);
  assert.equal(hub.rt(b.id).pendingReports.length, 1);
  assert.equal(hub.autoRemoveBlocked(b), "report");
  assert.doesNotMatch(JSON.stringify({ state: store.data, session: hub.publicSession(lead) }), /private-pending|same text/);
  for (let index = 0; index < 3; index++) done();
  assert.deepEqual(messages(), ["same text", "private-pending report B", "private-pending report A"]);
  assert.equal(hub.rt(b.id).pendingReports.length, 0);
  assert.equal(inboxCount(), 0);
  assert.deepEqual(hub.messageLead(a.id, "same text", "one"), { ok: true, duplicate: true });
  assert.deepEqual(hub.messageLead(a.id, "same text", "two"), { ok: true });
  done();
  assert.deepEqual(messages(), ["same text", "private-pending report B", "private-pending report A", "same text"]);
});

test("a team hold, Claude quota, and provider guard prevent draining until the hold clears", () => {
  const { hub, lead, a, done, inboxCount, messages } = fixture();
  let teamHeld = true, providerHeld = true, paused = true;
  hub.holdTeam = () => teamHeld;
  hub.pausedFor = () => paused;
  hub.providerHold = () => providerHeld ? "Provider quota" : null;
  hub.messageLead(a.id, "held");
  done();
  assert.equal(inboxCount(), 1);
  teamHeld = false;
  hub.checkTeams();
  paused = false;
  hub.checkTeams();
  assert.deepEqual(messages(), []);
  providerHeld = false;
  hub.checkTeams();
  assert.equal(lead.status, "running");
  assert.deepEqual(messages(), ["held"]);
});

test("a new report wakes an idle lead only once after restarting without inbox state", () => {
  const { hub, store, lead, a, report } = fixture();
  report(a, "old in-memory report");
  hub.touch(lead, { status: "idle" });
  const saved = JSON.stringify(diskView(store.data));
  assert.doesNotMatch(saved, /old in-memory report/);
  const restarted = new Hub({
    root: "/tmp", store: { data: JSON.parse(saved), save() {} }, models: hub.models, roles: [], port: 0, limits: hub.shared,
  });
  restarted.boardNote = () => "";
  const restored = restarted.get(lead.id);
  restarted.checkTeams();
  assert.equal(restarted.publicSession(restored).leadInboxCount, 0);
  assert.equal(restarted.live.has(lead.id), false);

  const starts = [];
  let accept;
  restarted.start = (s, text, _images, onStart) => {
    starts.push(text);
    accept = onStart;
    restarted.touch(s, { status: "running" });
  };
  restarted.rt(a.id).lastText = "new report";
  restarted.reportToParent(restarted.get(a.id));
  restarted.checkTeams();
  restarted.checkTeams();
  assert.deepEqual(starts, ["[a(팀원) 보고]\nnew report"]);
  assert.equal(restarted.publicSession(restored).leadInboxCount, 1);
  accept(true);
  assert.equal(restarted.publicSession(restored).leadInboxCount, 0);
  restarted.cancelAutoRemove(a.id);
});

test("a cancel or an errored turn holds the inbox until a new user instruction resumes FIFO", () => {
  for (const outcome of ["cancel", "error"]) {
    const { hub, lead, a, done, inboxCount, messages } = fixture({ limit: outcome === "error" ? 1 : 4 });
    hub.messageLead(a.id, outcome);
    if (outcome === "cancel") hub.interrupt(lead.id);
    else hub.onClaude(lead, { type: "result", is_error: true, result: "failed" });
    hub.checkTeams();
    assert.equal(inboxCount(), 1);
    assert.deepEqual(messages(), []);
    if (outcome === "error") {
      assert.throws(() => hub.messageSession(lead.id, "continue"), { status: 429, code: "lead_inbox_full" });
    }
    hub.messageSession(lead.id, "continue");
    if (outcome === "cancel") done();
    assert.deepEqual(messages(), [outcome]);
    done();
    assert.deepEqual(messages(), [outcome, undefined]);
  }
});

test("a queued report follows a reparent, including after its old lead is killed", () => {
  for (const killed of [false, true]) {
    const { hub, lead, a, add, attach, report, inboxCount, messages } = fixture();
    const newLead = add("other");
    attach(newLead);
    report(a, "move report");
    if (killed) hub.kill(lead.id);
    hub.setParent(a.id, newLead.id);
    assert.equal(inboxCount(), 0);
    assert.equal(inboxCount(newLead), 1);
    assert.deepEqual(messages(), []);
    hub.onClaude(newLead, { type: "result" });
    assert.deepEqual(messages(), ["move report"]);
  }
});

test("a card handoff drains the moved teammates' pending reports in order with the transferred board", async () => {
  const { hub, lead, a, b, add, report, done, inboxCount, work } = fixture();
  const next = add("next");
  next.status = "idle";
  hub.boardNote = Hub.prototype.boardNote;
  const card = await hub.setTask(lead.id, { title: "candidate", stage: "review" });
  report(b, "first");
  report(a, "second");

  hub.handoffTask(card.id, { fromLead: lead.id, toLead: next.id, sessionIds: [a.id, b.id] });
  assert.equal(inboxCount(lead), 0);
  assert.equal(inboxCount(next), 1);
  assert.equal(work.length, 1);
  assert.match(work[0], /\nfirst\n/);
  assert.ok(work[0].includes(card.id));
  done(next);
  assert.equal(work.length, 2);
  assert.match(work[1], /\nsecond\n/);
  assert.ok(work[1].includes(card.id));
  done(next);
  assert.equal(inboxCount(next), 0);
  for (const session of [a, b]) assert.equal(hub.rt(session.id).pendingReports.length, 0);
  assert.equal(hub.transcript(next.id).filter(e => e.kind === "user").length, 2);
});

test("accepted explicit messages follow a reparent ahead of newer items even when the new inbox is full", () => {
  const { hub, lead, a, b, add, attach, done, report, inboxCount, work } = fixture({ limit: 2 });
  const next = add("next");
  attach(next);
  assert.deepEqual(hub.messageLead(a.id, "same", "first"), { ok: true });
  report(a, "report between");
  hub.setParent(a.id, null);
  assert.equal(hub.rt(a.id).pendingReports.length, 2);
  assert.equal(inboxCount(lead), 0);
  hub.messageSession(next.id, "new lead instruction");
  hub.setParent(b.id, next.id);
  report(b, "new lead report");
  hub.setParent(a.id, next.id);
  assert.deepEqual(hub.messageLead(a.id, "same", "first"), { ok: true, duplicate: true });
  assert.throws(() => hub.messageLead(a.id, "same", "second"), { status: 429, code: "lead_inbox_full" });
  done(lead);
  assert.deepEqual(work, []);
  for (const text of [/\nsame$/, /\nreport between$/, /^new lead instruction$/, /\nnew lead report$/]) {
    done(next);
    assert.match(work.at(-1), text);
  }
  assert.equal(hub.rt(a.id).pendingReports.length, 0);
  hub.messageLead(a.id, "same", "second");
  done(next);
  assert.match(work.at(-1), /\nsame$/);
  assert.equal(hub.transcript(next.id).filter(e => e.kind === "user").length, 5);
});

test("if sending fails before dispatch, the head stays queued and the retry only appends once", () => {
  const { hub, lead, a, proc, done, inboxCount, messages } = fixture();
  hub.messageLead(a.id, "retry");
  const write = proc.stdin.write;
  proc.stdin.write = () => { throw new Error("pipe unavailable"); };
  done();
  hub.checkTeams();
  assert.equal(inboxCount(), 1);
  assert.deepEqual(hub.transcript(lead.id), []);
  proc.stdin.write = write;
  hub.checkTeams();
  assert.equal(inboxCount(), 0);
  assert.deepEqual(messages(), ["retry"]);
  assert.equal(hub.transcript(lead.id).filter(e => e.kind === "user").length, 1);
});

test("a failed CLI launch keeps reports pending and only records delivery after a successful retry", () => {
  for (const failure of ["throw", "spawn error", "closed before ready", "empty exit"]) {
    const { hub, lead, a, report, inboxCount } = fixture({ provider: "gemini" });
    delete hub.start;
    hub.rt(lead.id).proc = null;
    hub.touch(lead, { status: "idle" });
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    hub.spawnCli = () => {
      if (failure === "throw") throw new Error("launch failed");
      return proc;
    };
    report(a, "keep this report");
    if (failure === "spawn error") proc.emit("error", Object.assign(new Error("missing CLI"), { code: "ENOENT" }));
    if (failure === "closed before ready") proc.emit("close", 1);
    if (failure === "empty exit") proc.emit("close", 0);
    assert.equal(lead.status, "error", failure);
    assert.equal(inboxCount(), 1, failure);
    assert.equal(hub.rt(a.id).pendingReports.length, 1, failure);
    assert.equal(hub.autoRemoveBlocked(a), "report", failure);
    assert.equal(hub.rt(a.id).autoRemove, undefined, failure);
    assert.deepEqual(hub.transcript(lead.id).filter(e => e.kind === "user"), [], failure);

    const retry = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    hub.spawnCli = () => retry;
    hub.messageSession(lead.id, "resume");
    assert.equal(inboxCount(), 2, failure);
    retry.stdout.write(JSON.stringify({ event: "result", result: { status: "OK" } }) + "\n");
    assert.equal(inboxCount(), 1, failure);
    assert.equal(hub.rt(a.id).pendingReports.length, 0, failure);
    assert.ok(hub.rt(a.id).autoRemove, failure);
    assert.match(hub.transcript(lead.id).filter(e => e.kind === "user")[0].text, /keep this report$/);
    hub.cancelAutoRemove(a.id);
  }
});

for (const provider of ["claude", "gemini"]) {
  test(`${provider} init and startup errors keep a report pending until the first turn is accepted`, () => {
    const { hub, lead, a, report, inboxCount } = fixture({ provider });
    delete hub.start;
    hub.rt(lead.id).proc = null;
    hub.touch(lead, { status: "idle" });
    const claude = provider === "claude";
    const start = () => {
      const proc = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {},
      });
      hub.spawnCli = () => proc;
      return {
        proc,
        emit: message => proc.stdout.write(JSON.stringify(message) + "\n"),
      };
    };
    const init = claude ? { type: "system", subtype: "init", session_id: "test" }
      : { event: "init", conversation_id: "test" };
    const assertPending = count => {
      assert.equal(inboxCount(), count);
      assert.equal(hub.rt(a.id).pendingReports.length, 1);
      assert.equal(hub.autoRemoveBlocked(a), "report");
      assert.equal(hub.rt(a.id).autoRemove, undefined);
      assert.deepEqual(hub.transcript(lead.id).filter(e => e.kind === "user"), []);
    };

    const first = start();
    report(a, "keep this report");
    first.emit(init);
    assertPending(1);
    first.emit(claude
      ? { type: "assistant", error: "authentication_failed", message: { content: [{ type: "text", text: "Authentication failed" }] } }
      : { event: "step_update", step_update: { step_type: "user_input", state: "DONE" } });
    assertPending(1);
    first.emit(claude ? { type: "result", is_error: true, result: "Authentication failed" }
      : { event: "result", result: { status: "ERROR", error: "Authentication failed" } });
    if (!claude) first.proc.emit("close", 1);
    assertPending(1);

    const retry = start();
    hub.messageSession(lead.id, "resume");
    retry.emit(init);
    assertPending(2);
    retry.emit(claude ? { type: "assistant", message: { content: [{ type: "text", text: "Ready" }] } }
      : { event: "step_update", step_update: { step_type: "agent_response", text_delta: "Ready" } });
    assert.equal(inboxCount(), 1);
    assert.equal(hub.rt(a.id).pendingReports.length, 0);
    assert.ok(hub.rt(a.id).autoRemove);
    assert.match(hub.transcript(lead.id).find(e => e.kind === "user").text, /keep this report$/);
    hub.cancelAutoRemove(a.id);
  });
}

test("Codex keeps a rotated handoff and pending report until turn/start is accepted on retry", () => {
  const { hub, store, lead, a, add, report, inboxCount } = fixture({ provider: "openai" });
  delete hub.start;
  hub.rt(lead.id).proc = null;
  hub.rt(lead.id).lastText = "old handoff summary";
  store.data.settings.team.rotateLead = 2;
  hub.touch(lead, { status: "idle", providerSessionId: "old-thread", turnsSinceRotate: 2 });
  const start = () => {
    const proc = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {},
    });
    const requests = [];
    onJsonLines(proc.stdin, message => requests.push(message));
    hub.spawnCli = () => proc;
    const ready = () => {
      for (const message of [
        { id: 1, result: {} },
        { id: 2, result: { thread: { id: "thread" }, approvalPolicy: "never", sandbox: { type: "workspaceWrite" } } },
      ]) proc.stdout.write(JSON.stringify(message) + "\n");
    };
    const prompt = () => requests.find(message => message.method === "turn/start").params.input[0].text;
    return { proc, ready, requests, prompt };
  };

  const first = start();
  report(a, "codex pending");
  first.ready();
  assert.equal(first.requests[2].method, "thread/start");
  assert.match(first.prompt(), /old handoff summary[\s\S]*codex pending$/);
  assert.equal(inboxCount(), 1);
  first.proc.stdout.write(JSON.stringify({ id: 3, error: { message: "turn rejected" } }) + "\n");
  first.proc.emit("close", 0);
  assert.equal(lead.status, "error");
  assert.equal(hub.autoRemoveBlocked(a), "report");
  assert.deepEqual(hub.transcript(lead.id).filter(e => e.kind === "user"), []);

  const retry = start();
  const newer = add("newer", lead.id);
  hub.messageLead(newer.id, "later");
  hub.messageSession(lead.id, "resume");
  retry.ready();
  assert.equal(retry.requests[2].method, "thread/resume");
  assert.match(retry.prompt(), /^\[역할\][\s\S]*old handoff summary[\s\S]*codex pending$/);
  assert.equal(inboxCount(), 3);
  retry.proc.stdout.write(JSON.stringify({ id: 3, result: { turn: { id: "turn" } } }) + "\n");
  assert.equal(inboxCount(), 2);
  assert.equal(hub.rt(newer.id).pendingReports.length, 1);
  const user = hub.transcript(lead.id).filter(e => e.kind === "user");
  assert.equal(user.length, 1);
  assert.match(user[0].text, /codex pending$/);

  const next = start();
  retry.proc.stdout.write(JSON.stringify({
    method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
  }) + "\n");
  retry.proc.emit("close", 0);
  next.ready();
  assert.match(next.prompt(), /later$/);
  assert.doesNotMatch(next.prompt(), /old handoff summary/);
  assert.equal(lead.rotations, 1);
  hub.cancelAutoRemove(a.id);
});

test("a Claude pipe write callback failure leaves the report queued", () => {
  const { hub, lead, a, proc, done, report, inboxCount } = fixture();
  let complete;
  proc.stdin.write = (_line, callback) => { complete = callback; };
  report(a, "wait for pipe write");
  done();
  assert.equal(inboxCount(), 1);
  assert.equal(hub.autoRemoveBlocked(a), "report");
  complete(new Error("broken pipe"));
  assert.equal(lead.status, "error");
  assert.equal(inboxCount(), 1);
  assert.deepEqual(hub.transcript(lead.id).filter(e => e.kind === "user"), []);
  assert.equal(hub.rt(a.id).autoRemove, undefined);
});

test("maxLeadInbox is validated as a team setting", () => {
  const { store } = fixture();
  const options = { roles: [], models: [] };
  assert.equal(patchTeam(store, { maxLeadInbox: 1 }, options).maxLeadInbox, 1);
  assert.equal(patchTeam(store, { maxLeadInbox: 100 }, options).maxLeadInbox, 100);
  for (const value of [0, 101, "invalid"]) {
    assert.throws(() => patchTeam(store, { maxLeadInbox: value }, options), e => e.status === 400);
  }
});

test("lead replacement moves the queue with its teammates and board tasks, and runs the handoff first", () => {
  const { hub, lead, a, b, done, report, inboxCount, work, store } = fixture({ limit: 2 });
  store.data.settings.team.handoffMTokens = 2;
  lead.usage.input = 2_000_000;
  store.data.tasks.T = { lead: lead.id };
  hub.messageLead(a.id, "first", "one");
  hub.messageSession(lead.id, "user instruction", { messageId: "user-1" });
  report(b, "second");
  done();
  const successor = hub.sessions.find(s => s.rotatedFrom?.id === lead.id);
  assert.ok(successor);
  assert.equal(a.parent, successor.id);
  assert.equal(b.parent, successor.id);
  assert.equal(store.data.tasks.T.lead, successor.id);
  assert.equal(inboxCount(successor), 2);
  assert.equal(work.length, 1);
  assert.match(work[0], /이전 세션/);
  assert.doesNotMatch(work[0], /first|second|user instruction/);
  assert.deepEqual(hub.messageLead(a.id, "first", "one"), { ok: true, duplicate: true });
  assert.deepEqual(hub.messageSession(successor.id, "user instruction", { messageId: "user-1" }), { ok: true, duplicate: true });
  done(successor);
  done(successor);
  done(successor);
  assert.match(work[1], /\nfirst$/);
  assert.equal(work[2], "user instruction");
  assert.match(work[3], /\nsecond$/);
  assert.equal(inboxCount(successor), 0);
});

test("the HTTP route returns structured backpressure with no payload, and retries the same ID safely", async () => {
  const { hub, a, done } = fixture({ limit: 1 });
  const post = messagePost(hub, `/api/sessions/${a.id}/to-lead`);
  assert.deepEqual(await post({ text: "queued", messageId: "one" }), { status: 200, body: { ok: true } });
  const full = await post({ text: "keep at sender", messageId: "two" });
  assert.equal(full.status, 429);
  assert.equal(full.body.code, "lead_inbox_full");
  assert.equal(full.body.waiting, 1);
  assert.equal(full.body.limit, 1);
  assert.doesNotMatch(JSON.stringify(full.body), /keep at sender/);
  done();
  assert.deepEqual(await post({ text: "keep at sender", messageId: "two" }), { status: 200, body: { ok: true } });
  assert.deepEqual(await post({ text: "keep at sender", messageId: "two" }), { status: 200, body: { ok: true, duplicate: true } });
});

test("busy lead HTTP user requests share report FIFO and backpressure while guards hold delivery", async () => {
  const { hub, lead, a, done, report, inboxCount, work } = fixture({ limit: 3 });
  const post = messagePost(hub, `/api/sessions/${lead.id}/message`);
  const postUser = messageId => post({ text: "same instruction", messageId });
  const accepted = { status: 200, body: { ok: true } };
  const duplicate = { status: 200, body: { ok: true, duplicate: true } };
  assert.deepEqual(await postUser("user-1"), accepted);
  report(a, "teammate report");
  assert.deepEqual(await postUser("user-2"), accepted);
  assert.deepEqual(await postUser("user-1"), duplicate);
  const full = await postUser("user-3");
  assert.equal(full.status, 429);
  assert.deepEqual([full.body.code, full.body.waiting, full.body.limit], ["lead_inbox_full", 3, 3]);
  assert.deepEqual(hub.transcript(lead.id), []);
  hub.pausedFor = () => true;
  done();
  assert.equal(inboxCount(), 3);
  assert.deepEqual(work, []);
  hub.pausedFor = () => false;
  hub.checkTeams();
  assert.deepEqual(work, ["same instruction"]);
  assert.deepEqual(await postUser("user-3"), accepted);
  assert.deepEqual(await postUser("user-1"), duplicate);
  done();
  assert.match(work.at(-1), /\nteammate report$/);
  done();
  done();
  assert.equal(inboxCount(), 0);
  assert.deepEqual(work.filter(text => text === "same instruction"), Array(3).fill("same instruction"));
  assert.equal(hub.transcript(lead.id).filter(e => e.kind === "user").length, 4);

  const worker = fixture({ provider: "openai" });
  worker.attach(worker.a);
  worker.hub.touch(worker.a, { status: "running" });
  const busy = await messagePost(worker.hub, `/api/sessions/${worker.a.id}/message`)({ text: "worker instruction" });
  assert.equal(busy.status, 400);
  assert.deepEqual(worker.hub.transcript(worker.a.id), []);
});

test("repeated quota interrupts of one teammate turn enqueue one handoff", () => {
  const { hub, a, done, attach, inboxCount, work } = fixture();
  attach(a);
  hub.touch(a, { status: "running" });
  hub.interrupt(a.id, { pause: true });
  hub.interrupt(a.id, { pause: true });
  assert.equal(inboxCount(), 1);
  done();
  assert.equal(work.length, 1);
  assert.match(work[0], /팀원\) 중단/);
});
