#!/usr/bin/env bash
# Update Drawing on this machine from its latest GitHub release bundle (drawing-<ver>.tgz).
#
#   update.sh [project]    download the latest release, unpack it, restart that project's server
#   update.sh --tag v1.2.3 use that release instead of the latest
#   update.sh --no-restart unpack only
#
# Only the given project (default: the git project of the current folder) is restarted, found by
# <project>/.atelier/server.pid and server.port (.dispatch before its one-time move). Other projects: run restart.sh in each of them.
#
# DRAWING_INSTALL_BASE overrides ~/.dispatch/drawing.
# Uses gh (already logged in) for the download. Unpacks into ~/.dispatch/drawing/<ver>/ and points
# ~/.dispatch/drawing/current at it. Older versions are kept; delete them by hand when you like.
set -euo pipefail

repo="chanyee725/Drawing"
# DRAWING_INSTALL_BASE = where releases are unpacked. (DRAWING_HOME, read by start.sh, is a Drawing
# checkout; it is set below for the restart only.)
base="${DRAWING_INSTALL_BASE:-$HOME/.dispatch/drawing}"
# Older versions used DRAWING_HOME as the install dir. When it still holds one (a `current` link) and
# nothing says otherwise, tell the user where the new version goes (Korean message, on stderr).
if [ -z "${DRAWING_INSTALL_BASE:-}" ] && [ -n "${DRAWING_HOME:-}" ] && [ -L "$DRAWING_HOME/current" ] \
   && [ "$DRAWING_HOME" != "$base" ]; then
  echo "알림: DRAWING_HOME($DRAWING_HOME)에 설치돼 있어요. 새 버전은 $base 에 풀려요." >&2
  echo "      계속 그 폴더를 쓰려면 DRAWING_INSTALL_BASE=$DRAWING_HOME 으로 실행하세요." >&2
fi
tag=""
restart=true
project_arg=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) tag="${2:?--tag needs a value}"; shift 2 ;;
    --no-restart) restart=false; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1 (see --help)" >&2; exit 1 ;;
    *) project_arg="$1"; shift ;;
  esac
done

command -v gh >/dev/null || { echo "gh is not installed (https://cli.github.com)" >&2; exit 1; }
command -v node >/dev/null || { echo "node is not installed" >&2; exit 1; }

# shellcheck source=../../../scripts/server-check.sh
source "$(dirname "$(dirname "$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")")")/scripts/server-check.sh"

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }

step "1. Find the release"
[ -n "$tag" ] || tag="$(gh release view --repo "$repo" --json tagName --jq .tagName)"
ok "$repo $tag"

step "2. Download"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/dl" "$work/x"
gh release download "$tag" --repo "$repo" --pattern 'drawing-*.tgz' --dir "$work/dl"
files=("$work"/dl/drawing-*.tgz)
[ ${#files[@]} -eq 1 ] && [ -f "${files[0]}" ] || { echo "release $tag has no single drawing-<ver>.tgz asset" >&2; exit 1; }
bundle="${files[0]}"
ok "$(basename "$bundle")"

step "3. Unpack"
# The download is untrusted data: refuse absolute paths and '..' before extracting, into an empty dir.
if tar -tzf "$bundle" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "bundle has unsafe paths; not unpacking" >&2
  exit 1
fi
tar -xzf "$bundle" -C "$work/x"
dirs=("$work"/x/drawing-*)
[ ${#dirs[@]} -eq 1 ] && [ -f "${dirs[0]}/server/index.js" ] && [ -f "${dirs[0]}/plugin/.claude-plugin/plugin.json" ] \
  || { echo "bundle layout is not drawing-<ver>/{server,plugin}" >&2; exit 1; }
ver="$(basename "${dirs[0]}")"
# Every check happens before anything on disk is replaced.
if $restart; then
  [ -f "${dirs[0]}/plugin/scripts/start.sh" ] \
    || { echo "bundle has no plugin/scripts/start.sh; nothing was changed (use --no-restart to unpack only)" >&2; exit 1; }
  project="$(git -C "${project_arg:-$PWD}" rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$project" ] || project="$(cd "${project_arg:-$PWD}" 2>/dev/null && pwd || true)"
fi
mkdir -p "$base"
# Unpack next to the target, then rename: a running copy of the same version is never deleted.
staged="$base/.$ver.new.$$"
rm -rf "$staged"
mv "${dirs[0]}" "$staged"
old=""
if [ -e "$base/$ver" ]; then old="$base/.$ver.old.$$"; mv "$base/$ver" "$old"; fi
mv "$staged" "$base/$ver"
ln -sfn "$base/$ver" "$base/current"
[ -z "$old" ] || rm -rf "$old"
ok "$base/$ver (current)"

if $restart; then
  step "4. Restart this project's server"
  pid_file="$(state_dir "$project")/server.pid"
  port_file="$(state_dir "$project")/server.port"
  pid=""; port=""
  [ ! -f "$pid_file" ] || pid="$(cat "$pid_file")"
  [ ! -f "$port_file" ] || port="$(cat "$port_file")"
  if is_our_project_server "$pid" "$project"; then
    if [[ "$port" =~ ^[0-9]+$ ]]; then
      DRAWING_HOME="$base/$ver" DISPATCH_PORT="$port" DRAW_PORT="$port" "$base/current/plugin/skills/atelier-setup/scripts/restart.sh" "$project" | sed 's/^/    /'
    else
      DRAWING_HOME="$base/$ver" "$base/current/plugin/skills/atelier-setup/scripts/restart.sh" "$project" | sed 's/^/    /'
    fi
    ok "restarted the server of $project; cut-off turns resume on their own"
  else
    ok "no running server for $project"
  fi
  echo "  Other projects keep running the old code: run restart.sh in each of them:"
  echo "    $base/current/plugin/skills/atelier-setup/scripts/restart.sh <project>"
fi

step "Done"
echo "Plugin folder: $base/current/plugin"
echo "If the plugin is not installed from this folder yet, in Claude Code run:"
echo "  /plugin marketplace add $base/current/plugin"
echo "  /plugin install atelier@atelier"
echo "(already installed: /plugin marketplace update atelier, then /plugin update atelier@atelier)"
