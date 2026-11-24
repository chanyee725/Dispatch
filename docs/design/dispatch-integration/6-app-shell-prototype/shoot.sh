#!/usr/bin/env bash
# Headless screenshots of the E42 prototype (no visible window, no network).
# Usage: [LAYOUTS="a b mix"] [THEMES="dark light"] shoot.sh <out-dir> [PretendardVariable.woff2]
# The font file is optional (OFL-1.1, from node_modules/pretendard/dist/web/variable/woff2/); it is linked into a
# temp copy, never committed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:?out dir}"
pret="${2:-}"
chrome="${CHROME:-google-chrome}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$here/index.html" "$tmp/"
mkdir -p "$tmp/fonts" "$out"
[ -n "$pret" ] && ln -s "$pret" "$tmp/fonts/Pretendard.woff2"

shot() { # layout theme screen width height
  local name="$1-$2-$3-$4.png"
  "$chrome" --headless=new --disable-gpu --no-sandbox --hide-scrollbars --force-device-scale-factor=1 \
    --no-first-run --disable-extensions --disable-background-networking --user-data-dir="$tmp/profile" \
    --window-size="$4,$5" --screenshot="$out/$name" --virtual-time-budget=1500 \
    "file://$tmp/index.html?layout=$1&theme=$2&screen=$3" >/dev/null 2>&1
  echo "$out/$name"
}
for l in ${LAYOUTS:-a b mix}; do for t in ${THEMES:-dark light}; do
  for s in home project doc cmd; do shot "$l" "$t" "$s" 1440 900; done
  for s in home project doc cmd nav; do shot "$l" "$t" "$s" 390 844; done
done; done
