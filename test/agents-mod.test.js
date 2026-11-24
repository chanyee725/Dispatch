// Pure formatting of the /atelier-agents mod pane (plugin/hooks/agents-format.mjs, #755). No CLI, no server.
import assert from "node:assert/strict";
import test from "node:test";
import { asSummary, duration, etaLabel, githubRepo, paneModel, parsePort, prUrl, stageLabel, statusLine } from "../plugin/hooks/agents-format.mjs";

const NOW = 1_800_000_000_000;
const summary = {
  v: 1, at: NOW, project: { name: "demo" },
  usage: { fiveHour: { used: 42, reset: NOW + 70 * 60000 }, weekly: { used: 13.4, reset: null } },
  leads: [{
    name: "관리자", role: "lead", model: "opus", status: "running", stuck: false, issue: 755,
    issues: [{ number: 755, prs: [{ number: 857, state: "MERGED" }] }, { number: 760, prs: [] }],
    tasks: [
      { title: "pane", stage: "impl", owner: "구현자", etaAt: NOW + 20 * 60000, late: false, stuck: null, updatedAt: NOW },
      { title: "test", stage: "test", owner: null, etaAt: NOW - 5 * 60000, late: true, stuck: "응답 없음", updatedAt: NOW },
    ],
    team: [
      { name: "구현자", role: "impl", model: "sonnet", status: "asking", stuck: false, issue: 755 },
      { name: "리뷰어", role: "review", model: "", status: "idle", stuck: true, issue: null },
    ],
  }],
};
const online = { kind: "online", port: 4321, at: NOW, summary };

test("parsePort takes plain digits in range only", () => {
  assert.equal(parsePort("4321\n"), 4321);
  for (const bad of ["", "0", "65536", "12a", "-1", " 1 2", null]) assert.equal(parsePort(bad), null);
});

test("githubRepo reads the origin remote on github.com", () => {
  const cfg = '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/x/y.git\n[remote "origin"]\n\turl = git@github.com:owner/repo.git\n';
  assert.equal(githubRepo(cfg), "owner/repo");
  assert.equal(githubRepo('[remote "origin"]\n\turl = https://github.com/o/r\n'), "o/r");
  assert.equal(githubRepo('[remote "origin"]\n\turl = https://gitlab.com/o/r.git\n'), null);
  assert.equal(prUrl("o/r", 12), "https://github.com/o/r/pull/12");
  assert.equal(prUrl(null, 12), null);
});

test("durations, stages and ETA read short", () => {
  assert.equal(duration(3 * 60000), "3분");
  assert.equal(duration(125 * 60000), "2시간 5분");
  assert.equal(duration(28 * 3600000), "1일 4시간");
  assert.equal(stageLabel("review"), "review 3/5");
  assert.equal(etaLabel({ etaAt: NOW + 20 * 60000 }, NOW), "ETA 20분");
  assert.equal(etaLabel({ etaAt: NOW - 5 * 60000 }, NOW), "ETA 5분 지남");
  assert.equal(etaLabel({ etaAt: null }, NOW), "");
});

test("status line: summary, offline, nothing without a server", () => {
  assert.equal(statusLine(online), "Atelier 관리자 1 · 실행 1 · 질문 1 · 막힘 2 · 5시간 42% · 주간 13%");
  assert.equal(statusLine({ kind: "offline", port: 4321, lastAt: null }), "Atelier offline");
  assert.equal(statusLine({ kind: "none" }), undefined);
});

test("pane model: usage, lead, board, team and PR links", () => {
  const m = paneModel(online, "o/r", NOW);
  assert.equal(m.kind, "online");
  assert.equal(m.title, "demo · 127.0.0.1:4321");
  assert.deepEqual(m.usage, ["5시간 42% · 1시간 10분 뒤 초기화", "주간 13%"]);
  const [l] = m.leads;
  assert.equal(l.head, "관리자 · 실행 중 · opus");
  assert.deepEqual(l.tasks.map(t => t.text), ["impl 2/5 · pane · ETA 20분", "test 4/5 · test · ETA 5분 지남"]);
  assert.equal(l.tasks[1].stuck, "막힘: 응답 없음");
  assert.deepEqual(l.team.map(t => t.text), ["구현자 · impl · sonnet · 질문 중", "리뷰어 · review · 모델 – · 대기 · 막힘"]);
  assert.deepEqual(l.issues[0], { text: "#755", prs: [{ label: "PR #857 (merged)", href: "https://github.com/o/r/pull/857" }] });
  assert.deepEqual(l.issues[1].prs, []);
  assert.equal(paneModel(online, null, NOW).leads[0].issues[0].prs[0].href, null);
});

test("pane model: offline and no server", () => {
  assert.equal(paneModel({ kind: "offline", port: 1, lastAt: NOW - 3 * 60000 }, null, NOW).text, "offline: Atelier 서버가 응답하지 않아요 · 마지막 응답 3분 전");
  assert.equal(paneModel({ kind: "none" }, null, NOW).kind, "none");
});

test("asSummary refuses other bodies", () => {
  assert.equal(asSummary(summary), summary);
  for (const bad of [null, "x", {}, { v: 2, leads: [] }, { v: 1 }]) assert.equal(asSummary(bad), null);
});
