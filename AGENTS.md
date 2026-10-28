# Working on Dispatch

## Layout

- `server/` — Node HTTP + SSE server with zero npm dependencies. `sessions.js` spawns and parses the CLIs (Claude: `claude -p` stream-json with `--permission-prompt-tool stdio`; Codex: `codex exec --json`, one process per turn, resumed by thread id). `mcp.js` is the manager's MCP server and only talks to the HTTP API.
- `web/` — Vite + React + Tailwind v4 + shadcn/ui. Builds into `public/`, which the server serves.
- `skills/dispatch/` — the skill shipped to users, linked from `.claude/skills` and `.agents/skills`. API reference lives in `skills/dispatch/reference/api.md`; update it with any route change.
- `scripts/` — `setup.sh` (machine setup), `dev.sh` (server + Vite), `install-skill.sh`.

## Conventions

- Commit messages in English with conventional prefixes: `feat:`, `fix:`, `docs:`, `chore:`.
- After changing `web/`, run `npm run build` and commit `public/` with it: users run the skill without building.
- The server stays dependency-free; reach for Node built-ins.
- Persist metadata and usage totals only. Transcripts, tokens, API keys and account emails stay out of `.dispatch/state.json`, logs and API responses (the org forbids storing PII).
- Every non-GET route checks `x-dispatch: 1` (CSRF guard for a localhost server); keep new routes behind it.
- UI copy is Korean 해요체, sentence-level and plain. Pretendard for text, tabular numbers via the `num` class, monospace only for commands, ids, paths and diffs. Colour carries information only: role lanes (`--role-*`), status and limit levels (`--ok`, `--warn`, `--bad`, `--idle`). Every clickable element has a hover state and a pointer cursor.
- shadcn components go in `web/src/components/ui`; its CLI has generated `import { cn } from "cn"` before — imports must be `@/lib/utils`.

## Testing

- Point the server at a scratch git repo with one commit, not this repo: `npm run dev -- <scratch-repo>` or `DISPATCH_PORT=4399 skills/dispatch/scripts/start.sh <scratch-repo>`.
- Claude sessions spend the user's shared limit. Exercise flows with Codex models or `claude-haiku-5-5` at `effort: low` and one-line prompts.
- Check UI changes in a browser at 1440px and 390px, in light and dark.
