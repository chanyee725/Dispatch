# Agent setup

Issue #766. How agent sessions working on this repo are set up, after the talk "Rethinking Claude Code Best Practices". Claude 5.5 models read intent and code well, so prompts keep only what the code can't tell, and the harness enforces what must hold.

## Prompts

- `CLAUDE.md`, the role prompts in `server/dispatch/roles.js` and `plugin/skills/*/SKILL.md` carry only non-obvious facts: hidden dependencies, commands, traps, policy.
- No emphasis words (IMPORTANT, NEVER, 반드시, 꼭). `test/dispatch/lanes.test.js` checks the role prompts.
- Implementer and designer prompts carry the web UI library rules; the full table is `docs/design/ui-libraries.md` (#764).
- The docs role and the lead prompt carry the document writing style (next action first, numbered steps, done/left lists); the guide is `docs/design/writing-style.md` (#737).
- Nothing a tool schema or the code already says (mode lists, model defaults, file layout).
- Rerun the audit (`/doctor prompt-audit`) when the default model changes.

## Harness (`.claude/settings.json`)

| Piece | What it does |
|---|---|
| `permissions.deny` | Reads of `.env`, `.env.*`, `secrets/`, `*.pem`, `*.key`, `~/.ssh`, `~/.aws`, `~/.gnupg`, gh and Codex credentials. Force-push and pushes to `main`. |
| `sandbox` | Bash runs in the sandbox: writes to the worktree and tmp, no reads of the secret folders, network to localhost, GitHub and the npm registry. `git` and `gh` run outside it (worktree commits write to the main repo's `.git`; gh reads its own login). On Linux it needs `bwrap` and `socat`; without them Claude Code skips the sandbox with a warning. |
| PostToolUse hook | `.claude/hooks/check-edit.mjs`: `node --check` for JS, `tsc -p shared|web --noEmit` for TS there, `JSON.parse` for JSON. |
| Stop hook | `.claude/hooks/test-changed.mjs`: runs only the tests that cover files changed since the merge-base with `origin/develop` (no e2e). A passing diff is cached; after 3 blocks in a row the agent may stop and report. |

Hooks fail with exit 2, which feeds the error back to the agent. Exit 1 does not block. `test/claude-hooks.test.js` checks both against a scratch repo.

`git push` and `gh pr create` stay allowed (no `ask`): the team flow pushes branches and opens PRs on its own, and an ask would stall a headless session.

## Review tiers

| Change | Reviewers |
|---|---|
| Docs or copy only | 0 |
| Normal change (one feature) | 1 |
| Risky (auth, data, delete, structure) | 2 |

The reviewer is always a fresh session, never the author. A reviewer reviews after the last commit.

## Brief checklist

A lead's brief to a teammate carries:

1. Done when: one line (e.g. `auth.test` passes, the toast shows top right).
2. Small pieces: steps that can each be tested alone.
3. Report: branch, last commit, real run output (the test summary line), what's left.

## Role models (suggestion)

The talk splits coordinators from workers:

- Coordinator (splits work, checks results): Fable 5.2.
- Workers (write code): Opus 5.5.

This is a suggestion for the #748 mode-profile defaults, not a rule. Profiles and per-session `model` choices still win.
