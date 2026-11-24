# Workspace folders: open a server folder and switch to it (E554, #721)

새 프로젝트 (and 폴더 열기 in the sidebar header menu) picks a folder on the PC that runs the server and opens it:
the running server switches to that folder as its workspace, and every open page reloads. The app is often opened
from another device (over the tailnet), so the browser's own file picker is no use: the dialog browses the server's
folders through the API.

This replaces the first version of E554 (PR #723), which linked a folder into the current workspace as a project
(see "Dropped" below).

## Model

- One server, one open workspace folder at a time. Each folder keeps its own data as before: documents in the folder,
  run records in `<folder>/.drawing/`, agent sessions in the git project that holds the folder
  (`<project>/.dispatch/` and session worktrees). Nothing is copied between folders.
- The server remembers the folders the user opened in `~/.dispatch/drawing.json` (E555,
  `docs/design/user-defaults.md`):

  ```json
  { "workspaces": [{ "path": "~/code/api", "name": "api" }], "lastWorkspace": "~/code/api" }
  ```

  Paths under HOME are stored as `~/…` (keeps the user name out of the file); other paths as given. Only a path and a
  folder name, nothing else. The server writes these two keys only through `UserDefaults.update`, so the file's key
  order, unknown keys and broken-file rules (no write, 409 `defaults_broken`) are the ones E555 defines.
- `npm start` with no folder opens `workspace`, else `lastWorkspace` (E555). After a switch `lastWorkspace` is the
  folder switched to.

## Switching (`server/app.js` `switchWorkspace`)

1. Refusals before anything changes (stable `code` next to an English, path-free `error`):
   - project mode → 403 `project_mode` (the routes are also closed there);
   - an agent session that is `running`, `starting` or `waiting` → 409 `sessions_running`;
   - another Atelier server holds the folder's workspace lock → 409 `in_use`;
   - a switch already running → 409 `switching`.
2. Open pages get an SSE `workspace-switch` event `{ workspace: <folder name> }`; then the event streams are closed.
3. Every module is closed and set up again with the new `ctx.workspaceDir` (modules never see the folder change under
   them). Requests that arrive meanwhile wait for the switch, except `/api/workspaces*` (those answer at once, so a
   second switch gets 409 `switching` instead of queueing).
4. The old folder's workspace lock is released and the new one gets the port.
5. If a module fails to start in the new folder, the server goes back to the previous folder (modules and lock) and
   answers 500 `open_failed`.
6. The folder is added to `workspaces` (with the previous one, if it was not listed yet) and `lastWorkspace` is set.
   If drawing.json cannot be written, the switch still stands; only "open last" is lost.

The web app reloads at `/` after its own switch and on a `workspace-switch` event from another tab.

## Which folders can be opened (`server/workspaces.js` `checkFolder`)

The path is resolved with `realpath` and must be an existing directory. Refused:

- relative path, NUL byte → 400 `bad_path`; a file → 400 `bad_path`; missing → 404 `not_found`; no permission →
  403 `no_permission`;
- the filesystem root → 400 `filesystem_root`;
- the home folder itself → 400 `home_folder` (far too large to watch, and it would get a `.drawing/` folder).

## API

All writes need `x-drawing: 1`. The POST/DELETE routes are closed in project mode.

- `GET /api/local-folders?path=<abs>`: sub-folder names of a folder on the server machine (home folder without
  `path`). Read-only: no files, nothing opened or read, hidden entries skipped, symlinks inside skipped without being
  followed (a symlink in the requested path is resolved with `realpath`), at most 2000 names (`truncated`).
  Errors carry no path.
- `GET /api/workspaces` → `{ current: { path, name }, folders: [{ path, name, current, missing }], switchable,
  error }`. Paths are absolute (the client sends them back). The folder the server started with is always listed.
  `missing` = the folder is gone from disk. `switchable` is false in project mode. `error: 'defaults_broken'` when
  drawing.json cannot be read.
- `POST /api/workspaces { path }`: add a picked folder to the list and switch to it (only saves the list when it is
  the open folder already).
- `POST /api/workspaces/open { path }`: switch to a listed folder (404 `not_registered` otherwise).
- `DELETE /api/workspaces?path=<abs>`: take a folder off the list; its files and `.drawing/` stay. The open folder
  cannot be removed (409 `current`).

## Web

The web UI below was removed in #778 (the sidebar shows one project's name instead); the API stays.

- `WorkspaceMenu` (sidebar header): the open folder's name is a menu button. The menu lists the remembered folders as
  radio items (the open one checked, a missing one disabled with 없음) and 폴더 열기… for the folder browser. The list
  is fetched each time the menu opens. Picking a folder switches and reloads; a refusal shows as the app error with
  Korean copy by `code`.
- `FolderPickerDialog` (새 프로젝트 and 폴더 열기…): up and home buttons, a breadcrumb (`nav` > `ol`, current folder
  `aria-current="location"`), sub-folders as buttons. 이 폴더 열기 is disabled at the root and at the home folder.
  빈 프로젝트 still makes a plain top-level folder in the open workspace through `POST /api/folder`.

## Dropped (first version, PR #723)

- `<workspace>/<name>/.project.json` `linkedPath` and the project 개요 tab's 연결한 폴더.
- `POST /api/workspace/local-project` and its `already_linked` / `inside_workspace` codes.
- The "documents stay in the current workspace, the linked folder is never written" model: an opened folder is now a
  workspace of its own and gets its own `.drawing/` folder.

## Limits

- Switching is refused while any agent session is busy; the user waits for it to end (or stops it) first.
- A switch drops every open page's state (it reloads at `/`), including unsaved edits that have not reached the
  server yet; the editor saves continuously, so this is a short window.
- One server per folder: a folder another Atelier server has open cannot be opened here (`in_use`).
- The folder list is per computer (`~/.dispatch/drawing.json`), not per workspace.

## CLAUDE.md (proposed, pending the user's approval)

The server rule in CLAUDE.md still describes the dropped linked-project model and does not name `drawing.json`.
Proposed wording for the sentences after "It writes only inside …":

> It writes only inside the workspace folder (run records under <workspace>/.drawing/), the git project that holds it
> (<project>/.dispatch/ and session worktrees), and ~/.dispatch/ (shared usage limits, and drawing.json: user
> defaults and the list of opened workspace folders, metadata only). To open another workspace folder it may list
> sub-folder names (never files, file contents or hidden entries, never following symlinks) of folders on the server
> machine; it never opens the filesystem root or the home folder itself as a workspace.

Not applied in this change.
