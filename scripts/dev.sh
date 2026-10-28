#!/usr/bin/env bash
# Bring up everything for local development in one terminal:
#   - Dispatch server (API + built UI)  → http://127.0.0.1:$DISPATCH_PORT (default 4317)
#   - Vite dev server (live UI reload)  → http://127.0.0.1:$WEB_PORT (default 5173), proxies /api to the server
#
#   scripts/dev.sh [project-dir]     project defaults to this repo
#   scripts/dev.sh --no-web          only the Dispatch server (serves the last build in public/)
#
# Ctrl+C stops both.
set -euo pipefail

repo="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
web=true
project="$repo"
for arg in "$@"; do
  case "$arg" in
    --no-web) web=false ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) project="$(cd "$arg" && pwd)" ;;
  esac
done

export DISPATCH_PORT="${DISPATCH_PORT:-4317}"
web_port="${WEB_PORT:-5173}"

if curl -sf "http://127.0.0.1:$DISPATCH_PORT/api/state" >/dev/null 2>&1; then
  echo "Port $DISPATCH_PORT is already serving Dispatch. Stop it first (skills/dispatch/scripts/stop.sh <project>) or set DISPATCH_PORT." >&2
  exit 1
fi

if $web && [ ! -d "$repo/web/node_modules" ]; then
  echo "Installing web dependencies…"
  npm --prefix "$repo/web" install --no-audit --no-fund
fi
if [ ! -f "$repo/public/index.html" ]; then
  echo "Building the UI…"
  npm --prefix "$repo/web" run build
fi

pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Process substitution keeps $! pointing at node/vite themselves, so cleanup can stop them.
node "$repo/server/index.js" "$project" > >(sed -u 's/^/[server] /') 2>&1 &
pids+=($!)

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$DISPATCH_PORT/api/state" >/dev/null 2>&1 && break
  sleep 0.5
done

if $web; then
  (cd "$repo/web" && exec ./node_modules/.bin/vite --host 127.0.0.1 --port "$web_port" --strictPort) > >(sed -u 's/^/[web]    /') 2>&1 &
  pids+=($!)
fi

sleep 1
echo
echo "  Dispatch  http://127.0.0.1:$DISPATCH_PORT   (project: $project)"
$web && echo "  Dev UI    http://127.0.0.1:$web_port   (live reload)"
echo "  Ctrl+C to stop"
echo

# Exit (and stop the other one) as soon as either process dies.
wait -n
