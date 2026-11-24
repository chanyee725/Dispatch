#!/usr/bin/env bash
# Check Claude Code / Codex CLIs and log in to the ones that need it.
#
#   setup.sh --install         make the Atelier checkout runnable: when public/index.html is missing, npm ci
#                              (only when node_modules is missing) and npm run build; then show --status
#   setup.sh --status          show install + login status only (claude, codex, and gh for issues and PRs)
#   setup.sh claude codex      log in to the named providers (skips ones already logged in)
#   setup.sh                   show status, then ask which providers to log in (needs a terminal)
#
# Login is done by each CLI (browser OAuth). This script never reads or stores tokens.
set -uo pipefail

installed() { command -v "$1" >/dev/null 2>&1; }

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
home=${DRAWING_HOME:-$(cd "$here/../../../.." && pwd -P)}
if [ -z "${DRAWING_HOME:-}" ] && [ ! -f "$home/server/index.js" ]; then
  # A plugin copy in Claude Code's or Codex's plugin cache: fall back to the installed release (atelier-update).
  inst="${DRAWING_INSTALL_BASE:-$HOME/.dispatch/drawing}/current"
  if [ -f "$inst/server/index.js" ]; then home=$(cd "$inst" && pwd -P); fi
fi

# A release bundle ships public/ built; a git checkout needs npm ci + npm run build once (and after updates that
# remove public/). Output goes to stderr so --install can be chained with other commands.
install_app() {
  [ -f "$home/server/index.js" ] || { echo "Atelier not found in $home (set DRAWING_HOME to an Atelier checkout)" >&2; return 1; }
  if [ -f "$home/public/index.html" ]; then echo "atelier: web app already built ($home)" >&2; return 0; fi
  [ -f "$home/package.json" ] || { echo "atelier: public/ is missing and $home is not a checkout; reinstall it" >&2; return 1; }
  installed npm || { echo "atelier: npm is not installed (Node.js 22.18+ needed)" >&2; return 1; }
  if [ ! -d "$home/node_modules" ]; then
    echo "atelier: installing packages (npm ci)…" >&2
    (cd "$home" && npm ci --no-audit --no-fund) >&2 || return 1
  fi
  echo "atelier: building the web app (npm run build)…" >&2
  (cd "$home" && npm run build) >&2 || return 1
  [ -f "$home/public/index.html" ] || { echo "atelier: build finished but public/index.html is missing" >&2; return 1; }
  echo "atelier: web app built" >&2
}

gh_logged_in() { gh auth status >/dev/null 2>&1; }

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
  if ! installed gh; then
    printf '%-7s not installed   → %s\n' gh "install GitHub CLI (https://cli.github.com), then run gh auth login; issues and PRs need it"
  elif gh_logged_in; then
    printf '%-7s logged in       (%s)\n' gh "$(gh --version 2>/dev/null | head -1)"
  else
    printf '%-7s not logged in   → %s\n' gh "gh auth login"
  fi
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

if [ "${1:-}" = "--install" ]; then
  rc=0
  install_app || rc=1
  show_status
  exit $rc
fi

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
