# Atelier plugin

One folder for two hosts: Claude Code (`.claude-plugin/`) and Codex CLI (`.codex-plugin/`, marketplace in `.agents/plugins/`). Both load the same `skills/`. Install steps and the skill list are in the [main README](../README.md#-install-the-skills).

## Where the server comes from

Both hosts copy the plugin into a cache, so `scripts/start.sh` and `atelier-setup` look for the server in `DRAWING_HOME` (an Atelier checkout), else in the release `atelier-update` installed (`${DRAWING_INSTALL_BASE:-~/.dispatch/drawing}/current`).

## Calling the API

API skills go through `scripts/api.sh [-C <project>] METHOD /api/... [BODY]`. It finds the port (`<project>/.atelier/server.port`, else `DRAW_PORT`, else 4330), talks to 127.0.0.1 only, and adds `x-drawing: 1` (plus `x-drawing-session: $DRAWING_SESSION` when set) to writes. Codex's default sandbox blocks the network, loopback included: run these skills with network allowed.

## /atelier-agents

`/atelier-agents` (Claude Code) opens a pane beside the chat that follows Atelier's agent teams: 5-hour and weekly usage, each lead's status and model, its task board, its team and each issue's PR. It reads `GET /api/agents/summary` every few seconds (read only, metadata only) and keeps a one-line summary in the status line. When the server is down it shows offline.
