#!/usr/bin/env bash
# Starts the Atelier server for a git project, in project mode (the whole app for that one project).
#   start.sh <project>
# Workspace = <project>/.atelier (created when missing and kept out of git through .git/info/exclude; an older <project>/atelier or <project>/pipelines is moved into it
# once, keeping its structure, #782/#773). The port is kept in
# <project>/.atelier/server.port (or an older <project>/.dispatch/ until the server moves it, #782; its pid in server.pid, which stop.sh reads; both written only once
# the server is ready, a failed start leaves the old files alone; reusing a server rewrites server.pid
# from the lock); a server that already answers there is reused only when <project>/.atelier/.drawing/server.lock names it (live pid, same
# port), so another project's server on a recycled port is never mistaken for ours. Port order: remembered live server, else $DRAW_PORT, else $DISPATCH_PORT (team.sh and
# restart.sh pass it; handed to the server as DRAW_PORT). No ~/.dispatch/servers registry is written, else a free port. Prints nothing but the URL on success.
# The server binds 127.0.0.1 only. Prints the URL on stdout; nothing else is written outside the project.
set -euo pipefail

project=${1:-}
[ -n "$project" ] && [ -d "$project" ] || { echo "Usage: start.sh <project>" >&2; exit 1; }
project=$(cd "$project" && pwd -P)
top=$(git -C "$project" rev-parse --show-toplevel 2>/dev/null) || { echo "Not a git project: $project" >&2; exit 1; }
[ "$(cd "$top" && pwd -P)" = "$project" ] || { echo "Pass the git project's top folder: $top" >&2; exit 1; }

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
home=${DRAWING_HOME:-$(cd "$here/../.." && pwd -P)}
if [ -z "${DRAWING_HOME:-}" ] && [ ! -f "$home/server/index.js" ]; then
  # A plugin copy in Claude Code's or Codex's plugin cache: fall back to the installed release (atelier-update).
  inst="${DRAWING_INSTALL_BASE:-$HOME/.dispatch/drawing}/current"
  if [ -f "$inst/server/index.js" ]; then home=$(cd "$inst" && pwd -P); fi
fi
[ -f "$home/server/index.js" ] || { echo "Drawing server not found in $home (DRAWING_HOME must be a Drawing checkout)" >&2; exit 1; }

workspace=$project/.atelier
# State folder: <project>/.atelier, or an older <project>/.dispatch until the server moves it (#782).
state_of() { if [ -d "$project/.dispatch" ] && [ ! -L "$project/.dispatch" ]; then echo "$project/.dispatch"; else echo "$project/.atelier"; fi; }
state=$(state_of)
portfile=$state/server.port

# One-time move of the older workspace folders into .atelier/, structure kept: <project>/atelier (#782), then the
# pre-#773 <project>/pipelines. Entry by entry with mv -n: a name .atelier/ already has is never overwritten; it stays
# in the old folder, which is then kept and reported. Refused while a server still runs on an old folder (its agent
# sessions may still write there; stop.sh first). A lock folder keeps two start.sh runs from moving at once.
olds=()
for o in "$project/atelier" "$project/pipelines"; do
  [ -d "$o" ] && [ ! -L "$o" ] && olds+=("$o")
done
if [ ${#olds[@]} -gt 0 ]; then
  movelock=$project/.atelier-move.lock
  if ! mkdir "$movelock" 2>/dev/null; then
    lp=$(tr -dc '0-9' < "$movelock/pid" 2>/dev/null || true)
    if [ -z "$lp" ] || kill -0 "$lp" 2>/dev/null; then
      echo "Another start.sh is moving the workspace into $workspace. Try again in a moment (or remove $movelock if none runs)." >&2
      exit 1
    fi
    rm -rf "$movelock"
    mkdir "$movelock" 2>/dev/null || { echo "Another start.sh is moving the workspace into $workspace. Try again in a moment." >&2; exit 1; }
  fi
  echo "$$" > "$movelock/pid"
  trap 'rm -rf "$movelock"' EXIT
  for old in "${olds[@]}"; do
    oldpid=$(node -e 'try { const l = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.kill(l.pid, 0); console.log(l.pid); } catch (e) { if (e && e.code === "EPERM") console.log("eperm"); }' "$old/.drawing/server.lock" 2>/dev/null || true)
    if [ -n "$oldpid" ]; then
      echo "An Atelier server still runs on $old (pid $oldpid). Stop it first (stop.sh $project), then start again to move it to .atelier/." >&2
      exit 1
    fi
  done
  mkdir -p "$workspace"
  shopt -s dotglob nullglob
  for old in "${olds[@]}"; do
    kept=()
    for e in "$old"/*; do
      n=${e##*/}
      if [ -e "$workspace/$n" ] || [ -L "$workspace/$n" ]; then kept+=("$n"); else mv -n -- "$e" "$workspace/$n"; fi
    done
    if [ ${#kept[@]} -eq 0 ] && rmdir "$old" 2>/dev/null; then
      echo "Moved $old to $workspace" >&2
    else
      echo "Moved $old to $workspace; left in $old because .atelier/ already has them: ${kept[*]:-}" >&2
    fi
  done
  shopt -u dotglob nullglob
  rm -rf "$movelock"
  trap - EXIT
fi
mkdir -p "$workspace" "$state"
# Keep .atelier/ out of git: when the project does not ignore it yet, add it to .git/info/exclude (local only, the
# project's own .gitignore is left alone).
if ! git -C "$project" check-ignore -q .atelier/ 2>/dev/null; then
  exclude=$(git -C "$project" rev-parse --git-path info/exclude)
  case "$exclude" in /*) ;; *) exclude=$project/$exclude ;; esac
  mkdir -p "$(dirname "$exclude")"
  { [ ! -s "$exclude" ] || [ -z "$(tail -c1 "$exclude")" ] || echo; echo ".atelier/"; } >> "$exclude"
fi

lockfile=$workspace/.drawing/server.lock

# Succeeds only when OUR server answers on $1: /api/info says project mode on ".atelier" (every
# project-mode server says that), and our workspace lock names a live pid listening on that same port.
# With $2, the lock's pid must also be that pid (the server we just started).
ours() {
  node -e '
    const http = require("node:http");
    const fs = require("node:fs");
    const [port, lockfile, want] = process.argv.slice(1);
    let lock;
    try { lock = JSON.parse(fs.readFileSync(lockfile, "utf8")); } catch { process.exit(1); }
    if (!lock || String(lock.port) !== port || !Number.isInteger(lock.pid) || lock.pid <= 0) process.exit(1);
    if (want && String(lock.pid) !== want) process.exit(1);
    try { process.kill(lock.pid, 0); } catch (e) { if (e.code !== "EPERM") process.exit(1); }
    const req = http.get({ host: "127.0.0.1", port: Number(port), path: "/api/info", timeout: 1500 }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { try { const i = JSON.parse(b); if (i.mode === "project" && i.workspace === ".atelier") { if (!want) { process.stdout.write(lock.pid + "\n", () => process.exit(0)); return; } process.exit(0); } process.exit(1); } catch { process.exit(1); } });
    });
    req.on("error", () => process.exit(1)); req.on("timeout", () => req.destroy());
  ' "$1" "$lockfile" "${2:-}"
}

port=$({ tr -dc '0-9' < "$portfile"; } 2>/dev/null || true)
if [ -n "$port" ] && reused=$(ours "$port"); then
  # Reusing: rewrite server.pid with the lock's pid so stop.sh/update.sh still find it.
  [ -n "$reused" ] && echo "$reused" > "$state/server.pid"
  echo "http://127.0.0.1:$port/"
  exit 0
fi

# The wanted port when it is free, else any free port.
port=$(node -e '
  const net = require("node:net");
  const want = Number(process.argv[1]) || 0;
  const tryPort = (p, next) => {
    const s = net.createServer();
    s.once("error", next);
    s.listen(p, "127.0.0.1", () => { const got = s.address().port; s.close(() => console.log(got)); });
  };
  tryPort(want, () => tryPort(0, () => process.exit(1)));
' "${DRAW_PORT:-${DISPATCH_PORT:-}}")
log=$state/server.log
DRAW_PORT=$port nohup node "$home/server/index.js" --project-mode "$workspace" >"$log" 2>&1 &
pid=$!

for _ in $(seq 1 100); do
  # The server may have moved .dispatch to .atelier while starting: write where the state is now.
  ours "$port" "$pid" && { state=$(state_of); echo "$pid" > "$state/server.pid"; echo "$port" > "$state/server.port"; echo "http://127.0.0.1:$port/"; exit 0; }
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.1
done
echo "Server did not start; see $log" >&2
kill "$pid" 2>/dev/null || true
exit 1
