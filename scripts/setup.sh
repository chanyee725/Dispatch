#!/usr/bin/env bash
# One-shot setup for Dispatch on this machine.
#
#   scripts/setup.sh                          check tools, link the skills for Claude Code + Codex, ask which CLIs to log in
#   scripts/setup.sh --project ~/work/app     also link the skill into that project (.claude/skills + .agents/skills)
#   scripts/setup.sh --login claude,codex     log in to these CLIs without asking (claude | codex | both | none)
#   scripts/setup.sh --no-global              skip linking into ~/.claude/skills and ~/.codex/skills
#
# Safe to run again: links are refreshed and logged-in CLIs are skipped.
set -euo pipefail

repo="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
skill="$repo/skills/dispatch"
global=true
projects=()
login=""

while [ $# -gt 0 ]; do
  case "$1" in
    --project) projects+=("$(cd "$2" && pwd)"); shift 2 ;;
    --login) login="$2"; shift 2 ;;
    --no-global) global=false; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1"; }

step "1. Tools"
if ! command -v node >/dev/null; then warn "Node.js 22.6+ is required: https://nodejs.org"; exit 1; fi
# 22.6 is the first release that runs .ts files directly (npm test loads web/src helpers); Node 20 is EOL.
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 6) ? 0 : 1)' \
  || { warn "Node.js 22.6+ is required (found $(node -v))"; exit 1; }
ok "node $(node -v)"
command -v git >/dev/null && ok "$(git --version)" || warn "git not found: worktrees per session will be unavailable"
command -v claude >/dev/null && ok "claude $(claude --version 2>/dev/null | head -1)" || warn "Claude Code not installed: https://docs.anthropic.com/claude-code"
command -v codex >/dev/null && ok "$(codex --version 2>/dev/null | head -1)" || warn "Codex CLI not installed: npm i -g @openai/codex"

step "2. Web UI"
if [ -f "$repo/public/index.html" ]; then
  ok "prebuilt UI found in public/"
else
  npm --prefix "$repo/web" install --no-audit --no-fund >/dev/null && npm --prefix "$repo/web" run build >/dev/null
  ok "built web/ into public/"
fi

step "3. Skills"
# Every skill in skills/ (dispatch, dispatch-team, dispatch-update, …), so a new skill reaches
# this machine on the next setup or update.
link() {
  mkdir -p "$1"
  for s in "$repo"/skills/*/; do
    s="${s%/}"
    [ -f "$s/SKILL.md" ] || continue
    ln -sfn "$s" "$1/$(basename "$s")"
    ok "$1/$(basename "$s") → $s"
  done
}
if $global; then
  link "$HOME/.claude/skills"
  link "${CODEX_HOME:-$HOME/.codex}/skills"
fi
for p in "${projects[@]}"; do
  link "$p/.claude/skills"
  link "$p/.agents/skills"
done
$global || [ ${#projects[@]} -gt 0 ] || warn "nothing linked (--no-global without --project)"

step "4. Login"
case "$login" in
  "") "$skill/scripts/setup.sh" ;;            # shows status, asks when run in a terminal
  none) "$skill/scripts/setup.sh" --status ;;
  both|all) "$skill/scripts/setup.sh" claude codex ;;
  *) IFS=, read -r -a targets <<<"$login"; "$skill/scripts/setup.sh" "${targets[@]}" ;;
esac

step "Done"
cat <<EOF
  Start Dispatch for a project:
    $skill/scripts/start.sh <project-dir>        → http://127.0.0.1:4317
  Or ask Claude Code / Codex in that project: "dispatch 띄워줘"
  In the UI, connect Claude and/or Codex on the first screen before creating sessions.
EOF
