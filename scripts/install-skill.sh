#!/usr/bin/env bash
# Link the Dispatch skill into the user-level skill folders of Claude Code and Codex,
# so `dispatch` is available in every project.
set -euo pipefail

repo="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
skill="$repo/skills/dispatch"
codex_skills="${CODEX_HOME:-$HOME/.codex}/skills"

for dir in "$HOME/.claude/skills" "$codex_skills"; do
  mkdir -p "$dir"
  ln -sfn "$skill" "$dir/dispatch"
  echo "linked $dir/dispatch → $skill"
done
