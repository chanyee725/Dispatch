// Pure formatting for the /agents mod pane (#755): no `$`, no I/O, so node:test checks it (test/agents-mod.test.js)
// and the hooks module (agents.tsx) imports it. Input is the GET /api/agents/summary body (server/dispatch/agents-summary.js):
// metadata only (names, roles, models, states, stages, times, issue/PR numbers).

const STAGES = ["plan", "impl", "review", "test", "merge"];
const STATUS = { running: "실행 중", idle: "대기", asking: "질문 중", done: "끝남", failed: "실패" };

/** The port in a server.port file's text when it is plain digits in 1..65535, else null (rule of main-delegates readPort). */
export function parsePort(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!/^[0-9]+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 65535 ? n : null;
}

/** "owner/repo" of the `origin` remote in a .git/config text when it is on github.com, else null. */
export function githubRepo(gitConfig) {
  if (typeof gitConfig !== "string") return null;
  const block = gitConfig.split(/^\s*\[/m).find(b => /^remote\s+"origin"\s*\]/.test(b));
  const url = block?.match(/^\s*url\s*=\s*(\S+)/m)?.[1];
  const m = url?.match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** https link to PR `n` of `repo`, or null without a repo or a sane number. */
export function prUrl(repo, n) {
  return repo && Number.isInteger(n) && n > 0 ? `https://github.com/${repo}/pull/${n}` : null;
}

/** "42%" for a 0..100 number, "–" otherwise. */
export function percent(v) {
  return typeof v === "number" && Number.isFinite(v) ? `${Math.round(v)}%` : "–";
}

/** Short Korean duration for `ms` (≥ 0): "3분", "2시간 5분", "3일 4시간". */
export function duration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h}시간 ${min % 60}분` : `${h}시간`;
  return h % 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간` : `${Math.floor(h / 24)}일`;
}

/** One usage window: "5시간 42% · 1시간 10분 뒤 초기화". */
export function usageLine(label, w, now) {
  const reset = typeof w?.reset === "number" && w.reset > now ? ` · ${duration(w.reset - now)} 뒤 초기화` : "";
  return `${label} ${percent(w?.used)}${reset}`;
}

export function statusLabel(status) {
  return STATUS[status] ?? "대기";
}

/** Stage chip text: "impl 2/5" style position on plan → impl → review → test → merge. */
export function stageLabel(stage) {
  const i = STAGES.indexOf(stage);
  return i < 0 ? String(stage || "?") : `${stage} ${i + 1}/${STAGES.length}`;
}

/** ETA text for a board task: "ETA 20분", "ETA 5분 지남", or "". */
export function etaLabel(t, now) {
  if (typeof t?.etaAt !== "number") return "";
  return t.etaAt >= now ? `ETA ${duration(t.etaAt - now)}` : `ETA ${duration(now - t.etaAt)} 지남`;
}

/**
 * The status-line summary, one line: "Atelier 관리자 2 · 실행 3 · 질문 1 · 막힘 1 · 5시간 42% · 주간 13%",
 * "Atelier offline" when the server is down, undefined (no line) when this project has no server.
 */
export function statusLine(view) {
  if (!view || view.kind === "none") return undefined;
  if (view.kind === "offline") return "Atelier offline";
  const s = view.summary;
  const all = (s.leads || []).flatMap(l => [l, ...(l.team || [])]);
  const count = st => all.filter(m => m.status === st).length;
  const stuck = all.filter(m => m.stuck).length + (s.leads || []).flatMap(l => l.tasks || []).filter(t => t.stuck).length;
  const parts = [`Atelier 관리자 ${(s.leads || []).length}`, `실행 ${count("running")}`];
  if (count("asking")) parts.push(`질문 ${count("asking")}`);
  if (stuck) parts.push(`막힘 ${stuck}`);
  parts.push(`5시간 ${percent(s.usage?.fiveHour?.used)}`, `주간 ${percent(s.usage?.weekly?.used)}`);
  return parts.join(" · ");
}

/**
 * The pane's model, plain data the render hook draws: header, usage rows, and one block per lead with its
 * task rows, team rows and issue/PR links. `repo` ("owner/repo" or null) turns PR numbers into links.
 */
export function paneModel(view, repo, now) {
  if (!view || view.kind === "none") return { kind: "none", text: "이 프로젝트에는 Atelier 서버가 없어요." };
  if (view.kind === "offline") {
    const seen = typeof view.lastAt === "number" ? ` · 마지막 응답 ${duration(now - view.lastAt)} 전` : "";
    return { kind: "offline", text: `offline: Atelier 서버가 응답하지 않아요${seen}` };
  }
  const s = view.summary;
  return {
    kind: "online",
    title: s.project?.name ? `${s.project.name} · 127.0.0.1:${view.port}` : `127.0.0.1:${view.port}`,
    usage: [usageLine("5시간", s.usage?.fiveHour, now), usageLine("주간", s.usage?.weekly, now)],
    leads: (s.leads || []).map(l => ({
      head: `${l.name || "관리자"} · ${statusLabel(l.status)}${l.stuck ? " · 막힘" : ""} · ${l.model || "모델 –"}`,
      status: l.status,
      stuck: !!l.stuck,
      tasks: (l.tasks || []).map(t => ({
        text: [stageLabel(t.stage), t.title || "(제목 없음)", etaLabel(t, now)].filter(Boolean).join(" · "),
        late: !!t.late,
        stuck: t.stuck ? `막힘: ${t.stuck}` : null,
      })),
      team: (l.team || []).map(m => ({
        text: `${m.name || "?"} · ${m.role || "역할 –"} · ${m.model || "모델 –"} · ${statusLabel(m.status)}${m.stuck ? " · 막힘" : ""}`,
        status: m.status,
        stuck: !!m.stuck,
      })),
      issues: (l.issues || []).map(i => ({
        text: `#${i.number}`,
        prs: (i.prs || []).map(p => ({ label: `PR #${p.number}${p.state ? ` (${String(p.state).toLowerCase()})` : ""}`, href: prUrl(repo, p.number) })),
      })),
    })),
  };
}

/** Narrows an unknown fetch body to a summary we can draw, else null (a different server, an old version). */
export function asSummary(body) {
  return body && typeof body === "object" && body.v === 1 && Array.isArray(body.leads) ? body : null;
}
