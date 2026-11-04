#!/usr/bin/env bash
# Bring this machine's Dispatch up to the latest commit and make everything use it.
#
#   scripts/update.sh              pull, relink skills, restart every running Dispatch server
#   scripts/update.sh --no-restart pull and relink only
#   scripts/update.sh --build      also rebuild the web UI from web/ (public/ is normally committed)
#
# Safe to run again. Refuses to pull over local changes in this clone (commit or stash them first).
set -euo pipefail

repo="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
scripts="$repo/skills/dispatch/scripts"
restart=true
build=false
while [ $# -gt 0 ]; do
  case "$1" in
    --no-restart) restart=false; shift ;;
    --build) build=true; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1"; }

step "1. Pull"
cd "$repo"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  warn "local changes in $repo — commit or stash them, then run again:"
  git status --short --untracked-files=no | sed 's/^/    /'
  exit 1
fi
branch="$(git branch --show-current)"
before="$(git rev-parse --short HEAD)"
git fetch -q origin
git pull -q --ff-only origin "$branch"
after="$(git rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then ok "already at $after ($branch)"; else ok "$before → $after ($branch)"; git log --oneline "$before..$after" | sed 's/^/    /' | head -20; fi

if $build; then
  step "2. Web UI"
  npm --prefix "$repo/web" install --no-audit --no-fund >/dev/null
  npm --prefix "$repo/web" run build >/dev/null
  ok "rebuilt web/ into public/"
fi

step "3. Skills"
"$repo/scripts/setup.sh" --login none | sed -n '/Skills/,/Login/p' | grep '✓' || true

if $restart; then
  step "4. Restart running servers"
  reg="$HOME/.dispatch/servers"
  found=0
  for f in "$reg"/*.json; do
    [ -f "$f" ] || continue
    eval "$(node -e '
      const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const alive = (() => { try { process.kill(e.pid, 0); return true; } catch (x) { return x.code === "EPERM"; } })();
      const p = String(e.path || "").replace(/^~/, process.env.HOME);
      console.log(`port=${e.port || ""}; path=${JSON.stringify(p)}; alive=${alive}`);
    ' "$f")"
    [ "$alive" = true ] && [ -d "$path" ] || continue
    found=$((found + 1))
    mkdir -p "$path/.dispatch"
    [ -f "$path/.dispatch/server.port" ] || echo "$port" >"$path/.dispatch/server.port"
    if [ ! -f "$path/.dispatch/server.pid" ]; then
      # Started before pid files existed: stop it by its registered pid.
      kill "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pid' "$f")" 2>/dev/null || true
      sleep 1
      DISPATCH_PORT="$port" "$scripts/start.sh" "$path" | sed 's/^/    /'
    else
      DISPATCH_PORT="$port" "$scripts/restart.sh" "$path" | sed 's/^/    /'
    fi
  done
  [ "$found" -gt 0 ] && ok "restarted $found server(s); cut-off turns resume on their own" || ok "no running servers"
fi

step "Done"
echo "  Dispatch is at $(git -C "$repo" log -1 --format='%h %s')"
