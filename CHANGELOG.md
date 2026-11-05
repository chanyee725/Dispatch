# Changelog

Every release is tagged `vX.Y.Z` and published on [GitHub Releases](https://github.com/chanyee725/Dispatch/releases). The plugin version in `.claude-plugin/plugin.json` matches the tag.

## 0.8.0 — 2026-11-05

### Added

- **Burn rate per session** (#9): every Claude session carries `burn` ($/h over the last 30 minutes) and `burnWarn` — a spike at 3× the team median, or a long-lived session on a large context, with "start a fresh lead" advice for a lead. The rate is recomputed every minute, so an idle session falls back to 0 without any activity of its own.
- **사용량 page**: a **지금 시간당** card, the top 10 sessions by cost with their rate and warning, and outlier days (2× the usual day) marked with the sessions that spent the most that day. Only numbers are stored per day (session id, name, role, cost).

## 0.7.0 — 2026-11-05

The first tagged release. It collects the 0.5.2 – 0.7.0 work, most of it found by running a real team for a day and reading where its time and tokens went.

### Added

- **설정 page** (sidebar, bottom left): per-project team settings saved in `.dispatch/state.json` — turns before a lead or another role continues in a fresh CLI session, teammates per lead, default model per role, sharing `node_modules` into worktrees, dropping a removed session's clean worktree, the reply-style guide, and the usage-limit guard. The `DISPATCH_ROTATE_TURNS*` and `DISPATCH_REPLY_STYLE` env vars now only seed the defaults.
- **Live activity on the task board**: under each task, what its owner is doing right now and for how long ("Remy · e2e 실행 · 4분째"), amber once a check has run 5 minutes or anything else 10.
- **"N분 지연"** on overdue tasks instead of a bare "지연".
- **끝난 세션 정리** button in the top bar: removes finished sessions in one click (`POST /api/sessions/clear-done`).
- **Short random session names** (Juno, Cal, Sam …, up to six letters) instead of "관리자 #93". Reports carry the role: `[Juno(구현자) 보고 · dispatch/impl-95]`.
- `stop_session` takes `remove: true`, and the lead is told to remove sessions it will not reuse. Removing a session also removes its worktree when nothing uncommitted is left (branches stay).
- New worktrees get the project's `node_modules` as hard links (about 0.4 s for 46k files, no extra disk; APFS clone on macOS).
- Every report a lead receives ends with its open board tasks (id, stage, owner, time left) so it updates the board in the same turn.
- Branch graph: merge and branch-off markers, relative times, roomier rows.

### Changed

- The lead defaults to **Sonnet 5.5**; it mostly does bookkeeping.
- Lead prompt: one task per implementer, merge as soon as review has no must-fix (should-fixes become proposals), batch messages, no polling, hand off after about ten merges.
- Teammates never end a turn with an "OK, waiting" acknowledgement — each final answer wakes the lead.
- Team rules: advance the integration branch with a real merge in the project folder, never by moving the ref.

### Fixed

- A lead that called `send_message` with `message` instead of `text` sent an empty message and got `ok`; the whole team then waited on each other. Tool calls with an empty required argument (also inside `create_sessions` items) are now refused with the accepted argument names, and `/message` rejects empty text.
- A removed session reappeared in the UI until reload (its process's late exit update re-added it).
- The board piled up stale and duplicate tasks: removing a lead now removes its tasks, a lead cannot close work by creating a new task as done, and a renamed duplicate is pointed out.
- A lead merged into its own `dispatch/lead-n` branch and reported done. The lead prompt now names the project folder and the merge command.
