#!/usr/bin/env bash
# Stop the Dispatch server started by start.sh for a project. server.pid is trusted only when that
# process is node running a Drawing server/index.js for <project>/.atelier (or the older <project>/atelier or <project>/pipelines); otherwise it is stale.
set -euo pipefail

# shellcheck source=../../../scripts/server-check.sh
source "$(dirname "$(dirname "$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")")")/scripts/server-check.sh"

target="$(cd "${1:-$PWD}" && pwd -P)"
project="$(git -C "$target" rev-parse --show-toplevel 2>/dev/null || echo "$target")"
pid_file="$(state_dir "$project")/server.pid"
pid=""
[ ! -f "$pid_file" ] || pid="$(tr -dc '0-9' < "$pid_file" 2>/dev/null || true)"

if [ -n "$pid" ] && is_our_project_server "$pid" "$project"; then
  kill "$pid"
  rm -f "$pid_file"
  echo "Dispatch stopped for $project"
else
  rm -f "$pid_file"
  echo "No Dispatch server running for $project"
fi
