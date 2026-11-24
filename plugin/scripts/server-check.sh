#!/usr/bin/env bash
# Sourced by stop.sh and update.sh. Defines is_our_server; nothing runs on source.

# Succeeds only when pid $1 is node running a Drawing server/index.js in project mode on workspace $2
# (what start.sh launches). Linux: argv from /proc/<pid>/cmdline, compared token by token, so a node
# or workspace path with spaces works. Elsewhere (macOS): `ps -ww -o command=` (-ww: no truncation),
# one joined string, so a node path with spaces is refused (the safe side). Nothing is eval'd.
is_our_server() {
  local pid=$1 workspace=$2 cmd first n
  local -a argv=()
  [[ "$pid" =~ ^[0-9]+$ ]] && [ "$pid" -gt 0 ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  if [ -r "/proc/$pid/cmdline" ]; then
    mapfile -d '' -t argv < "/proc/$pid/cmdline" 2>/dev/null || true
    n=${#argv[@]}
    [ "$n" -ge 4 ] || return 1
    case "$(basename -- "${argv[0]}")" in node|nodejs) ;; *) return 1 ;; esac
    [ "${argv[n-1]}" = "$workspace" ] && [ "${argv[n-2]}" = "--project-mode" ] || return 1
    [[ "${argv[n-3]}" == */server/index.js ]]
    return
  fi
  cmd=$(ps -ww -o command= -p "$pid" 2>/dev/null || true)
  cmd=${cmd%"${cmd##*[![:space:]]}"}
  [ -n "$cmd" ] || return 1
  first=${cmd%% *}
  case "${first##*/}" in node|nodejs) ;; *) return 1 ;; esac
  [[ "$cmd" == *"/server/index.js --project-mode $workspace" ]]
}

# Succeeds when pid $1 is our server for project $2: on <project>/.atelier, or on the older <project>/atelier or
# <project>/pipelines (a server started before #782 or #773, so stop/restart/update still find it).
is_our_project_server() {
  is_our_server "$1" "$2/.atelier" || is_our_server "$1" "$2/atelier" || is_our_server "$1" "$2/pipelines"
}

# The project's state folder (server.pid, server.port, server.log): <project>/.atelier, or an older
# version's <project>/.dispatch while it is still there (the server moves it once no session is saved,
# #782). A .dispatch symlink is never used. Never creates either folder.
state_dir() {
  if [ -d "$1/.dispatch" ] && [ ! -L "$1/.dispatch" ]; then echo "$1/.dispatch"; else echo "$1/.atelier"; fi
}
