#!/usr/bin/env bash
# Print the live board of the Atelier server of a project: limits and guard, sessions, task board.
#   status.sh [project-root]     port: <project>/.atelier/server.port (or an older .dispatch/), else $DRAW_PORT / $DISPATCH_PORT, else 4330
# Reads GET /api/state and GET /api/tasks only (loopback). Prints metadata, no transcript text.
set -euo pipefail

port=""
if [ -n "${1:-}" ]; then
  for f in "$1/.atelier/server.port" "$1/.dispatch/server.port"; do
    if [ -f "$f" ]; then port="$(tr -d '[:space:]' < "$f")"; break; fi
  done
fi
port="${port:-${DRAW_PORT:-${DISPATCH_PORT:-4330}}}"
[[ "$port" =~ ^[0-9]+$ ]] || { echo "Bad port: $port" >&2; exit 1; }
url="http://127.0.0.1:$port"
state="$(curl -sf "$url/api/state")" || { echo "No Atelier server on $url" >&2; exit 1; }
tasks="$(curl -sf "$url/api/tasks" || echo '{"tasks":[]}')"

node -e '
  const s = JSON.parse(process.argv[1]), t = JSON.parse(process.argv[2]).tasks ?? [], now = Date.now();
  const pct = v => (typeof v === "number" ? Math.round(v * 100) + "%" : "-");
  const min = ms => Math.max(0, Math.round((now - ms) / 60000)) + "분";
  const l = s.limits ?? {}, g = s.settings?.guard ?? {};
  console.log(`한도  5시간 ${pct(l.five)} · 주간 ${pct(l.seven)}  (가드 ${g.enabled === false ? "꺼짐" : `${pct(g.five)} / ${pct(g.seven)}`})`);
  const open = (s.sessions ?? []).filter(x => x.status !== "done");
  console.log(`\n세션 ${open.length}개`);
  for (const x of open) {
    const flag = x.attention ? `  ⚠ ${x.attention.reason}` : x.longRun ? `  ⚠ 오래 씀 ${x.longRun.mtok}M` : "";
    const ctx = x.ctx && x.ctxWindow ? ` ctx ${Math.round((x.ctx / x.ctxWindow) * 100)}%` : "";
    console.log(`- ${x.name} (${x.role}, ${x.model}) ${x.state ?? x.status} ${x.stateSince ? min(x.stateSince) : ""}${ctx}  ${x.branch ?? ""}${flag}`);
  }
  const live = t.filter(x => x.stage !== "done");
  console.log(`\n작업 ${live.length}개`);
  for (const x of live) {
    const eta = x.etaAt ? (x.etaAt > now ? ` 남은 ${Math.round((x.etaAt - now) / 60000)}분` : " 예상 시간 지남") : "";
    console.log(`- [${x.stage}] ${x.title} · ${x.owner ?? "-"}${eta}${x.stuck ? `  ⚠ ${x.stuck.label}` : ""}`);
  }
' "$state" "$tasks"
