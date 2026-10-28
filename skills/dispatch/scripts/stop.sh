#!/usr/bin/env bash
# Stop the Dispatch server started by start.sh for a project.
set -euo pipefail

target="$(cd "${1:-$PWD}" && pwd)"
project="$(git -C "$target" rev-parse --show-toplevel 2>/dev/null || echo "$target")"
pid_file="$project/.dispatch/server.pid"

if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  kill "$(cat "$pid_file")"
  rm -f "$pid_file"
  echo "Dispatch stopped for $project"
else
  rm -f "$pid_file"
  echo "No Dispatch server running for $project"
fi
