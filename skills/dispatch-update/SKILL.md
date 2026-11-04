---
name: dispatch-update
description: Update Dispatch on this machine to the latest commit — pull the Dispatch clone, relink its skills (dispatch, dispatch-team, …) for Claude Code and Codex, and restart every running Dispatch server so all projects use the new code. Use when the user says "디스패치 업데이트", "dispatch update", "최신으로 맞춰", or Dispatch behaves differently on another machine than expected.
---

# Dispatch update

`<skill-dir>` is the directory containing this file; its script resolves symlinks back to the Dispatch clone.

1. Run `<skill-dir>/scripts/update.sh`.
   - It refuses to pull when the clone has uncommitted changes. Show the user the listed files and ask whether to commit or stash them; never discard them yourself.
   - `--no-restart` skips restarting servers (use it if the user is in the middle of a team run and wants to restart later). `--build` rebuilds the web UI from `web/` when `public/` is not committed on that branch.
2. Report the old → new commit, the commit list it printed, and which servers were restarted (project and port). Restarted servers resume any turn that was cut off.
3. If a server did not come back, read `<project>/.dispatch/server.log` and report the error.
