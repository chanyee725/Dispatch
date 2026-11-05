#!/usr/bin/env bash
# Add one teammate to an existing lead, with the shared team rules and the lead as its parent.
#   add.sh <lead-name-or-id> <role> "<task>" [model]
# e.g. add.sh "Juno" design "Review every merged screen against the design guide." claude-opus-5-5
set -euo pipefail

here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
skill="$(dirname "$here")"
lead="${1:?usage: add.sh <lead-name-or-id> <role> \"<task>\" [model]}"
role="${2:?role id (impl, review, test, design, docs)}"
task="${3:?task text}"
model="${4:-${DISPATCH_TEAM_MODEL:-}}"
url="http://127.0.0.1:${DISPATCH_PORT:-4317}"

state="$(curl -sf "$url/api/state")" || { echo "Dispatch is not running at $url" >&2; exit 1; }
body="$(node -e '
  const fs = require("fs");
  const [stateRaw, lead, role, task, model, effort, perm, rulesPath] = process.argv.slice(1);
  const st = JSON.parse(stateRaw);
  const l = st.sessions.find(s => s.canSpawn && (s.id === lead || s.name === lead));
  if (!l) { console.error(`No lead named "${lead}". Leads: ${st.sessions.filter(s => s.canSpawn).map(s => s.name).join(", ") || "none"}`); process.exit(1); }
  const rules = fs.readFileSync(rulesPath, "utf8").trim();
  process.stdout.write(JSON.stringify({
    worktree: true, parent: l.id,
    items: [{ role, task: `${rules}\n\nYour lead is ${l.name}. Your final answer each turn is forwarded to it automatically.\n\n${task}`,
      ...(model && { model }), ...(effort && { effort }), ...(perm && { perm }) }],
  }));
' "$state" "$lead" "$role" "$task" "$model" "${DISPATCH_TEAM_EFFORT:-}" "${DISPATCH_TEAM_PERM:-}" "$skill/reference/rules.md")"
resp="$(curl -s -X POST "$url/api/sessions" -H 'content-type: application/json' -H 'x-dispatch: 1' -d "$body")"
node -e '
  const r = JSON.parse(process.argv[1]);
  if (r.error) { console.error(r.error); process.exit(1); }
  for (const s of r.sessions) console.log(`${s.name}\t${s.model}\t${s.branch ?? "(project folder)"}`);
' "$resp"
