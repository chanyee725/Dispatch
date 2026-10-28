#!/usr/bin/env bash
# Start (or reuse) the Dispatch server for a project and print its URL.
set -euo pipefail

skill_dir="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
dispatch_root="$(cd "$skill_dir/../.." && pwd)"
target="$(cd "${1:-$PWD}" && pwd)"
project="$(git -C "$target" rev-parse --show-toplevel 2>/dev/null || echo "$target")"
port="${DISPATCH_PORT:-4317}"
url="http://127.0.0.1:$port"

if state="$(curl -sf "$url/api/state" 2>/dev/null)"; then
  running="$(printf '%s' "$state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).project.path))')"
  if [ "${running/#\~/$HOME}" = "$project" ]; then
    echo "Dispatch already running for $project → $url"
    exit 0
  fi
  echo "Port $port is serving another project ($running). Set DISPATCH_PORT to use a different port." >&2
  exit 1
fi

mkdir -p "$project/.dispatch"
DISPATCH_PORT="$port" nohup node "$dispatch_root/server/index.js" "$project" >"$project/.dispatch/server.log" 2>&1 &
echo $! >"$project/.dispatch/server.pid"

for _ in $(seq 1 60); do
  if curl -sf "$url/api/state" >/dev/null 2>&1; then
    echo "Dispatch running for $project → $url"
    exit 0
  fi
  sleep 0.5
done
echo "Dispatch did not start; see $project/.dispatch/server.log" >&2
exit 1
