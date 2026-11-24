# Dispatch plugin

One folder for two hosts: Claude Code (`.claude-plugin/`) and Codex CLI (`.codex-plugin/`, marketplace in `.agents/plugins/`). Both load the same `skills/`. Installed from GitHub, the Claude Code plugin `dispatch` is the repository root (`../.claude-plugin/plugin.json` points at `plugin/skills/` and `plugin/hooks/hooks.json`; the hook commands run `../hooks/*.mjs`, which load the hooks here), so the server comes with it. This folder on its own is the plugin of a release bundle and of Codex. Install steps and the skill list are in the [main README](../README.md#-install-the-skills).

## Where the server comes from

Both hosts copy the plugin into a cache, so `scripts/start.sh` and the `dispatch` skill look for the server in `DRAWING_HOME` (a Dispatch checkout), else two levels up (the repository root, as the GitHub install has it; the first `setup.sh --install` there runs `npm ci` and `npm run build`), else in the release `dispatch-update` installed (`${DRAWING_INSTALL_BASE:-~/.dispatch/drawing}/current`).

## Calling the API

API skills go through `scripts/api.sh [-C <project>] METHOD /api/... [BODY]`. It finds the port (`<project>/.dispatch/server.port`, or the Atelier-era `.atelier/server.port`, else `DISPATCH_PORT`, else `DRAW_PORT`, else 4330), talks to 127.0.0.1 only, and adds `x-drawing: 1` (plus `x-drawing-session: $DRAWING_SESSION` when set) to writes. Codex's default sandbox blocks the network, loopback included: run these skills with network allowed.

## /dispatch-agents

`/dispatch-agents` (Claude Code) opens a pane beside the chat that follows Dispatch's agent teams: 5-hour and weekly usage, each lead's status and model, its task board, its team and each issue's PR. It reads `GET /api/agents/summary` every few seconds (read only, metadata only) and keeps a one-line summary in the status line. When the server is down it shows offline.
