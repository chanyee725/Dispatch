#!/usr/bin/env bash
# Restart the Dispatch server for a project (to load new server code). Sessions cut off mid-turn
# are resumed automatically, and session metadata survives in .atelier/state.json.
set -euo pipefail
here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=../../../scripts/server-check.sh
source "$(dirname "$(dirname "$(dirname "$here")")")/scripts/server-check.sh"
start="$(dirname "$(dirname "$(dirname "$here")")")/scripts/start.sh"
[ -f "$start" ] || { echo "missing $start; server not stopped" >&2; exit 1; }
# start.sh reads DISPATCH_PORT or DRAW_PORT: pass either one on as both.
port="${DRAW_PORT:-${DISPATCH_PORT:-}}"
if [ -n "$port" ]; then
  [[ "$port" =~ ^[0-9]+$ ]] || { echo "bad port: $port" >&2; exit 1; }
  export DRAW_PORT="$port" DISPATCH_PORT="$port"
fi
proj="$(git -C "${1:-$PWD}" rev-parse --show-toplevel 2>/dev/null || (cd "${1:-$PWD}" && pwd -P))"
old=""
pid_file="$(state_dir "$proj")/server.pid"
[ ! -f "$pid_file" ] || old="$(tr -dc '0-9' < "$pid_file" 2>/dev/null || true)"
# Only wait for a pid that is our server; a recycled pid is stale and stop.sh ignores it too.
{ [ -z "$old" ] || is_our_project_server "$old" "$proj"; } || old=""
"$here/stop.sh" "${1:-$PWD}"
# Wait (about 10s; each poll also costs a ps call) for the old server to exit so start.sh never finds it still answering.
if [ -n "$old" ]; then
  # A zombie (exited, not yet reaped by its parent) counts as gone.
  # A pid recycled by an unrelated process during the wait also counts as gone.
  running() { kill -0 "$old" 2>/dev/null && [[ "$(ps -o stat= -p "$old" 2>/dev/null || true)" != Z* ]] && is_our_project_server "$old" "$proj"; }
  # DRAW_RESTART_WAIT_TENTHS (default 100 = about 10s) only exists so tests can shorten the wait.
  for _ in $(seq 1 "${DRAW_RESTART_WAIT_TENTHS:-100}"); do running || break; sleep 0.1; done
  if running; then echo "old server (pid $old) did not exit within the wait (about 10s by default); not starting a new one" >&2; exit 1; fi
fi
"$start" "${1:-$PWD}"
