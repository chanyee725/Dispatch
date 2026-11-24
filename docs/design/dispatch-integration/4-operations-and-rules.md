# E9 설계 4: 운영 규칙 (네트워크·개인정보·가드·권한·테스트)

상태: 설계안 (코드 변경 없음). 결정 6개는 §0, 답이 필요한 것은 §8 열린 질문.
다음: §0을 읽고 §8의 질문에 답해요(10분). 구현 순서는 §7.

기준 커밋: Atelier `develop` 0394637, Dispatch 0.14.0 작업 트리. 배경은 이슈 #87(Dispatch를 Atelier 안으로 합쳐 파이프라인을 문서+다이어그램으로 계획하고 실행·관찰).
경로 표기: `D:` = Dispatch 저장소(`~/personal/Dispatch`), 접두어 없음 = 이 저장소.

## 0. 추천 (한눈에)

네트워크와 실행:

1. **"외부 요청 금지"는 서버 프로세스에만 걸어요.** 세션의 CLI(`claude`, `codex`, `agy`) 통신은 서버가 만들거나 중계하지 않아요. 서버 코드의 `fetch`는 루프백만, 테스트로 막아요.
2. **CLI 실행은 한 곳(`spawnCli`)으로 모아요.** `npm test`는 가짜 CLI만 돌려요. PATH를 가짜 bin 폴더로만 채워 실제 CLI가 뜨지 않게 해요.
3. **쓰기는 워크스페이스 아래 `.drawing/`뿐이에요.** 숨김 폴더라 워크스페이스 API로 안 보여요(server/workspace/paths.js:20).

데이터와 가드:

1. **대화 원문은 디스크에 쓰지 않아요.** 메모리 링버퍼만 두고, 디스크에는 메타데이터·사용량·단계 상태만 남겨요. Dispatch는 `.dispatch/transcripts/<id>.jsonl`에 남기지만(D:server/sessions.js:87-88, 195-202) Atelier 규칙(CLAUDE.md:13)과 충돌해요.
2. **한도·세션 길이 가드는 기본값 그대로 옮겨요.** 5시간 90 %, 주간 85 %, 컨텍스트 70 %, 누적 15M 토큰. 바뀌는 것 하나: 멈춤 지점이 티켓 대신 파이프라인 문서의 단계 상태예요.
3. **Gemini의 조용한 우회를 없애요.** 지금은 `manual`을 골라도 `auto` + `--dangerously-skip-permissions`로 돌아요(D:server/sessions.js:1066, 1075). Atelier에서는 Gemini에 `manual`·`acceptEdits`를 고르면 400으로 거절해요.

따로: `~/.dispatch/*` 공유 파일을 쓸지는 §8 Q1에서 정해요.

## 1. 네트워크 규칙과 세션 실행의 충돌 해소

### 1.1 지금 상태

| 항목 | Atelier | Dispatch |
|---|---|---|
| 바인드 | `127.0.0.1` (server/index.js:8, 37) | `127.0.0.1` (D:server/index.js:19, 318) |
| Host 검사(DNS rebinding) | 있음 (server/app.js:84-87, 119-122) | **없음** — `req.headers.host`를 그대로 URL에 씀 (D:server/index.js:290) |
| 쓰기 요청 CSRF 가드 | `content-type: application/json` 강제 (server/workspace/index.js:7-8) | `x-dispatch: 1` 헤더 (D:server/index.js:301) |
| 서버가 하는 `fetch` | 없음 | 루프백뿐: 다른 Dispatch 서버 조회 (D:server/index.js:107, 155), MCP → 자기 서버 (D:server/mcp.js:5, 11), 훅 → 자기 서버 (D:hooks/long-session.mjs:29) |
| 외부와 통신하는 주체 | 없음 | 자식 CLI 3종 (D:server/sessions.js:914, 1018, 1081), 로그인 CLI (D:server/auth.js:79, 107) |

결론: Dispatch 서버 자체는 이미 외부 요청을 안 해요. 충돌은 "자식 CLI가 외부(모델 제공자)와 통신한다"는 점 하나예요.

### 1.2 규칙 (추천)

- **R1. 서버 프로세스는 루프백 외 요청을 만들지 않아요.** 서버 코드의 `fetch`/`http.request` 대상은 `127.0.0.1`만. 정적 테스트로 강제해요(§6.3).
- **R2. 자식 프로세스 허용 목록:** `claude`, `codex`, `agy`, `git`만 `spawn`/`execFile` 해요. 다른 실행 파일·셸 문자열(`shell: true`)은 금지. 이 목록은 `server/runs/cli.js` 한 파일에 둬요.
- **R3. 서버는 CLI 트래픽을 중계·가로채지 않아요.** 프록시 환경변수나 base URL을 주입하지 않고, CLI가 가진 로그인 정보를 읽지 않아요(D:server/auth.js:6-7의 원칙 유지). CLI에 넘기는 환경변수는 `DISPATCH_URL`(루프백)·`DISPATCH_SESSION`·헤드리스 Playwright 두 개뿐(D:server/sessions.js:25-26, 857-858, 914).
- **R4. 세션 기능은 켜야만 동작해요.** Dispatch처럼 처음엔 제공자가 모두 "연결 안 됨"(D:server/store.js:9 `enabled: { claude: false, openai: false }`, D:README.md:76). 사용자가 켜기 전엔 서버가 CLI를 하나도 띄우지 않아요. 문서·캔버스만 쓰는 사람에게 Atelier는 여전히 완전 오프라인이에요.
- **R5. 다른 서버 탐색(포트 4317–4330 프로빙, D:server/index.js:86-110)은 옮기지 않아요.** Atelier는 워크스페이스당 서버 하나라 필요 없어요. 루프백이라도 남의 포트를 두드리는 코드는 줄여요.
- **R6. Host 검사·CSRF 가드를 세션 라우트에도 그대로 써요.** `isAllowedHost`(server/app.js:119)가 모든 라우트 앞에 있으니 새 라우트는 자동으로 덮여요. 본문 없는 쓰기(`/interrupt`, `/kill`)는 `content-type` 검사가 안 걸리므로, `/api/` 아래 모든 비-GET에 `x-drawing: 1` 헤더를 요구하고 웹의 fetch 래퍼가 붙여요. MCP 서버(D:server/mcp.js:11)도 같은 헤더를 보내요.

### 1.3 하지 않을 것

- Codex API 키 입력 라우트(`POST /api/providers/openai/key`, D:server/auth.js:107, D:skills/dispatch/reference/api.md:87)는 **옮기지 않아요.** 키가 서버 메모리와 HTTP 본문을 지나가서 "키를 저장·전달하지 않는다"는 규칙과 맞지 않아요. 키 로그인이 필요하면 터미널에서 `codex login --with-api-key`를 직접 하게 안내해요.

## 2. 개인정보 규칙 (구체)

원칙(CLAUDE.md:13, D:AGENTS.md:15, 조직 지침): 대화 원문·토큰·API 키·이메일·실명은 저장·기록하지 않아요.

| 데이터 | Dispatch 지금 | Atelier 규칙 |
|---|---|---|
| 대화 원문(사용자·모델·도구 입출력) | `.dispatch/transcripts/*.jsonl`에 append (D:server/sessions.js:195-202) | **메모리 링버퍼만**(세션당 400개, D:server/sessions.js:17). 디스크·로그·`.dpx.json`에 안 써요. 재시작하면 사라져요. |
| 마지막 답변 `s.last` | 400자 잘라 `state.json`에 저장 (D:server/sessions.js:942) | 메모리에만. 디스크엔 단계 상태 코드와 시각만. 재시작 뒤 인계문은 브랜치·커밋으로 다시 확인하게 해요(이미 인계문이 그렇게 말함, D:server/sessions.js:580). |
| 프롬프트(공통 지시·역할 프롬프트) | `state.json`의 세션에 저장 | 파이프라인 문서에 사람이 쓴 계획은 **문서 본문**이라 저장 OK(사용자가 쓴 것). 세션의 `prompt`는 메모리에만 두고 `state.json`에서 빼요(server/dispatch/dispatch-store.js:8). 재시작 뒤엔 역할에서 다시 읽어요(server/dispatch/hub.js:885-886) — 세션마다 따로 준 프롬프트는 역할 기본값으로 돌아가요. |
| CLI 오류·작업 메모 | `state.json`에 세션 `error`, 작업 보드 `note`, 한도 티켓 `items[].note` 저장 | 셋 다 메모리에만. 디스크로 쓸 때 `diskView()`가 빼요(server/dispatch/dispatch-store.js:10-32). 티켓의 `leadLast`·`team[].last`도 같이 빠져요. |
| 사용량·비용·토큰 수 | `state.json` `daily` (D:server/store.js:34-40) | 그대로 저장. 숫자만. |
| 한도 % 와 리셋 시각 | `~/.dispatch/limits.json` (D:server/limits.js:76-78) | 숫자·시각만. 위치는 §8 Q1. |
| Codex 한도 | `~/.codex/sessions` 최신 로그 끝 256KB를 읽어 `rate_limits`만 파싱 (D:server/limits.js:10, 27-61) | **OpenAI를 연결했을 때만** 읽어요(server/dispatch/hub.js:303). 연결 전엔 `~/.codex`를 건드리지 않아요. **읽기만**, 파싱한 숫자 외엔 버려요. |
| 길이 가드 훅 표식 | 시스템 임시 폴더에 `dispatch-long-<id>` 빈 파일 | `~/.dispatch/hooks/`에 같은 빈 파일(세션 id만, 내용 없음, plugin/hooks/long-session.mjs:13). Atelier가 쓸 수 있는 폴더 안이에요. |
| 멈춤 감지용 명령 | 해시 12자리 + 횟수 (D:skills/dispatch/reference/api.md:33) | 그대로. 명령 원문·출력 저장 금지. |
| 프로젝트 경로 | 레지스트리에 `~`로 줄여 저장 (D:server/index.js:90) | 응답엔 폴더 이름만(server/app.js:71-72 규칙 유지). |
| 서버 로그 | 에러 메시지 일부 | 에러 종류만(`err.code ?? err.name`, server/app.js:101-102). CLI stderr 꼬리(D:server/sessions.js:883, 894)는 **UI 응답에만** 싣고 `console`에는 안 써요. |
| 세션 이름 | 무작위 짧은 이름 (D:server/roles.js:56) | 그대로. 실명 사용 금지. |

추가 규칙:

- **P1. 스크러버:** 메모리 링버퍼에 넣기 전, 그리고 문서(파이프라인 상태 블록)에 무엇이든 쓰기 전에 키 모양(`sk-…`, `ghp_…`, `AKIA…`, `Bearer …`)과 이메일 모양 문자열을 `[가림]`으로 바꿔요. 완벽하진 않으니 "저장 안 함"이 1차 방어, 스크러버는 2차예요.
- **P2. 문서에 남는 실행 기록**(파이프라인 "기록으로 남김", 이슈 #87)은 단계·역할·모델·브랜치·커밋·PR 번호·토큰 수·비용·시간만. 모델 답변 원문은 넣지 않아요.
- **P3. `.env` 금지:** 세션 실행 코드는 `.env`를 읽거나 CLI에 넘기지 않아요. 자식 환경은 `process.env` 상속이라(D:server/sessions.js:26), 서버를 띄운 셸 환경이 그대로 가요 — 이건 사용자 CLI가 원래 보는 환경과 같아서 허용해요.

## 3. 한도 가드와 세션 길이 가드 (v0.14)

### 3.1 옮길 동작 (변경 없음)

| 가드 | 기준(기본) | 동작 | 근거 |
|---|---|---|---|
| 한도 가드 – 생성 | 5시간 ≥ 0.9, 주간 ≥ 0.85 | Claude 모델을 쓰는 세션 생성을 거절 | D:server/sessions.js:409-416, 432-438; D:server/store.js:9 |
| 한도 가드 – 진행 | 같음 | 모든 세션에 새 메시지 거절(`paused`) | D:server/sessions.js:481-487 |
| 한도 도달 시 저장 | 창마다 1번 | 열린 작업을 티켓으로 저장, 리셋 뒤 관리자에게 돌려줌 | D:server/sessions.js:730-756, 777-793 |
| 컨텍스트 가드 | 70 % (0 또는 30–95) | 실행 중이면 한 번 "커밋하고 마무리" 주입, 다음 메시지는 새 CLI 세션 | D:server/sessions.js:517-533, 508-514 |
| 턴 회전 | 관리자 5턴, 나머지 10턴 | 인계문으로 새 CLI 세션 | D:server/sessions.js:508-514, 568-590; D:README.md:12 |
| 길이 가드 (0.14) | 누적 15M 토큰 (0 또는 2–500) | 팀원: 다음 보고에 "교체하라" 첨부. 관리자: 인계 요청(실행 중이면 즉시, 아니면 다음 메시지) | D:server/sessions.js:536-563; D:CHANGELOG.md 0.14.0 |
| 길이 가드 훅 | 같음 | 플러그인 PostToolUse 훅이 세션 안에서 한 번 더 알림 | D:hooks/long-session.mjs:20-29 |

한도 수치는 CLI가 이미 보내는 `rate_limit_event`에서만 읽어요(D:server/sessions.js:971-984). 사용량 API를 따로 부르지 않으니 §1 규칙과 충돌이 없어요.

### 3.2 Atelier에서 바뀌는 점

- **G1. 티켓 = 파이프라인 단계.** 한도에 걸리면 실행 중인 파이프라인은 "한도로 멈춤(리셋 HH:MM)"으로 표시돼요. 남은 단계는 문서에 이미 있으니 별도 티켓 저장소가 필요 없어요. 리셋 뒤 자동 재개는 Dispatch와 같게(관리자에게 "멈춘 단계부터 이어서").
- **G2. 파이프라인 시작 버튼도 가드를 거쳐요.** 첫 단계를 띄우기 전 `guardCheck`를 부르고, 걸리면 시작하지 않고 이유를 보여줘요("주간 한도 87 % — 차단 기준 이상이에요").
- **G3. 가드 메시지 문구는 그대로**(해요체/관리자용 반말 지시문 구분 유지). 세션 안으로 들어가는 `[Dispatch] …` 접두어는 훅 호환 때문에 당분간 유지(§8 Q3).
- **G4. 환경변수 이름 `DISPATCH_URL`·`DISPATCH_SESSION` 유지.** 이미 설치된 플러그인 훅이 이 이름을 봐요(D:hooks/long-session.mjs:21). 바꾸면 훅이 조용히 꺼져요.

## 4. 권한 모드

모드 4개: `manual` · `acceptEdits` · `auto` · `plan` (D:server/roles.js:53).

| 모드 | Claude (D:server/sessions.js:904) | Codex (D:server/sessions.js:1003) | Gemini 지금 (D:server/sessions.js:1066, 1075) | Gemini Atelier |
|---|---|---|---|---|
| `manual` | `--permission-mode manual`, 요청은 UI로 | `read-only` 샌드박스 | **`auto` + 권한 건너뜀** | 거절(400) |
| `acceptEdits` | 그대로 | `workspace-write` | `auto` + 권한 건너뜀 | 거절(400) |
| `auto` | 그대로 | `workspace-write` | `auto` + 권한 건너뜀 | 허용(명시적 선택) |
| `plan` | 그대로 | `read-only` | `plan` + 권한 건너뜀 | 허용 |

규칙:

- **M1. 고른 모드보다 느슨하게 돌리지 않아요.** 맞출 수 없으면 거절하고 이유를 보여줘요("Gemini는 확인 모드를 못 써요. 자동이나 계획을 골라 주세요").
- **M2. `bypassPermissions`는 목록에 없고 API로도 못 넣어요**(D:server/sessions.js:662의 검사 유지).
- **M3. 기본값:** 리뷰어·관리자 `plan`이 아니라, Dispatch 역할 기본값을 그대로 써요(바꾸는 건 별도 결정). 파이프라인 문서의 단계마다 모드를 보여줘서 사람이 실행 전에 볼 수 있게 해요.
- **M4. Dispatch MCP 도구만 미리 허용**(`--allowedTools mcp__dispatch`, D:server/sessions.js:909-912). 서버가 가드·자식 수 상한을 강제하니까요.
- **M5. 작업 위치:** 세션 worktree는 `<워크스페이스>/.drawing/wt/<role>-<n>`. `auto`라도 CLI의 쓰기 범위는 그 worktree예요(Codex `workspace-write`). 서버 자신은 §0-6 범위 밖에 쓰지 않아요.

## 5. CLAUDE.md · AGENTS.md 변경 초안

### 5.1 Atelier `CLAUDE.md`

```diff
@@ line 3
-Atelier: a local, internal-only diagramming tool that works and looks like Eraser.io (document + infinite canvas per file, Eraser-compatible diagram-as-code, free-form drawing). Work items are in `docs/tickets.md`; the spec is `docs/research/eraser/` (start with `00-summary.md`). The old draw.io live viewer is retired.
+Atelier: a local, internal-only diagramming tool that works and looks like Eraser.io (document + infinite canvas per file, Eraser-compatible diagram-as-code, free-form drawing), and runs agent pipelines planned in those documents (merged from Dispatch, issue #87; design in `docs/design/dispatch-integration/`). Work items are in `docs/tickets.md`; the spec is `docs/research/eraser/` (start with `00-summary.md`). The old draw.io live viewer is retired.
@@ line 11
-- The server binds to 127.0.0.1 only and makes no outbound network requests; everything (fonts, Excalidraw assets, icons) is bundled or vendored. It writes only inside the workspace folder it was started with.
+- The server binds to 127.0.0.1 only and makes no outbound network requests (loopback only); everything (fonts, Excalidraw assets, icons) is bundled or vendored. It writes only inside the workspace folder it was started with (run state under `<workspace>/.drawing/`).
+- Agent sessions are the user's own CLIs (`claude`, `codex`, `agy`) started as child processes, only after the user connects a provider. Spawn only those and `git`, through `server/runs/cli.js`, never with a shell. The server never proxies their traffic or reads their credentials.
+- Permission modes are `manual`, `acceptEdits`, `auto`, `plan`; never run a session looser than the mode chosen (refuse instead). No `bypassPermissions`.
+- Usage-limit guard and session length guard stay on by default; don't weaken their defaults without an issue.
@@ line 13
-- Privacy: no transcripts, tokens, API keys, emails or real names stored or logged. Never read `.env` files.
+- Privacy: no transcripts, tokens, API keys, emails or real names stored or logged. Session transcripts live in memory only; disk and documents get metadata, usage numbers and step states. Never read `.env` files.
@@ line 15
-- Testing: point the server at a scratch workspace folder (in a temp dir), never at a real project folder.
+- Testing: point the server at a scratch workspace folder (in a temp dir), never at a real project folder. `npm test` uses the fake CLIs in `test/fixtures/fake-cli/` and must never start a real `claude`, `codex` or `agy`. A manual run against a real CLI uses `claude-haiku-5-5` at `effort: low` with one-line prompts.
```

### 5.2 Atelier `AGENTS.md` (새 파일)

Codex 세션도 이 저장소에서 돌게 되므로(Codex는 `AGENTS.md`를 읽어요) 한 줄짜리를 둬요.

```diff
+# AGENTS.md
+
+Read and follow `CLAUDE.md` in this folder; it is the single source of rules for every agent.
```

### 5.3 Dispatch `AGENTS.md` (Dispatch 저장소, 합치기 이후)

```diff
@@ line 5
-- `server/` — Node HTTP + SSE server with zero npm dependencies. `sessions.js` spawns and parses the CLIs (...)
+- `server/` — Node HTTP + SSE server with zero npm dependencies. `sessions.js` spawns and parses the CLIs (...). The runner is being merged into Atelier (chanyee725/Atelier, issue #87); port fixes there too until Dispatch is retired.
@@ line 15
-- Persist metadata and usage totals only. Transcripts, tokens, API keys and account emails stay out of `.dispatch/state.json`, logs and API responses (the org forbids storing PII).
+- Persist metadata and usage totals only. Transcripts, tokens, API keys and account emails stay out of `.dispatch/state.json`, `.dispatch/transcripts/`, logs and API responses (the org forbids storing PII).
```

(5.3의 두 번째 줄은 Dispatch에서도 원문 저장을 끊을지에 달려 있어요 — §8 Q2.)

## 6. 테스트 전략 (세션 실행을 가짜로)

### 6.1 이음매(seam)

- **`server/runs/cli.js`** 한 곳에서만 자식 프로세스를 만들어요: `spawnCli(provider, args, { cwd, env })`. 모듈 `setup(ctx)`는 `ctx.spawnCli`를 받고(server/app.js:66의 두 번째 인자에 `spawnCli` 추가), 기본값은 실제 구현이에요.
- 러너(Claude/Codex/Gemini 파서)는 지금처럼 stdout 줄 단위 JSON만 봐요(D:server/sessions.js:917, 1020, 1083). 그래서 가짜는 **같은 JSON 줄을 흘리는 프로세스**면 충분해요.

### 6.2 가짜의 세 단계

| 단계 | 방법 | 쓰는 곳 | 기존 예 |
|---|---|---|---|
| 1. 객체 가짜 | `fakeProc()` — `stdin.write`를 배열에 모음, 러너 메서드에 메시지 직접 주입 | 가드·회전·권한 매핑 단위 테스트 | D:server/test/length-guard.test.js:11-22 |
| 2. 프로세스 가짜 | `test/fixtures/fake-cli/{claude,codex,agy}.mjs`: 받은 인자를 `FAKE_CLI_LOG` 파일에 적고, `FAKE_CLI_SCENARIO`(JSON 줄 목록)를 stdout으로 흘린 뒤 종료 코드 반환. `spawnCli`를 이것으로 주입 | 서버 통합 테스트(`createApp` + HTTP) | test/hardening.test.js:97-103 (자식 프로세스 + env) |
| 3. PATH 가짜 | 임시 bin 폴더에 `claude`·`codex`·`agy` 실행 파일(위 스크립트 래퍼)만 두고 `PATH`를 그 폴더 + node 경로로 제한해 실제 서버(`server/index.js`)를 띄움 | e2e(헤드리스 브라우저로 파이프라인 실행 화면 확인) | test/e2e/* |

시나리오 파일 예: `init`(session_id) → `assistant`(usage 포함) → `rate_limit_event`(five 0.95) → `result`. 이거 하나로 생성 차단·일시정지·티켓(=단계 멈춤)을 다 확인해요.

### 6.3 꼭 넣을 테스트

1. **실제 CLI 미실행 보장:** 테스트 러너 시작 시 `PATH`에서 진짜 `claude`를 찾을 수 있어도, 서버가 쓰는 `spawnCli`는 가짜여야 해요. 가짜 로그에 기록이 없으면 실패하게 해서 "실제로 가짜를 탔다"를 확인해요.
2. **권한 매핑:** 모드 × 제공자 12칸의 인자(`--permission-mode`, `sandbox_mode`, `--mode`)를 단언. Gemini `manual`/`acceptEdits`는 400.
3. **가드:** 한도 0.95 이벤트 뒤 Claude 세션 생성 거절, Codex 세션은 허용(D:server/sessions.js:432-438); 컨텍스트 70 % 주입 1회; 15M 토큰 알림 1회와 재시작 뒤 반복 없음(D:server/sessions.js:546-548).
4. **개인정보:** 가짜 CLI가 키 모양 문자열(`sk-test-FAKE0000`)과 `someone@example.invalid`를 답변·도구 출력에 흘린 뒤, `<워크스페이스>/.drawing/` 전체와 서버 stdout/stderr, 파이프라인 문서 파일에 그 문자열이 **없음**을 단언. 원문 파일(`transcripts/`)이 생기지 않음도 단언.
5. **네트워크 정적 검사:** `server/**/*.js`에서 `fetch(`·`request(`의 대상이 `127.0.0.1` 상수가 아닌 곳, `spawn`/`execFile`이 `server/runs/cli.js`·git 헬퍼 밖에 있는 곳을 찾으면 실패. Host 검사 테스트(test/hardening.test.js:35)에 세션 라우트를 추가하고, `x-drawing` 없는 POST가 403인지도 확인.

### 6.4 실제 CLI 확인 (수동, CI 아님)

- 병합 전 1회: `claude-haiku-5-5`, `effort: low`, 한 줄 프롬프트, 스크래치 워크스페이스(임시 폴더의 커밋 1개짜리 git 저장소). Codex 쪽은 Codex 모델로(D:AGENTS.md:22-23).
- 출력 JSON 형식이 CLI 업데이트로 바뀌는 걸 잡으려고, 실제 실행에서 나온 줄을 **필드 이름만 남기고 값을 지운 형태**로 시나리오 파일에 반영해요(원문 저장 금지 유지).

## 7. 순서 (작은 PR 단위)

1. `chore`: CLAUDE.md·AGENTS.md 변경(§5) — 규칙 먼저.
2. `feat(runs)`: `server/runs/cli.js` + 가짜 CLI + §6.3-1·5 테스트(세션 기능 없음, 이음매만).
3. `feat(runs)`: Claude 러너 + 권한 매핑 + 메모리 링버퍼 + 스크러버 + §6.3-2·4.
4. `feat(runs)`: 한도·컨텍스트·길이 가드 + §6.3-3.
5. `feat(runs)`: Codex·Gemini 러너(M1 거절 포함).

## 8. 열린 질문

1. **`~/.dispatch/limits.json` 공유:** 한도는 계정 단위라 Dispatch는 여러 서버가 홈 폴더 파일로 나눠 봐요(D:server/limits.js:76-78). Atelier의 "워크스페이스 밖엔 안 씀" 규칙과 충돌해요. (a) 워크스페이스 `.drawing/limits.json`만 쓴다(다른 프로젝트의 한도 정보를 못 받음, 처음 한 턴은 모름) — 추천, (b) `~/.drawing/limits.json` 하나만 예외로 허용.
2. **원문 디스크 저장을 끊을 범위:** Atelier는 끊는 게 추천인데, 재시작하면 세션 화면 기록이 비어요. 이걸 받아들일지, 아니면 "세션 삭제 시 지움 + 24시간 뒤 자동 삭제"로 디스크 보관을 허용할지. Dispatch 본체도 같이 끊을지.
3. **`[Dispatch]` 접두어·`DISPATCH_*` 환경변수 이름:** 훅 호환을 위해 유지(추천)할지, Atelier 이름으로 바꾸고 훅도 같이 고칠지.
4. **Claude `--permission-mode manual`:** Dispatch는 `manual`을 그대로 넘겨요(D:server/sessions.js:904). 현재 CLI가 이 값을 받는지(아니면 `default`로 바꿔야 하는지) 실제 CLI로 한 번 확인이 필요해요.
5. **Gemini 환경변수:** Gemini만 `sessionEnv()` 대신 `process.env`를 써서 헤드리스 Playwright 설정이 빠져요(D:server/sessions.js:1080 vs 26). 옮기면서 맞추는 게 맞는지(추천: 맞춘다).
