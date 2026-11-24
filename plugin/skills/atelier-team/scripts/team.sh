#!/usr/bin/env bash
# Create an Atelier team for a task.
#   team.sh <project-dir> <small|risky|standard|ui|full> "<task>"
# Starts or reuses the server (plugin scripts/start.sh), connects Claude when the CLI is logged in,
# and creates the preset's sessions with the shared team rules prepended to the task.
# Models: each role's default (the project's 설정 → roleModels), else DISPATCH_TEAM_ROLE_MODELS
# (JSON { role: modelId }, e.g. '{"impl":"gemini-3.8-flash-high"}' for a UI issue), else DISPATCH_TEAM_MODEL for all.
# Mode: DISPATCH_TEAM_MODE (plan | impl | review | docs | quickfix | research) gives every session that mode's
# harness profile (#748, #856) where no model is named; unset, each session keeps its role default.
# One team per issue (#1031): the issue is DISPATCH_TEAM_ISSUE, else the first #<n> in the task. When a live lead
# already holds it (its sessions' issue, its session task line or an open board task names it), no team starts and
# that lead's name is printed instead. DISPATCH_TEAM_IGNORE_LEAD (name or id) is left out of that check (relay.sh
# passes the lead it replaces). Every session records the issue. A live merge role in the project is reused, not doubled,
# unless it is a child of DISPATCH_TEAM_IGNORE_LEAD (relay.sh removes those).
set -euo pipefail

here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
skill="$(dirname "$here")"
plugin_root="$(dirname "$(dirname "$skill")")"
start_sh="$plugin_root/scripts/start.sh"
setup_sh="$(dirname "$skill")/atelier-setup/scripts/setup.sh"

project="${1:?usage: team.sh <project-dir> <small|risky|standard|ui|full> \"<task>\"}"
preset="${2:?preset: small | risky | standard | ui | full}"
task="${3:?task text}"
project="$(cd "$project" && pwd)"
port="${DISPATCH_PORT:-4330}"
url="http://127.0.0.1:$port"
H=(-H 'content-type: application/json' -H 'x-dispatch: 1')

case "$preset" in
  small)    items='[{"role":"lead"},{"role":"impl"},{"role":"review"},{"role":"test"}]' ;;
  risky)    items='[{"role":"lead"},{"role":"impl"},{"role":"review","n":2}]' ;;
  standard) items='[{"role":"lead"},{"role":"impl","n":2},{"role":"review"},{"role":"test"}]' ;;
  ui)       items='[{"role":"lead"},{"role":"impl"},{"role":"design"},{"role":"review"}]' ;;
  full)     items='[{"role":"lead"},{"role":"impl","n":2},{"role":"review","n":2},{"role":"test"},{"role":"docs"}]' ;;
  *) echo "Unknown preset '$preset' (small | risky | standard | ui | full)" >&2; exit 2 ;;
esac
# Every preset opens PRs and merges through the two roles (#1031): leads and implementers do neither.
items="${items%]},{\"role\":\"pr\"},{\"role\":\"merge\"}]"

issue="${DISPATCH_TEAM_ISSUE:-$(printf '%s' "$task" | grep -oE '#[0-9]+' | head -n1 | tr -d '#' || true)}"
case "$issue" in ""|*[!0-9]*) issue="" ;; esac

# Checked before anything starts: a bad value inside mk's command substitution would not stop the script.
if [ -n "${DISPATCH_TEAM_ROLE_MODELS:-}" ]; then
  node -e 'const v = JSON.parse(process.argv[1]); if (!v || typeof v !== "object" || Array.isArray(v)) throw 0' "$DISPATCH_TEAM_ROLE_MODELS" 2>/dev/null \
    || { echo 'DISPATCH_TEAM_ROLE_MODELS is not JSON like {"impl":"gemini-3.8-flash-high"}' >&2; exit 2; }
fi

case "${DISPATCH_TEAM_MODE:-}" in
  ""|plan|impl|review|docs|quickfix|research) ;;
  *) echo "DISPATCH_TEAM_MODE is one of plan | impl | review | docs | quickfix | research" >&2; exit 2 ;;
esac

# Server: reuse when it already serves this project; start.sh prints why it can't otherwise.
DISPATCH_PORT="$port" "$start_sh" "$project"

state="$(curl -sf "$url/api/state")"
connected="$(node -e 'const s=JSON.parse(process.argv[1]);console.log(String(!!s.providers?.claude?.connected))' "$state")"
logged_in="$(node -e 'const s=JSON.parse(process.argv[1]);console.log(String(!!s.providers?.claude?.cliLoggedIn))' "$state")"
if [ "$connected" != "true" ]; then
  if [ "$logged_in" != "true" ]; then
    echo "Claude CLI is not logged in. Ask the user to run: ! $setup_sh claude" >&2
    exit 1
  fi
  curl -sf -X POST "$url/api/providers/claude/login" "${H[@]}" -d '{}' >/dev/null
fi

# Duplicate guard: after a server restart a relay may run again; the issue's live lead keeps it.
tasks="$(curl -sf "$url/api/tasks" || echo '{"tasks":[]}')"
holder="$(node -e '
  const [st, tk, issue, ignore] = process.argv.slice(1);
  const n = Number(issue); if (!n) process.exit(0);
  const sessions = JSON.parse(st).sessions || [], tasks = JSON.parse(tk).tasks || [];
  const live = (s) => ["starting", "running", "waiting", "idle"].includes(s.status);
  const re = new RegExp(`#${n}(?![0-9])`);
  const l = sessions.find((s) => s.canSpawn && live(s) && s.id !== ignore && s.name !== ignore && (s.issue === n
    || re.test(s.task || "") || tasks.some((t) => t.lead === s.id && t.stage !== "done" && re.test(t.title || ""))));
  if (l) console.log(l.name);
' "$state" "$tasks" "$issue" "${DISPATCH_TEAM_IGNORE_LEAD:-}")"
if [ -n "$holder" ]; then
  echo "$holder"
  echo "Issue #$issue already has a live lead ($holder); no new team started." >&2
  exit 0
fi
# One merge role per project: a live one stays the project's merger, so this team gets none. The ignored lead's
# children do not count: relay.sh removes them once this team is up, so this team makes its own merge role.
merger="$(node -e '
  const [raw, ignore] = process.argv.slice(1);
  const sessions = JSON.parse(raw).sessions || [];
  const old = ignore ? sessions.find((x) => x.id === ignore || x.name === ignore) : null;
  const s = sessions.find((x) => x.role === "merge" && ["starting", "running", "waiting", "idle"].includes(x.status) && !(old && x.parent === old.id));
  if (s) console.log(s.name);
' "$state" "${DISPATCH_TEAM_IGNORE_LEAD:-}")"
if [ -n "$merger" ]; then
  items="$(node -e 'console.log(JSON.stringify(JSON.parse(process.argv[1]).filter((i) => i.role !== "merge")))' "$items")"
fi

# Lead first, then every teammate created as its child: a child's finished turn is forwarded to the lead,
# so the lead wakes on reports instead of polling, and its list_sessions shows the team.
mk() { # mk <items-json> <role-note> [parent-id] → POST body
  node -e '
    const fs = require("fs");
    const [rulesPath, task, items, note, parent, model, effort, perm, roleModelsRaw, mode, issue] = process.argv.slice(1);
    const rules = fs.readFileSync(rulesPath, "utf8").trim();
    let roleModels = {};
    try { roleModels = roleModelsRaw ? JSON.parse(roleModelsRaw) : {}; } catch { console.error("DISPATCH_TEAM_ROLE_MODELS is not JSON"); process.exit(1); }
    // DISPATCH_TEAM_MODEL / _EFFORT / _PERM override every item (cheap test runs: claude-haiku-5-5, low;
    // a fully hands-off team: auto).
    const list = JSON.parse(items).map((i) => ({
      ...i, ...(issue && { issue: Number(issue) }), ...(roleModels[i.role] && { model: roleModels[i.role] }), ...(model && { model }), ...(effort && { effort }), ...(perm && { perm }),
    }));
    process.stdout.write(JSON.stringify({
      commonPrompt: `${rules}\n\n${note}\n\nTask from the user:\n${task}`,
      worktree: true,
      items: list,
      ...(parent && { parent }),
      ...(mode && { mode }),
    }));
  ' "$skill/reference/rules.md" "$task" "$1" "$2" "${3:-}" "${DISPATCH_TEAM_MODEL:-}" "${DISPATCH_TEAM_EFFORT:-}" "${DISPATCH_TEAM_PERM:-}" "${DISPATCH_TEAM_ROLE_MODELS:-}" "${DISPATCH_TEAM_MODE:-}" "$issue"
}
post() { # post <body> → prints sessions, exits on error; sets $ids
  local resp
  resp="$(curl -s -X POST "$url/api/sessions" "${H[@]}" -d "$1")"
  node -e '
    const r = JSON.parse(process.argv[1]);
    if (r.error) { console.error(r.error); process.exit(1); }
    for (const s of r.sessions) console.log(`${s.name}\t${s.model}\t${s.branch ?? "(project folder)"}\t${s.id}`);
  ' "$resp"
}

lead_items="$(node -e 'console.log(JSON.stringify(JSON.parse(process.argv[1]).filter(i => i.role === "lead")))' "$items")"
team_items="$(node -e 'console.log(JSON.stringify(JSON.parse(process.argv[1]).filter(i => i.role !== "lead")))' "$items")"

# The server refuses a lead's children past settings.team.maxChildren (default 8). Checked before the lead exists,
# so a team that cannot be built leaves no lone lead holding the issue.
over="$(node -e '
  const [raw, items] = process.argv.slice(1);
  const max = JSON.parse(raw).settings?.team?.maxChildren ?? 8;
  const n = JSON.parse(items).reduce((a, i) => a + (i.n ?? 1), 0);
  if (n > max) console.log(`${n} teammates but maxChildren is ${max}`);
' "$state" "$team_items")"
if [ -n "$over" ]; then
  echo "Preset '$preset' needs $over (설정 → 관리자와 팀). Pick a smaller preset or raise it; no team started." >&2
  exit 1
fi

lead_line="$(post "$(mk "$lead_items" "Your team is being created right now as your children (list_sessions shows them). Do not create sessions for these roles again; assign work to them with send_message. Each teammate's finished turn reaches you automatically as a \"[name 보고 · branch]\" message, so end your turn when you are waiting for a report instead of sleeping or polling.${merger:+ The merge role of this project is $merger (not your child): hand merges to it with send_message.}")")"
lead_id="${lead_line##*$'\t'}"
if ! team_lines="$(post "$(mk "$team_items" "Your lead is the 관리자 session. Wait for its assignment before starting work: answer this first message only with a one-line ready note. Your final answer each turn is forwarded to the lead automatically; use message_lead only for questions mid-turn." "$lead_id")")"; then
  # No lone lead: it would hold the issue, and a rerun would only print its name (#1034).
  curl -sf -X POST "$url/api/sessions/$lead_id/remove" "${H[@]}" -d '{}' >/dev/null \
    || echo "Could not remove the lead ${lead_line%%$'\t'*}; remove it before running again." >&2
  echo "The team was not created, so its lead was removed. Fix the reason above and run again." >&2
  exit 1
fi
printf '%s\n%s\n' "$lead_line" "$team_lines" | cut -f1-3
echo "Atelier: $url"
