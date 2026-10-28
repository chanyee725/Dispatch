#!/usr/bin/env bash
# Check Claude Code / Codex CLIs and log in to the ones that need it.
#
#   setup.sh --status          show install + login status only
#   setup.sh claude codex      log in to the named providers (skips ones already logged in)
#   setup.sh                   show status, then ask which providers to log in (needs a terminal)
#
# Login is done by each CLI (browser OAuth). This script never reads or stores tokens.
set -uo pipefail

installed() { command -v "$1" >/dev/null 2>&1; }

claude_logged_in() {
  claude auth status 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.exit(JSON.parse(s).loggedIn?0:1)}catch{process.exit(1)}})'
}
codex_logged_in() {
  local out
  out="$(codex login status 2>&1)" || return 1
  grep -qi "logged in" <<<"$out" && ! grep -qi "not logged in" <<<"$out"
}

status_line() {
  local name="$1" bin="$2" check="$3" hint="$4"
  if ! installed "$bin"; then
    printf '%-7s not installed   → %s\n' "$name" "$hint"
  elif "$check"; then
    printf '%-7s logged in       (%s)\n' "$name" "$("$bin" --version 2>/dev/null | head -1)"
  else
    printf '%-7s not logged in   → %s\n' "$name" "setup.sh $name"
  fi
}

show_status() {
  status_line claude claude claude_logged_in "install Claude Code: https://docs.anthropic.com/claude-code"
  status_line codex codex codex_logged_in "install Codex CLI: npm i -g @openai/codex"
}

login() {
  case "$1" in
    claude)
      installed claude || { echo "claude is not installed" >&2; return 1; }
      if claude_logged_in; then echo "claude: already logged in"; return 0; fi
      echo "claude: opening browser login…"
      claude auth login
      ;;
    codex|gpt|openai)
      installed codex || { echo "codex is not installed" >&2; return 1; }
      if codex_logged_in; then echo "codex: already logged in"; return 0; fi
      echo "codex: opening browser login (ChatGPT account)…"
      codex login
      ;;
    *)
      echo "unknown provider: $1 (use claude or codex)" >&2
      return 1
      ;;
  esac
}

if [ "${1:-}" = "--status" ]; then
  show_status
  exit 0
fi

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  show_status
  if [ ! -t 0 ]; then
    echo "Run with provider names to log in, e.g. setup.sh claude codex"
    exit 0
  fi
  read -r -p "Log in to which? [claude/codex/both/none] " answer
  case "$answer" in
    claude) targets=(claude) ;;
    codex|gpt) targets=(codex) ;;
    both|all) targets=(claude codex) ;;
    *) exit 0 ;;
  esac
fi

rc=0
for t in "${targets[@]}"; do login "$t" || rc=1; done
echo
show_status
exit $rc
