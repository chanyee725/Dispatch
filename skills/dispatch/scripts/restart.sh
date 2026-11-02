#!/usr/bin/env bash
# Restart the Dispatch server for a project (to load new server code). Sessions cut off mid-turn
# are resumed automatically, and transcripts survive in .dispatch/transcripts.
set -euo pipefail
here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
"$here/stop.sh" "${1:-$PWD}"
sleep 1
"$here/start.sh" "${1:-$PWD}"
