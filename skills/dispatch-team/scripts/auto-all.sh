#!/usr/bin/env bash
# Switch every open session of the Dispatch server on $DISPATCH_PORT (default 4317) to a permission mode.
#   auto-all.sh [mode]      mode: auto (default) | acceptEdits | plan | manual
# Uses POST /api/sessions/<id>/perm, so sessions keep their transcript and context.
set -euo pipefail

mode="${1:-auto}"
url="http://127.0.0.1:${DISPATCH_PORT:-4317}"
state="$(curl -sf "$url/api/state")" || { echo "No Dispatch server on $url" >&2; exit 1; }

node -e '
  const s = JSON.parse(process.argv[1]);
  for (const x of s.sessions) if (x.status !== "done" && x.perm !== process.argv[2]) console.log(`${x.id}\t${x.name}\t${x.perm}`);
' "$state" "$mode" | while IFS=$'\t' read -r id name perm; do
  if out="$(curl -s -X POST "$url/api/sessions/$id/perm" -H 'content-type: application/json' -H 'x-dispatch: 1' \
      -d "{\"perm\":\"$mode\"}")" && [[ "$out" == *'"ok":true'* ]]; then
    echo "$name: $perm → $mode"
  else
    echo "$name: $out" >&2
  fi
done
