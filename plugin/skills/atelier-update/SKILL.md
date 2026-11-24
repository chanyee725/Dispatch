---
name: atelier-update
description: Update Atelier on this machine to the latest GitHub release and restart its running servers. Use for "아틀리에 업데이트", "최신으로 맞춰", or when Atelier behaves differently on another machine.
---

# Atelier update

`<skill-dir>` is this file's folder.

## Steps

1. Run `<skill-dir>/scripts/update.sh`. It needs `gh` logged in, downloads the release bundle, unpacks it into `~/.dispatch/drawing/<ver>/`, points `~/.dispatch/drawing/current` at it, and restarts this project's running server on its own port. `--tag v1.2.3` picks a release; `--no-restart` skips the restart.
   Done when: it prints the unpacked version. If `gh` is missing or logged out, ask the user to run `! gh auth login`.
2. Report the version and which servers restarted (project and port).
   Done when: `GET /api/state` answers on each restarted port. If not, read `<project>/.dispatch/server.log` and report the error.
3. Skills and hooks update through Claude Code. Pass on the `/plugin ...` lines the script prints; the user runs them (`/plugin marketplace update atelier`, then `/plugin update atelier@atelier`).
   Done when: the user has the lines.

The bundle comes from `npm run pack` in the Atelier repo and is attached to a GitHub release by hand.
