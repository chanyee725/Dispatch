# Dispatch 통합 설계 1: 구조와 이전

상태: 설계안 (코드 변경 없음). 기준 커밋: Atelier `develop` 0394637, Dispatch 플러그인 0.14.0.
배경: 이슈 #87. 파이프라인을 문서+다이어그램으로 먼저 만들고, 사람이 고친 뒤 '시작'하면, 실행 중 상태가 같은 파일 위에 덧입혀지는 흐름.
범위: 서버·프로세스 구조, 옮길 모듈, 플러그인, 이전 순서. 파이프라인 파일 형식과 오버레이 UI는 다른 설계 문서 몫이에요(여기선 접점만 적어요).

## 0. 추천 (먼저)

1. **한 프로세스로 합쳐요.** Dispatch 서버 코드를 Atelier의 기능 모듈 `server/dispatch/`로 **옮겨요**(연결만 하지 않아요). Atelier 서버가 세션 실행·worktree·MCP·한도·작업 보드를 직접 가져요.
2. **Dispatch 코드는 거의 그대로 옮기고, `server/index.js`만 쪼개요.** Hub(`sessions.js`)·git·한도·상태 계산은 의존성 없는 Node 코드라 Atelier 서버 규칙(의존성 없음, 127.0.0.1)과 이미 맞아요.
3. **API 경로와 `x-dispatch: 1` 헤더는 바꾸지 않아요.** 그래야 `mcp.js`·스킬·훅이 포트만 바꿔서 그대로 돌아요. 겹치는 경로는 `/api/events` 하나뿐이라 SSE 허브를 합쳐요.
4. **작업 공간 ≠ 프로젝트 루트.** Atelier 작업 공간은 프로젝트 저장소 안의 하위 폴더(예: `pipelines/`)로 두고, Dispatch 루트는 그 폴더의 git 최상위로 정해요. 저장소 전체를 재귀 감시하면 worktree·`node_modules`까지 감시하게 되거든요.
5. **다른 프로젝트용으로는 `dispatch` 플러그인 이름을 유지**하고, 그 안의 서버를 Atelier로 바꿔요. 스킬 3개·훅·`mcp.js`·start/stop 스크립트가 플러그인에 남아요.
6. **이전은 6단계**, 각 단계가 혼자 병합 가능해요. Atelier 개발 자체는 기능이 같아질 때(3단계 끝)까지 **독립 Dispatch로 계속** 돌려요.
7. **0단계에서 `CLAUDE.md` 규칙을 먼저 고쳐야 해요.** 지금 규칙은 transcript 저장, 작업 공간 밖 쓰기를 금지해서 Dispatch를 그대로 들이면 규칙 위반이에요(§5).

## 1. 지금 구조 (설계에 영향을 주는 사실)

### Atelier

- 진입점은 얇아요: 인자 하나(작업 공간 폴더) 파싱 → `createApp` → 4330 포트 listen (`server/index.js:18-39`, `server/cli.js:4-13`).
- 기능 모듈 계약이 이미 있어요: `setup(ctx) -> { routes, close }`, `ctx = { workspaceDir, hub, modules }`, 앞 모듈 결과를 뒤 모듈이 씀 (`server/app.js:11-35`). 모듈 목록은 한 줄씩 추가 (`server/modules.js:3-5`).
- 라우트는 `{ method, path: string|RegExp, handler(req,res,ctx,match,url) }` (`server/app.js:14-16`, `:45-49`).
- SSE 허브는 `broadcast(event, data)`만 있고, 접속 시 스냅샷을 보내는 훅은 없어요 (`server/events.js:3-31`). 웹은 `EventSource('/api/events')` 하나 (`web/src/App.tsx:353`).
- Host 헤더 검사로 DNS rebinding을 막아요 (`server/app.js:39-41`, `:73-76`). 쓰기 요청은 `application/json`만 받아요 (`server/workspace/index.js:8`) — 이게 사실상 CSRF 방어예요.
- 경로는 숨김 이름(`.`으로 시작)을 거부해요 (`server/workspace/paths.js:20`). 그래서 `.dispatch/`는 Atelier 파일 트리에 절대 안 보여요. 좋은 점이에요.
- 작업 공간 전체를 `recursive: true`로 감시해요 (`server/workspace/store.js:805-806`).
- `public/`은 git에 없어요(`.gitignore`). 실행 전에 `npm run build`가 필요해요.
- 서버 코드는 `node:` 내장 모듈만 써요(서버 의존성 0). 웹은 React 19 + Tailwind 4 (`package.json`).

### Dispatch

- 서버 진입점 `server/index.js`(333줄)가 **모듈이 아니라 스크립트**예요: 최상위에서 루트 결정·스토어 로드·Hub 생성 (`index.js:22-31`), 자체 SSE (`:56-62`, `:293-298`), 자체 정적 서빙 (`:163-189`), 라우트 표 (`:209-287`), 타이머 3개 (`:312-317`), listen (`:319`), 종료 처리 (`:326-333`).
- 실제 엔진은 `Hub` (`sessions.js:73`, 1137줄): 세션 생성 (`:421`), Claude/Codex/Gemini 프로세스 실행 (`:902`, `:1002`, `:1065`), 작업 보드 (`:316`), 한도 가드·티켓 (`:409`, `:720-797`), 팀 감시 (`:806`), 리드 보고 (`:831-846`).
- Hub는 생성 시 `port`를 받아요 (`sessions.js:74`). MCP 서버와 훅에 `DISPATCH_URL=http://127.0.0.1:<port>`를 넘기려고요 (`sessions.js:855-858`, `:910-914`).
- MCP 서버 `mcp.js`는 별도 stdio 프로세스이고 HTTP API만 불러요 (`mcp.js:1-19`). 리드용 도구 7개, 팀원용 `message_lead` 1개 (`mcp.js:32-147`).
- 쓰기 요청은 `x-dispatch: 1` 헤더가 있어야 해요 (`index.js:300-301`).
- 프로젝트 루트는 git 최상위 (`git.js:10`). worktree는 `<root>/.dispatch/wt/<slug>`, 브랜치 `dispatch/<slug>` (`git.js:35-58`). `node_modules`를 하드링크로 복사해요 (`git.js:60-72`).
- 저장: `<root>/.dispatch/state.json` (`store.js:8`), transcript `<root>/.dispatch/transcripts/<id>.jsonl` (`sessions.js:87-89`).
- 홈 폴더에도 써요: `~/.dispatch/servers/<port>.json` 서버 등록 (`index.js:88-103`), `~/.dispatch/prefs.json` 테마 (`index.js:132-147`), `~/.dispatch/limits.json` 계정 한도 공유 (`limits.js:78`, `:108`). `~/.codex/sessions`를 읽어요 (`limits.js:10`). Atelier에서는 OpenAI를 연결했을 때만 읽고(server/dispatch/hub.js:303), 길이 가드 훅의 표식 파일은 시스템 임시 폴더 대신 `~/.dispatch/hooks/`에 둬요(plugin/hooks/long-session.mjs:13). `state.json`에는 메타데이터만 남겨요: 세션 `prompt`·`error`, 작업 `note`, 티켓 `items[].note`는 메모리에만 두고, 재시작 뒤 역할 프롬프트는 역할에서 다시 읽어요(server/dispatch/dispatch-store.js:8-32, hub.js:885-886).
- 웹은 React + Tailwind 4 + shadcn, `web/src` 40개 tsx(약 370KB). 상태 계산 일부는 `web/src/lib/`(attention, order, steps, turn 등)에 있어요.
- 플러그인: `.claude-plugin/plugin.json`, 스킬 `dispatch`·`dispatch-team`·`dispatch-update`, 훅 `hooks/long-session.mjs`(PostToolUse, `hooks/hooks.json`).

## 2. 한 프로세스 vs 둘

| 기준 | 한 프로세스 (Atelier 안에 Dispatch 모듈) | 두 프로세스 (Atelier ↔ Dispatch 연결) |
|---|---|---|
| 파일 위 상태 덧입히기 | 같은 Hub 이벤트를 같은 SSE로 바로 받음 | Atelier가 Dispatch SSE를 구독·중계해야 함 = 서버 간 HTTP 요청. "외부 요청 없음" 규칙(`CLAUDE.md:11`)의 예외가 필요 |
| '시작' 버튼 | 파일을 읽은 그 서버가 세션을 바로 만듦 | 파일 내용을 Dispatch로 넘기는 API가 새로 필요 |
| 포트·실행 | 하나 (4330) | 둘, 짝이 맞는지 확인 필요. 이미 포트 충돌 사고가 있었음(메모리: 다른 세션 서버와 포트 공유) |
| 재시작 영향 | Atelier 수정 배포 = 실행 중 세션 끊김. 단 Hub가 `interrupted`로 이어감 (`sessions.js:94-98`, `index.js:319`) | 그림 쪽만 재시작 가능 |
| 장애 격리 | Hub 예외가 그림 편집까지 멈출 수 있음 | 서로 영향 없음 |
| 코드 이동량 | `index.js` 분해 + 웹 이식 | 거의 없음, 대신 연결 코드와 두 저장소 버전 맞추기 |
| 장기 유지 | 저장소 하나, 테스트 하나 | 두 저장소·두 릴리스·API 계약 버전 관리 |

**추천: 한 프로세스.** 이 기능의 핵심이 "같은 파일 위에 실행 상태"라서, 이벤트를 한 곳에서 내는 게 가장 단순해요. 재시작 문제는 Hub의 기존 이어하기로 덮이고, 장애 격리는 §4의 경계(try/catch, 타이머 분리)로 줄여요. 두 프로세스 연결은 1단계 동안 **비교용으로도 만들지 않아요**(중계 코드가 결국 버려져요).

## 3. 목표 구조

```
server/
  index.js            # args: <workspace-dir>, workspace may sit inside a git project
  app.js              # + hub.onAttach(fn) for per-client snapshot, + optional per-module guard
  modules.js          # [workspace, dispatch]
  workspace/          # unchanged
  dispatch/
    index.js          # setup(ctx): createDispatch(), routes adapter, timers, close
    routes.js         # was Dispatch server/index.js:209-287, same paths
    hub.js            # was sessions.js (class Hub)
    mcp.js  git.js  state.js  burn.js  limits.js  tasks.js
    roles.js  models.js  settings.js  auth.js  style.js
    dispatch-store.js # was store.js (.dispatch/state.json)
    registry.js       # was index.js:88-160 (servers, prefs, usageAll)
web/src/dispatch/     # sessions board, session sheet, task board, limits, settings, run overlay
plugin/               # what other projects install (§6)
```

### 3.1 모듈 연결

- `server/dispatch/index.js`의 `setup(ctx)`:
  - 프로젝트 루트 = `projectRoot(ctx.workspaceDir)` (`git.js:10`). git이 아니면 Dispatch 기능을 끄고 `{}`를 돌려줘요(그림 도구만 동작).
  - Hub 생성. `port`는 listen 전이라 모르므로 **숫자 대신 getter**를 넘겨요(`sessions.js:80` 사용처 `:855-858`, `:914`만 고치면 돼요).
  - `hub.on(ev)` → `ctx.hub.broadcast(ev, d)` (`index.js:61`과 같은 목록).
  - 타이머 3개(`index.js:312-317`)와 `resumeInterrupted`·`register`(`:319-320`)는 서버 `listening` 이후 실행. `close()`에서 타이머 해제·`hub.stopAll()`·`unregister`·`store.flush` (`:326-331`).
- 라우트 어댑터: Dispatch 표 `[method, re, fn(params, body)]`를 Atelier 라우트로 감싸요. 쓰기 요청은 어댑터에서 `x-dispatch: 1`을 확인하고, 에러는 `{ error }` + `e.status || 400` (`index.js:300-309`)로 그대로 보내요. 경로는 안 바꿔요.
- SSE: Atelier 허브에 `onAttach(fn)`을 추가해서 접속 때 `snapshot` 이벤트를 한 번 보내요(`index.js:295`과 같은 동작). 이벤트 이름이 겹치지 않아요(`workspace` vs `session`·`message`·`limits`·`tasks`·`tickets`·`removed`·`settings`·`providers`·`snapshot`).
- 경로 겹침 검사: Atelier `/api/info, tree, file, folder, trash, history, move` (`server/workspace/index.js:74-89`, `server/app.js:25`) vs Dispatch `/api/state, usage, prefs, projects, settings, sessions, timeline, tasks, branches, providers, tickets` — 겹치는 건 `/api/events`뿐이에요. 테스트로 고정해요.

### 3.2 작업 공간과 프로젝트

- 실행: `npm start -- <project>/pipelines` → 작업 공간 = `pipelines/`, 프로젝트 = git 최상위.
- Atelier가 쓰는 곳: `pipelines/**`, `pipelines/.drawing/`. Dispatch가 쓰는 곳: `<project>/.dispatch/`, worktree. 둘 다 프로젝트 안이에요.
- 작업 공간을 저장소 최상위로 잡으면 재귀 감시가 `.dispatch/wt/*/node_modules`(하드링크 복사본, `git.js:60-72`)까지 훑어요. 감시 필터는 숨김 폴더만 걸러도 대부분 해결되지만, 그 전까지는 **하위 폴더를 기본값**으로 안내해요.

### 3.3 파이프라인과의 접점 (다른 문서에서 정할 것)

- 실행 상태는 `.dpx.json`에 쓰지 않고, Hub가 가진 세션·작업 상태를 SSE로 받아 **클라이언트에서 덧입혀요**. 파일은 리비전 검사로 오래된 쓰기를 거부하니까(`docs/workspace-api.md` "Revisions and outside edits"), 실행 상태가 파일을 계속 고치면 사람 편집과 부딪혀요.
- 필요한 연결 정보만 사이드카에 둬요: `.drawing/runs/<file id>.json` = `{ runId, nodeId → taskId/sessionId }`. 작업 보드 `set_task`(`sessions.js:316`)에 `node` 같은 키 하나를 추가하는 정도가 Hub 쪽 변경의 전부가 되도록 맞춰요.

## 4. 옮길 모듈 목록

| Dispatch 파일 | 어디로 | 바꿀 것 |
|---|---|---|
| `server/sessions.js` | `server/dispatch/hub.js` | port getter. 그 외 그대로 |
| `server/mcp.js` | `server/dispatch/mcp.js` | 없음(`DISPATCH_URL` 기본값만 4330) |
| `git.js`, `state.js`, `burn.js`, `tasks.js`, `roles.js`, `models.js`, `settings.js`, `style.js` | `server/dispatch/` | 없음 |
| `limits.js` | `server/dispatch/` | 없음. `~/.dispatch/limits.json` 공유는 유지(§5) |
| `auth.js` | `server/dispatch/` | 없음. CLI 로그인은 CLI가 브라우저를 엶 |
| `store.js` | `server/dispatch/dispatch-store.js` | 이름만 (Atelier `workspace/store.js`와 구분) |
| `index.js:88-160` | `server/dispatch/registry.js` | 등록 파일에 `app: "drawing"` 추가, 스캔 범위에 4330 |
| `index.js:209-287` | `server/dispatch/routes.js` | 어댑터 형식으로 |
| `index.js:56-62, 163-200, 289-310` (SSE·정적·body·서버) | 버림 | Atelier `events.js`·`static.js`·`app.js` 사용 |
| `server/test/*.test.js`, `git.test.js` | `test/dispatch/` | import 경로. 12개 파일 그대로 통과해야 1단계 완료 |
| `web/src/lib/*.ts` | `web/src/dispatch/lib/` | 거의 그대로(순수 함수) |
| `web/src/components/*` | `web/src/dispatch/` | 다시 그림: Atelier 테마·레이아웃에 맞춤. shadcn은 들이지 않고 필요한 것만 |
| `hooks/`, `skills/`, `scripts/`, `.claude-plugin/` | `plugin/` | §6 |

Hub 장애 격리: 어댑터가 라우트 예외를 잡고(이미 `app.js:54-59`), 타이머 콜백은 각각 try/catch로 감싸요. CLI 자식 프로세스 오류는 Hub가 이미 세션 단위로 처리해요(`sessions.js:879` `attach`).

## 5. 규칙 충돌 (0단계에서 정할 것)

| Atelier 규칙 | Dispatch 동작 | 제안 |
|---|---|---|
| transcript 저장 금지 (`CLAUDE.md:13`) | `.dispatch/transcripts/*.jsonl` 저장 (`sessions.js:87-89`) | 예외로 명시: 프로젝트 안 `.dispatch/`(git 제외)에만, 세션 삭제 시 함께 삭제. 토큰·키·이메일은 계속 금지 |
| 작업 공간 안에만 쓰기 (`CLAUDE.md:11`) | `.dispatch/`, worktree, `~/.dispatch/*` (`index.js:88`, `:132`, `limits.js:78`) | "프로젝트 저장소 안 + `~/.dispatch/`(등록·한도·테마)"로 넓힘 |
| 외부 네트워크 요청 없음 (`CLAUDE.md:11`) | 서버 자신은 안 함. 자식 CLI(claude/codex/agy)가 함 | 문구 보강: "서버는 요청 안 함. 사용자가 시작한 에이전트 CLI는 예외" |
| 쓰기 요청 보호: `application/json` | `x-dispatch: 1` | Dispatch 경로는 두 개 다 요구. 웹 `api.ts`에 헤더 추가 |
| 브랜치 `feat/`·`fix/` (`CLAUDE.md:9`) | worktree 브랜치 `dispatch/<slug>` (`git.js:43`) | 그대로. 사람이 PR 낼 때 이름을 바꾸는 건 리드 몫 |

## 6. 다른 프로젝트용 플러그인

남길 것 (`plugin/`, 마켓플레이스 이름 `dispatch` 유지 — 기존 설치가 `/plugin update`로 넘어오게):

1. 스킬 3개: `dispatch`(띄우기·세션 다루기), `dispatch-team`(팀 꾸리기), `dispatch-update`. 문구의 "Dispatch UI" → "Atelier의 실행 화면", API 문서 `reference/api.md`는 포트만 바꿈.
2. `scripts/start.sh <project>`: Atelier 서버를 `<project>/pipelines`(없으면 만들기)로 띄움. 포트는 `<project>/.dispatch/server.port`에 기억(지금과 같음).
3. `hooks/long-session.mjs` + `hooks.json`: 그대로 (`DISPATCH_URL`·`DISPATCH_SESSION` 환경 변수로 동작).
4. MCP는 플러그인에 넣지 않아요. 지금처럼 서버가 세션을 띄울 때 `--mcp-config`로 붙여요(`sessions.js:910-912`).

어떻게 배포할지:

- Atelier는 웹에 npm 의존성이 있고 `public/`이 git에 없어요. 플러그인이 "설치 후 바로 실행"이려면 **빌드된 `public/`과 `server/`만 담은 릴리스 묶음**이 필요해요. 서버는 의존성 0이라 `npm install` 없이 돌아요.
- 추천: GitHub 릴리스에 `drawing-<ver>.tgz`(server + public + plugin) 첨부, `setup.sh`/`dispatch-update`가 그걸 받아 풀기. 대안은 첫 실행 때 `npm ci && npm run build`(1~2분, 설치 시 인터넷 필요).
- 독립 Dispatch 저장소는 마지막 단계에서 README에 이전 안내만 남기고 멈춰요. 삭제·강제 push 없음.

## 7. 이전 순서

각 단계 = 이슈 1개 + `develop` 대상 PR 1개. 순서대로, 앞 단계가 병합돼야 다음.

| 단계 | 내용 | 완료 조건 | 크기 |
|---|---|---|---|
| 0. 규칙 | §5 표대로 `CLAUDE.md` 수정, 이 문서 병합 | 사용자 승인 | 30분 |
| 1. 서버 이식 | `server/dispatch/` 복사, `index.js` 분해, 어댑터, SSE `onAttach`, 테스트 이식 | Dispatch 테스트 12개 + Atelier 테스트 통과. 임시 git 저장소로 `curl POST /api/sessions` → worktree 생성·`message_lead` 도착 확인 | 1~2일 |
| 2. 프로젝트 모드 | 작업 공간 ⊂ 프로젝트 판별, git 아닐 때 끄기, 등록 파일·스캔 포트 | 비 git 폴더에서 그림만 동작, git 하위 폴더에서 `/api/state` 응답 | 반나절 |
| 3. 웹 이식 | 세션 보드·세션 시트·작업 보드·한도·설정을 Atelier 안 화면으로 | 헤드리스로 세션 생성→대화→diff 확인. Dispatch UI 없이 팀 운영 가능 | 3~5일 |
| 4. 파이프라인 실행 | '시작', 노드↔작업 연결 사이드카, 상태 덧입히기 (다른 설계 문서) | 파일 하나로 팀 실행, 노드 색이 상태 따라 바뀜 | 별도 산정 |
| 5. 플러그인 전환 | `plugin/`, 릴리스 묶음, 스킬 문구, `dispatch-update`가 새 묶음 받기 | 깨끗한 다른 프로젝트에서 `/plugin install` → 띄우기 → 팀 실행 | 1일 |
| 6. 은퇴 | 독립 Dispatch README에 안내, Atelier 개발도 내장 버전으로 | 일주일 내장 버전으로 Atelier 개발 | — |

## 8. 위험

1. **자기 자신 위에서 개발.** Atelier 개발 팀이 지금 Dispatch worktree(`.dispatch/wt/`)에서 돌아요. 3단계 전에 내장 버전으로 갈아타면, Atelier 서버 재시작마다 팀이 끊겨요. → 6단계 전까지 독립 Dispatch 유지, 내장 버전 테스트는 임시 저장소로만(`CLAUDE.md:15`).
2. **같은 프로젝트에 두 서버.** 이전 기간 독립 Dispatch와 내장 Atelier가 같은 `.dispatch/state.json`을 동시에 쓸 수 있어요(`store.js:21-32`, 잠금 없음). → 2단계에서 `.dispatch/server.port`에 살아 있는 서버가 있으면 Dispatch 모듈을 끄고 안내.
3. **재귀 감시 부하.** 작업 공간을 저장소 최상위로 잡으면 worktree 수십 개를 감시해요(`store.js:805-806`). → §3.2 기본값 + 숨김 폴더 감시 제외.
4. **Hub 오류가 그림 편집을 멈춤.** → §4 장애 격리. 1단계에 "Hub 예외에도 `/api/file` 저장이 된다" 테스트 추가.
5. **웹 번들 크기.** Dispatch UI 370KB 소스가 그림 화면 첫 로딩에 붙으면 느려져요. → `web/src/dispatch/`는 lazy chunk (`web/src/LazyBoundary.tsx` 방식).
6. **플러그인 사용자 끊김.** 플러그인 이름을 바꾸거나 포트 기본값을 4317→4330으로 바꾸면 스킬·훅이 옛 주소를 봐요. → `DISPATCH_URL`을 서버가 항상 넘기므로 스킬 문서와 `mcp.js` 기본값만 맞추면 돼요. 레지스트리 스캔은 두 범위 다.

## 9. 열린 질문

1. transcript 예외(§5 첫 줄)를 허용할까요? 안 되면 세션 시트는 "지금 턴만, 메모리에만"이 되고 재시작 후 대화가 사라져요.
2. 기본 작업 공간 폴더 이름: `pipelines/`, `docs/pipelines/`, `.drawing-ws/` 중 무엇이 좋을까요? 숨김 폴더는 git에 안 올라가서 문서 공유가 안 돼요.
3. 플러그인 배포를 릴리스 묶음(추천)으로 할지, 첫 실행 빌드로 할지?
4. 저장소 이름·플러그인 표시 이름: Atelier 하나로 부를지, 실행 기능만 계속 "Dispatch"로 부를지?
5. 독립 Dispatch의 Codex·Gemini 지원(`sessions.js:1002`, `:1065`)도 1단계에 같이 옮길까요, Claude만 먼저 옮길까요? 같이 옮기는 쪽이 테스트를 그대로 쓸 수 있어 더 싸요.
