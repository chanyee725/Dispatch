#!/usr/bin/env bash
# Create a Dispatch team for a task.
#   team.sh <project-dir> <small|standard|ui|full> "<task>"
# Starts or reuses the server (sibling dispatch skill), connects Claude when the CLI is logged in,
# and creates the preset's sessions with the shared team rules prepended to the task.
set -euo pipefail

here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
skill="$(dirname "$here")"
dispatch_scripts="$(dirname "$skill")/dispatch/scripts"

project="${1:?usage: team.sh <project-dir> <small|standard|ui|full> \"<task>\"}"
preset="${2:?preset: small | standard | ui | full}"
task="${3:?task text}"
project="$(cd "$project" && pwd)"
port="${DISPATCH_PORT:-4317}"
url="http://127.0.0.1:$port"
H=(-H 'content-type: application/json' -H 'x-dispatch: 1')

case "$preset" in
  small)    items='[{"role":"lead"},{"role":"impl"},{"role":"review"}]' ;;
  standard) items='[{"role":"lead"},{"role":"impl","n":2},{"role":"review"},{"role":"test"}]' ;;
  ui)       items='[{"role":"lead"},{"role":"impl"},{"role":"design"},{"role":"review"}]' ;;
  full)     items='[{"role":"lead"},{"role":"impl","n":3},{"role":"review","n":2},{"role":"test"},{"role":"docs"}]' ;;
  *) echo "Unknown preset '$preset' (small | standard | ui | full)" >&2; exit 2 ;;
esac

# Server: reuse when it already serves this project; start.sh prints why it can't otherwise.
DISPATCH_PORT="$port" "$dispatch_scripts/start.sh" "$project"

state="$(curl -sf "$url/api/state")"
connected="$(node -e 'const s=JSON.parse(process.argv[1]);console.log(String(!!s.providers?.claude?.connected))' "$state")"
logged_in="$(node -e 'const s=JSON.parse(process.argv[1]);console.log(String(!!s.providers?.claude?.cliLoggedIn))' "$state")"
if [ "$connected" != "true" ]; then
  if [ "$logged_in" != "true" ]; then
    echo "Claude CLI is not logged in. Ask the user to run: ! $dispatch_scripts/setup.sh claude" >&2
    exit 1
  fi
  curl -sf -X POST "$url/api/providers/claude/login" "${H[@]}" -d '{}' >/dev/null
fi

# Lead first, then every teammate created as its child: a child's finished turn is forwarded to the lead,
# so the lead wakes on reports instead of polling, and its list_sessions shows the team.
mk() { # mk <items-json> <role-note> [parent-id] → POST body
  node -e '
    const fs = require("fs");
    const [rulesPath, task, items, note, parent, model, effort, perm] = process.argv.slice(1);
    const rules = fs.readFileSync(rulesPath, "utf8").trim();
    // DISPATCH_TEAM_MODEL / _EFFORT / _PERM override every item (cheap test runs: claude-haiku-5-5, low;
    // a fully hands-off team: auto).
    const list = JSON.parse(items).map((i) => ({
      ...i, ...(model && { model }), ...(effort && { effort }), ...(perm && { perm }),
    }));
    process.stdout.write(JSON.stringify({
      commonPrompt: `${rules}\n\n${note}\n\nTask from the user:\n${task}`,
      worktree: true,
      items: list,
      ...(parent && { parent }),
    }));
  ' "$skill/reference/rules.md" "$task" "$1" "$2" "${3:-}" "${DISPATCH_TEAM_MODEL:-}" "${DISPATCH_TEAM_EFFORT:-}" "${DISPATCH_TEAM_PERM:-}"
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

lead_line="$(post "$(mk "$lead_items" "Your team is being created right now as your children (list_sessions shows them). Do not create sessions for these roles again; assign work to them with send_message. Each teammate's finished turn reaches you automatically as a \"[name 보고 · branch]\" message, so end your turn when you are waiting for a report instead of sleeping or polling.")")"
lead_id="${lead_line##*$'\t'}"
team_lines="$(post "$(mk "$team_items" "Your lead is the 관리자 session. Wait for its assignment before starting work: answer this first message only with a one-line ready note. Your final answer each turn is forwarded to the lead automatically; use message_lead only for questions mid-turn." "$lead_id")")"
printf '%s\n%s\n' "$lead_line" "$team_lines" | cut -f1-3
echo "Dispatch: $url"
