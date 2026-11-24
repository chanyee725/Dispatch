#!/usr/bin/env bash
# Call the Atelier server of a project from a skill (Claude Code or Codex).
#   api.sh [-C project-root] METHOD PATH [BODY]
#     METHOD  GET, POST, PUT, PATCH or DELETE
#     PATH    starts with /api/ (query string allowed; encode it yourself)
#     BODY    JSON text, or @file to send a file's contents, or - for stdin
# Port: <project>/.atelier/server.port (or an older .dispatch/), else $DRAW_PORT / $DISPATCH_PORT, else 4330.
# project-root defaults to the git top level of the current folder, else the current folder.
# Non-GET requests carry x-drawing: 1, and x-drawing-session: $DRAWING_SESSION when that is set.
# Prints the response body; exits 1 on an HTTP status >= 400 (body on stderr) or when no server answers.
# Talks to 127.0.0.1 only. Gives up after $ATELIER_API_TIMEOUT seconds (default 60).
set -euo pipefail

root=""
if [ "${1:-}" = "-C" ]; then root="${2:?-C needs a folder}"; shift 2; fi
[ $# -ge 2 ] || { sed -n '2,10p' "$0" >&2; exit 2; }
method="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
path="$2"
body="${3:-}"
case "$method" in GET | POST | PUT | PATCH | DELETE) ;; *) echo "Bad method: $1" >&2; exit 2 ;; esac
[[ "$path" == /api/* ]] || { echo "PATH must start with /api/" >&2; exit 2; }

if [ -z "$root" ]; then root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; fi
port=""
for f in "$root/.atelier/server.port" "$root/.dispatch/server.port"; do
  if [ -f "$f" ]; then port="$(tr -d '[:space:]' < "$f")"; break; fi
done
port="${port:-${DRAW_PORT:-${DISPATCH_PORT:-4330}}}"
[[ "$port" =~ ^[0-9]+$ ]] || { echo "Bad port: $port" >&2; exit 1; }

timeout="${ATELIER_API_TIMEOUT:-60}"
[[ "$timeout" =~ ^[0-9]+$ ]] || { echo "Bad ATELIER_API_TIMEOUT: $timeout" >&2; exit 2; }
# -g: brackets and braces in a path or query (노트[1]) are sent as they are, not expanded by curl.
args=(-sS -g --max-time "$timeout" -X "$method" -w '\n%{http_code}')
if [ "$method" != GET ]; then
  args+=(-H 'x-drawing: 1')
  [ -n "${DRAWING_SESSION:-}" ] && args+=(-H "x-drawing-session: $DRAWING_SESSION")
fi
if [ -n "$body" ]; then
  args+=(-H 'content-type: application/json')
  case "$body" in
    @* | -) args+=(--data-binary "${body/#-/@-}") ;;
    *) args+=(--data-binary "$body") ;;
  esac
fi

out="$(curl "${args[@]}" "http://127.0.0.1:$port$path")" || { echo "No Atelier server on http://127.0.0.1:$port (start it with atelier-setup)" >&2; exit 1; }
code="${out##*$'\n'}"
text="${out%$'\n'*}"
if [ "$code" -ge 400 ]; then
  printf '%s\n' "HTTP $code $text" >&2
  exit 1
fi
printf '%s\n' "$text"
