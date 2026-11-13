# Changelog

Every release is tagged `vX.Y.Z` and published on [GitHub Releases](https://github.com/chanyee725/Dispatch/releases). The plugin version in `.claude-plugin/plugin.json` matches the tag.

## 0.16.0 — 2026-11-13

### Added

- **modern-web-guidance for web work** (#35). When the `modern-web-guidance` Claude Code plugin (`modern-web-guidance@googlechrome`) is installed, implementer, designer and reviewer sessions get a `[Modern Web Guidance]` prompt section: for HTML, CSS and client-side JS, run the `modern-web-guidance:modern-web-guidance` skill (Codex and Gemini sessions: `npx -y modern-web-guidance@latest`), search → retrieve → check the code against the guide, and end the report or PR with a `### Modern Web Guidance` section. The lead is told to put that in web briefs and to ask for the section before merging. Project rules (CLAUDE.md / AGENTS.md) win over the guides; search queries stay generic, with no project, file or people names. Server, test and build work doesn't use it, and tester and docs sessions get nothing. Codex and Gemini sessions only try `npx` with network access and skip it at once on failure (no retry, approval request or sandbox loosening), noting "가이드 조회 불가(네트워크 없음)" in the section, which the lead counts as filled. Without the plugin nothing is added. The team rules (`skills/dispatch-team/reference/rules.md`) say the same.

### Changed

- The `installed_plugins.json` lookup used for the `i-have-adhd` reply style moved to `server/plugins.js` (`pluginDir`) and is shared by both features.

## 0.15.2 — 2026-11-13

### Fixed

- **Usage limits: a second update in the same millisecond is no longer dropped** (#43). The merge used a strict `>` on the timestamp, so two `setClaude`/`setGemini` calls with the same timestamp kept the first value. A tie now goes to the incoming value, and a write keeps its own value over the file's on a tie. An older value still never overwrites a newer one.

## 0.15.1 — 2026-11-13

### Fixed

- **main-delegates hook covers Bash and repeats** (#33). It now also runs on `Bash`, and speaks only when the command looks like a file write: a `>`/`>>` redirect (not `2>&1`, `>/dev/null` and the like), `sed -i`, `perl -i`, `tee`, `cp`/`mv`/`rm`/`mkdir`/`touch`…, `find -delete`, a mutating `git` subcommand (`add`, `commit`, `apply`, `checkout`, `reset`, `stash`…), or a python/node one-liner that writes a file. Read-only commands (`ls`, `cat`, `grep`, `git status/log/diff`…) stay silent. Instead of once per session it repeats the note when 30 minutes have passed since the last one. The marker's mtime holds that time; it stores no command text.

## 0.15.0 — 2026-11-13

### Added

- **The main session delegates** (#31). The `dispatch` and `dispatch-team` skills now say it: the Claude Code session that talks to the user does not implement, fix or investigate code itself; it hands every task to a Dispatch lead, writes briefs, verifies before merge, comments on PRs and merges. A different stream (another area or repo, or a lead whose context is heavy or shows `longRun`) gets a new lead, and small review should-fixes go back to the owning lead. The team rules tell leads the same about should-fixes.
- **Plugin hook** `hooks/main-delegates.mjs` (PreToolUse on `Edit|Write|MultiEdit|NotebookEdit`): outside Dispatch sessions, when the edited file sits in a project with a live Dispatch server (`~/.dispatch/servers/*.json`, pid check only, no network), it adds that rule to the model's context once per session. It never blocks the edit, does nothing inside Dispatch sessions, and stays silent on any error.

## 0.14.0 — 2026-11-13

### Added

- **Session length guard** (설정 → 오래 쓴 세션 교체 기준, default 15M tokens, 0 turns it off; #29). Turn rotation keeps each call's context small, but a session kept for hundreds of turns still re-reads its work on every call: a lead in another project processed 29M tokens over 189 turns. Past the budget a session gets `longRun` and a 확인 필요 warning, and Dispatch says once who should act: a teammate's lead is told to stop it and give the rest to a fresh teammate; a lead is told to write a handover and ask for a fresh lead (mid-turn when it is running, otherwise with its next message, so an idle lead is not woken for it). The lead's `list_sessions` shows `mtok` and `long`.
- The lead's rules say so too: replace a long teammate instead of adding work to it, and hand over when told.
- **Plugin hook** `hooks/long-session.mjs` (PostToolUse): inside a Dispatch session that is over the guard, it adds the same note to the model's context once, as a backstop. Outside Dispatch sessions it does nothing and sends no request. Claude sessions get `DISPATCH_URL` and `DISPATCH_SESSION` in their environment for it.

## 0.13.0 — 2026-11-12

### Added

- **Context guard** (설정 → 컨텍스트 넘김 기준, default 70 %, 0 turns it off). Turn-count rotation only runs between turns, so a teammate kept in one long turn by its lead's mid-turn follow-ups filled 87 % of its window with no warning and 0 turns counted. Now, once a session's context crosses the guard: a running Claude session is told once, mid-turn, to commit, summarise what is done and left, and end the turn; the session gets `ctxHigh` and a 확인 필요 warning; and its next message starts a fresh CLI session with the usual handoff note, whatever its turn count. The lead's `list_sessions` / `get_session` show `ctxPct`.

## 0.12.0 — 2026-11-12

### Added

- Top bar: **Fable** shows its own weekly limit next to Claude's 5-hour and weekly bars. The CLI reports it as `seven_day_overage_included` on Fable turns only, so the bar shows "—" until the first Fable turn and then keeps its last value between them. It is saved with the other Claude numbers in `~/.dispatch/limits.json`, and 확인 필요 shows a "Fable 주간 한도" row at 75 % or more (red at the weekly guard). `GET /api/limits` gains `fable: { windows } | null`.

## 0.11.0 — 2026-11-05

### Added

- 세션 board: cards are ordered by urgency (실패 > 사람 기다림 > 멈춤 > 작업 중 > 쉼 > 완료, longest in its state first, then start time and id, so they move only when a state changes), every card shows "N분째" in its current state, and finished sessions hide behind a **완료 N개 보기** toggle (#6).
- Alerts (#10): the tab title carries the 확인 필요 count (`(2) Dispatch`), and 설정 → 알림 turns on browser notifications for four cases only — waiting on a person for 3 minutes, a stuck flag, an error exit, a Claude limit at 90 % — once per session and reason until it clears. Notifications carry the session name and a one-line reason; only the on/off choice is stored.
- **카드 ⇄ 타임라인** toggle on the 세션 board (#10): one row per session in role order over the last two hours, stretches coloured and shaped by state (사람 기다림 orange, stuck hatched, failures as red ticks); a row opens the session sheet. The server keeps each session's state changes (time and state code only, last 200) and serves them at `GET /api/timeline`.

## 0.10.1 — 2026-11-05

### Fixed

- 확인 필요 strip: a task whose board stage disagrees with its owner (`stage-mismatch`) was hidden whenever the target session had any row — waiting, silent, or the lead it falls back to when no owner session matches (#18). It now folds only into the found owner's repeat-fail row and shows otherwise.

## 0.10.0 — 2026-11-05

### Added

- **모니터링 theme** next to system / light / dark (sidebar, bottom left): dark-first, flat panels with thin borders, tight radius, and a status palette (`--ok/--warn/--bad/--idle`) kept apart from the role lane colours. Reusable `Panel`, `Metric` and `StateMark` components for dense screens.
- **상시 화면 (TV)**: top-bar button or `#tv` in the address bar. Always dark, a big state grid under the 확인 필요 strip, no auto-scroll, state shown as shape + colour + label. `Esc` closes it.
- Session sheet: a run of two or more tool calls folds into one line ("도구 호출 3개 · Bash 2, Read"). The raw input and output show only when you open it.

### Changed

- The always-on grid is ordered by state, then start time and id, so tiles move only when a state changes.

## 0.9.0 — 2026-11-05

### Added

- **확인 필요 strip** at the top of 세션, in place of the five KPI cards (#3): sessions waiting on a person, stuck or failed, tasks past their estimate (worded by the server's over-eta flag once it fires), tasks whose board stage disagrees with what the owner is doing (`stage-mismatch`, folded into the owner's row when that session is already flagged), tasks whose merge check failed, and Claude limits at 75 % or more — urgent from the usage-limit guard threshold in 설정, and gone once the window has reset. Each row shows shape + label, the reason, how long, and opens the session (limit rows open 사용량). The KPIs shrink to one summary line.

### Changed

- **Node.js 22.6+ is required** (was 20+, now end-of-life). `npm test` loads TypeScript helpers from `web/` directly; `scripts/setup.sh` checks the new minimum.

## 0.8.0 — 2026-11-05

### Added

- **Burn rate per session** (#9): every Claude session carries `burn` ($/h over the last 30 minutes) and `burnWarn` — a spike at 3× the team median, or a long-lived session on a large context, with "start a fresh lead" advice for a lead. The rate is recomputed every minute, so an idle session falls back to 0 without any activity of its own.
- **사용량 page**: a **지금 시간당** card, the top 10 sessions by cost with their rate and warning, and outlier days (2× the usual day) marked with the sessions that spent the most that day. Only numbers are stored per day (session id, name, role, cost).
- **Stuck detection per session and per task** (#5): a session is flagged when the same check command (test, build, lint, typecheck, e2e) fails 3 times in a row or a running turn is silent for 10 minutes; a board task when its stage runs past 1.5× its eta or the board says 계획/구현 while the owner is looping on tests. One event per flag, not per failure. Thresholds are the `stuckFails`, `stuckSilentMinutes`, `stuckEtaRatio` and `stuckMismatchMinutes` team settings (`0` = off). Only a hash of the command and the counts are stored.

### Fixed

- A check piped into a filter (`npm test 2>&1 | tail -20`) exited with the filter's 0 and counted as a pass, wiping the failure count. Commands whose exit code hides the result (a pipe without `pipefail`, or `||`) are now left uncounted.
- The same check run in another directory (`cd web && npm test` vs `cd server && npm test`) shared one count; `cd` now stays in the command hash.
- A repeat-fail flag stayed up after a different command of the same kind passed; it now clears.
- `stuckMismatchMinutes: 0` left the "board says 구현 but tests keep failing" flag on; it now turns off both mismatch checks.

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
