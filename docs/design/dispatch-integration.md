# E9 설계: Dispatch를 Atelier로 (파이프라인을 문서·다이어그램으로 계획하고 지켜보기)

> 대체됨(#587): Codex·Gemini는 다시 돌아가요. 에이전트는 연결한 제공자(Claude `claude`, OpenAI Codex `codex`, Gemini `agy`)의 모델을 써요. Fable 5.2만 쓰던 규칙(`docs/design/fable-only-projects.md`)은 대체됐어요. 권한 모드 규칙은 CLAUDE.md를 따라요.

상태: 설계안 (코드 변경 없음). 기준 커밋: Atelier `develop` 0394637, Dispatch 플러그인 0.14.0. 이슈 #87.
이 문서는 다섯 하위 문서의 **결정 요약, 문서끼리 충돌 정리, 티켓, 열린 질문**이에요. 근거와 세부는 하위 문서에 있어요.

| # | 하위 문서 | 다루는 것 |
|---|---|---|
| 1 | [`1-architecture.md`](dispatch-integration/1-architecture.md) | 한 프로세스 vs 둘, 옮길 모듈, 플러그인, 이전 순서 |
| 2 | [`2-file-format-and-live-overlay.md`](dispatch-integration/2-file-format-and-live-overlay.md) | `plan` 섹션(v4), 실행 기록 사이드카, 실시간 오버레이, 진행판(§5.1) |
| 3 | [`3-ux-flow.md`](dispatch-integration/3-ux-flow.md) | 계획 → 승인 → 실행 → 기록 화면 흐름 |
| 4 | [`4-operations-and-rules.md`](dispatch-integration/4-operations-and-rules.md) | 네트워크·개인정보·가드·권한 모드·테스트 |
| 5 | [`5-design-system-linear.md`](dispatch-integration/5-design-system-linear.md) | 앱 화면 디자인 시스템(Linear풍), 캔버스는 Eraser와 똑같이(§5) |

## 0. 한눈에 (추천)

1. **한 프로세스.** Dispatch 서버 코드를 Atelier의 기능 모듈 `server/dispatch/`로 옮겨요. API 경로는 그대로(겹치는 건 `/api/events`뿐이라 SSE 허브를 합쳐요). 포트 하나. (문서 1)
2. **계획은 파일에, 실행 상태는 옆 파일에.** `.dpx.json`에 `plan` 섹션(형식 v4)을 더하고, 실행 중 상태는 서버만 쓰는 `.drawing/runs/<파일 경로>/<runId>.json`에 둬요. 실행 중에 서버가 `.dpx.json`을 계속 고치지 않으니 사람이 편집할 때 409가 나지 않아요. (문서 2)
3. **실시간 표시는 그림 위에 얹는 층이에요.** 블록 SVG는 다시 그리지 않고, 노드 위치(scene) 위에 HTML/SVG 층을 띄워요. 캔버스와 문서 임베드에 같은 컴포넌트를 써요. 나중에는 이 층이 **진행판**이 돼요: 노드·연결선의 진행 효과, 전체 진행률, 에이전트별 색과 범례. (문서 2 §5, §5.1)
4. **승인 문은 하나예요.** 관리자가 `write_plan`으로 초안을 쓰면 사람이 고치고 `시작하기`를 눌러요. 승인 전에는 서버가 `create_sessions`를 거절해요. 진행은 `실행` 탭, 상태 띠, 캔버스 노드 위에 보여요. (문서 3)
5. **서버는 외부 요청을 하지 않아요.** 외부와 통신하는 건 사용자가 띄운 CLI 자식 프로세스뿐이에요. 대화 원문은 메모리에만 두고, 디스크와 문서에는 메타데이터만 남겨요. 가드 기본값은 바꾸지 않아요. (문서 4)
6. **화면은 두 톤이에요.** 앱 화면은 shadcn/ui 위에 Linear풍 토큰을 얹어요. 캔버스와 다이어그램은 **Eraser와 똑같이** 맞춰요. 둘이 만나는 곳의 원칙은 "캔버스 사각형 안은 캔버스 테마가 정하고, 앱 화면은 그 테두리만 그린다"예요. (문서 5 §5)

## 1. 사용자가 정한 기본값

**임시** = 사용자가 정한 임시 기본값이에요. 바꿀 수 있고, 바뀌면 이 표와 해당 티켓을 고쳐요. **확정** = 바꾸지 않아요.

| 항목 | 값 | 상태 | 닫힌 질문 |
|---|---|---|---|
| PR·CI 추적 | Atelier 서버 코드는 외부 요청 0건이에요. PR·CI 정보는 Dispatch 모듈이 `gh` CLI를 자식 프로세스로 띄워서만 가져와요. 작업 공간 설정으로 끌 수 있어요. 결과는 웹에 127.0.0.1 SSE로 전달돼요. 그래서 자식 프로세스 허용 목록은 `claude`, `codex`, `agy`, `git`, `gh`예요. | **임시** | 2-Q4 |
| 승인 | 계획 승인은 1번(`시작하기`)이에요. `develop` 병합은 메인 세션(관리자)이 리뷰·확인한 뒤 하고, 추가 승인은 없어요. `main` push는 금지예요. 문서 2의 `steps[].gate: manual`은 선택 필드로만 남기고, 병합 단계에는 기본으로 걸지 않아요. | **임시** | 3-Q1 |
| 테마 | OS 설정을 따르고, 수동으로 라이트/다크를 바꿀 수 있어요(`system` · `light` · `dark`). | **임시** | 5-Q1 |
| WIP `748f6a4` (`feat/shadcn-ui`) | 새 브랜치를 만들고 `web/src/components/ui/*`만 가져와요. 토큰 블록, `TopBar`, 의존성 변경은 가져오지 않아요(문서 5 §8). | **확정** | 5-Q5 |
| 대화 원문 | 메모리에만 둬요(세션당 링 버퍼 400개). 디스크에는 기록하지 않아요. 서버를 재시작하면 화면의 대화 기록이 비고, 세션 이어가기는 CLI 자체 세션 id로 해요. 세션별로 바꾼 프롬프트는 디스크에 남기지 않아서, 재시작하면 역할 기본 프롬프트로 돌아가요. | **임시** (문서 4 추천) | 1-Q1, 4-Q2(Atelier 쪽) |
| 캔버스·다이어그램 모양 | Eraser와 똑같이 맞춰요(근거 `docs/research/eraser/04-visual-design.md`, `02` styling·`connectorStyle`). Eraser 이름·로고·아이콘/일러스트/폰트 파일·코드는 복제하지 않아요. | **확정** | — |
| 진행판 | 지금은 티켓을 남기고 계획대로 개발해요. 나중에는 작성된 다이어그램이 곧 진행판이 돼요(문서 2 §5.1). | **확정** (방향) | — |

## 2. 결정 요약

### 2.1 구조와 이전 (문서 1, 4)

- **한 프로세스 vs 둘.** 두 프로세스로 가면 서버끼리 HTTP로 중계해야 하고, `시작하기`에 넘길 API가 새로 필요하고, 포트 두 개의 짝을 맞춰야 해요. 이 기능의 핵심이 "같은 파일 위의 실행 상태"라서 이벤트를 한 곳에서 내는 한 프로세스를 골라요. 재시작 때 세션이 끊기는 문제는 Hub의 기존 이어하기(`interrupted`)로 덮어요. Hub 오류가 그림 편집까지 멈추지 않도록 라우트와 타이머마다 try/catch로 격리해요.
- **옮길 코드.** `sessions.js`→`server/dispatch/hub.js`(port를 getter로), `mcp.js`, `git.js`, `state.js`, `burn.js`, `limits.js`, `tasks.js`, `roles.js`, `models.js`, `settings.js`, `style.js`, `auth.js`, `store.js`→`dispatch-store.js`, `index.js`의 라우트 표→`routes.js` 어댑터. Dispatch 테스트 12개는 `test/dispatch/`로 옮겨서 그대로 통과해야 해요. 웹은 `web/src/dispatch/`에 Atelier 톤으로 다시 그리고 lazy chunk로 나눠요.
- **버릴 코드.** Dispatch 자체의 SSE·정적 서빙·body 파서(Atelier 것을 써요), 포트 4317–4330 탐색(문서 4 R5), Codex API 키 입력 라우트(키가 서버를 지나가요, 문서 4 §1.3), 원문 파일 저장.
- **CLI 실행 이음매.** 자식 프로세스는 `server/dispatch/cli.js`의 `spawnCli` 한 곳에서만 만들어요(문서 4는 `server/runs/cli.js`로 적었는데, 모듈 위치를 문서 1에 맞췄어요). `shell: true`는 쓰지 않아요. 테스트에서는 이 함수를 가짜 CLI로 바꿔 끼워요.
- **권한 모드.** `manual` · `acceptEdits` · `auto` · `plan` 네 가지예요. 고른 모드보다 느슨하게 돌리지 않아요. 지금 Gemini는 `manual`·`acceptEdits`를 골라도 권한 확인 없이 돌아요. Atelier에서는 이 두 모드를 고르면 400으로 거절해요.
- **가드.** 한도 가드(5시간 90 %, 주간 85 %), 컨텍스트 70 %, 턴 회전, 누적 15M 토큰 가드는 기본값 그대로 옮겨요. 한도에 걸리면 Dispatch는 "티켓"을 남기는데, Atelier에서는 그 대신 파이프라인 단계가 "한도로 멈춤(리셋 HH:MM)"으로 표시돼요. `시작하기`도 가드를 거쳐요.
- **쓰기 요청 보호.** `/api/` 아래의 GET이 아닌 요청은 모두 `x-drawing: 1` 헤더가 있어야 해요. 플러그인 훅과 `mcp.js`가 계속 동작하도록 `x-dispatch: 1`도 같은 뜻으로 받아요. 환경변수 이름 `DISPATCH_URL`·`DISPATCH_SESSION`은 유지해요(문서 4 G4).
- **작업 공간과 프로젝트.** Atelier 작업 공간은 프로젝트 저장소 안의 하위 폴더(기본 `pipelines/`)이고, Dispatch 루트는 그 폴더의 git 최상위예요. git 저장소가 아니면 Dispatch 기능은 꺼지고 그림 도구만 동작해요. 같은 `.dispatch/`를 독립 Dispatch 서버가 이미 쓰고 있으면 Dispatch 모듈을 끄고 안내해요.
- **플러그인.** 플러그인 이름 `dispatch`는 유지하고 안의 서버만 Atelier로 바꿔요. 남는 것은 스킬 3개, `hooks/long-session.mjs`, start/stop 스크립트예요. 독립 Dispatch로 Atelier를 개발하는 일은 내장 버전이 기능까지 같아진 뒤 일주일 써 본 다음에 멈춰요.
- **이전 순서:** 규칙 → 서버 이식 → 프로젝트 모드 → 웹 이식 → 파이프라인 실행 → 플러그인 전환 → 은퇴. 단계마다 혼자 병합할 수 있어요(티켓 §5).

### 2.2 파일 형식과 실시간 표시 (문서 2)

- **`plan` 섹션, `FORMAT_VERSION` 3 → 4.** 필드는 `v`, `block`(단계 다이어그램 블록 id), `defaults`, `steps[]`(`id`, `node`, `role`, `model`, `effort`, `perm`, `n`, `task`, `after`, `gate`)예요. 문서 3에서 필요해서 계획 상태 `state`(`draft` · `running` · `paused` · `done`)와 `approvedRevision`을 더해요. 검사 함수 `planProblem`/`cleanPlan`은 `layoutProblem`처럼 `shared/`에 두고 서버와 웹이 같이 써요.
- **단계 ↔ 노드 연결 키는 DSL 노드 id예요.** 레이아웃 오버라이드도 같은 키를 써요. 연결선은 `from`/`to` 노드 id로 가리켜요.
- **실행 기록은 `.drawing/runs/`에 둬요.** 담는 것: 단계·세션 상태와 시각, 모델, effort, 토큰 수, 비용, 브랜치, 커밋, PR 번호·상태, 계획 스냅샷. 담지 않는 것: 원문, 프롬프트, `last`, 도구 출력, 작성자. 파일 하나에 256KB까지, 파이프라인마다 50개·90일까지 보관해요. 파일을 옮기거나 지우면 기록도 버전 기록처럼 함께 따라가요.
- **서버가 `.dpx.json`을 쓰는 경우는 상태가 바뀔 때뿐이에요.** 승인, 멈춤, 완료 요약 블록을 넣을 때만 써요. 이 쓰기는 `PATCH /api/file/plan`처럼 store 잠금 안에서 파일을 다시 읽고 고친 뒤 `workspace change`를 보내요. 열려 있고 저장할 것이 없는 탭은 다시 읽고, 고치던 탭은 다음 저장 때 지금처럼 409 선택 화면을 봐요.
- **진행판(문서 2 §5.1):**
  - 상태 5개: `pending` 대기 ◌, `active` 진행 ●, `review` 리뷰 ◐, `done` 완료 ✓, `blocked` 막힘 ⚠.
  - 색: 에이전트 색은 Dispatch 역할 색(`--role-*`)이고, 같은 역할 세션은 밝기 3단계로 나눠요. 완료는 `--ok`, 막힘은 `--bad`, 대기는 `--idle`.
  - 효과: 진행 중인 노드는 맡은 에이전트 색으로 테두리가 펄스하고, 진행 중인 연결선에는 점선이 흘러요.
  - 진행률 가중치: 대기 0, 진행 0.5, 리뷰 0.8, 완료 1. 막힌 단계는 막히기 직전 값을 유지하고 따로 세요. 그만둔 단계는 분모에서 빠져요.
  - 접근성: 모든 상태에 기호와 글자를 같이 붙이고 `aria-label`을 달아요. `prefers-reduced-motion`이면 움직임 없이 굵은 테두리와 고정 점선으로 보여요.
  - Eraser 원칙과의 관계: 이 층은 Eraser 모양 그림 위에 얹을 뿐, 채움·모양·선·글꼴은 바꾸지 않아요.

### 2.3 계획 → 승인 → 실행 → 기록 (문서 3)

1. **계획.** 관리자가 `write_plan { goal, steps, risks, asks }`를 부르면 서버가 문서(목표/단계/위험/물어볼 것)와 플로우차트 블록을 만들어요. 상태는 `계획`이고 사이드바에 ◐ 점이 붙어요. 관리자는 턴을 "검토 후 시작하기를 눌러 주세요"로 끝내요.
2. **검토.** 문서 안의 단계 목록은 `plan.steps`에 묶인 생성 블록이에요. 행을 고치면 단계가 고쳐지고 다이어그램이 다시 그려지는데, 손으로 옮긴 배치는 남아요.
3. **승인.** `시작하기`를 누르면 확인 창이 떠요: 세션 수, 한도 사용률, 관리자 초안과 바뀐 점, 답이 없는 질문. 승인하면 그 리비전이 고정되고, 관리자에게 `[계획 승인 · rev N]`과 바뀐 점이 전달돼요. 이름은 저장하지 않아요.
4. **실행.**
   - 모든 화면 위쪽 상태 띠: `● 실행 중 · 3/5 단계 · 24분째 · $1.82 · 5시간 68%`.
   - 4번째 보기 탭 `실행`: 단계, 세션, 한도 세 열에 기록 줄이 붙어요.
   - 캔버스: 노드 위에 진행판 층이 떠요.
   - 실행 중에는 단계 행이 읽기 전용이에요. 바꾸려면 `멈추기` → `계획 다시 열기`를 눌러요.
   - MCP 변경: `set_task`에 `step` 필드를 더하고, 새 도구 `note_step`(200자, 가림 처리)을 추가해요.
5. **기록.** 완료되면 서버가 요약 블록을 한 번 써요(단계·역할·모델·시간·비용·결과 표). 버전 기록에는 "계획 초안 / 승인 / 완료" 라벨이 붙어요. 다시 돌리려면 `복제해서 새 계획`을 써요. 지난 실행은 같은 층으로 다시 볼 수 있어요.

### 2.4 운영 규칙 (문서 4)

- 서버 코드의 `fetch`/`http.request` 대상은 루프백만 허용하고, 정적 테스트로 막아요. 서버는 CLI 트래픽을 중계하지 않고 CLI 로그인 정보도 읽지 않아요. 제공자는 사용자가 연결하기 전까지 꺼져 있어서, 문서·캔버스만 쓰는 사람에게는 완전 오프라인이에요.
- **"토큰"은 두 가지 뜻이에요.** 사용량 숫자는 저장해요. 인증 토큰·API 키는 절대 저장하지 않아요.
- 가림 처리(2차 방어): 링 버퍼에 넣거나 문서·기록에 쓰기 전에 키 모양(`sk-…`, `ghp_…`, `AKIA…`, `Bearer …`)과 이메일 모양 문자열을 `[가림]`으로 바꿔요.
- 로그에는 에러 종류만 남겨요. CLI stderr 꼬리는 UI 응답에만 싣고 콘솔에는 쓰지 않아요. 세션 이름은 무작위 짧은 이름이에요.
- 테스트:
  - `npm test`는 가짜 CLI(`test/fixtures/fake-cli/`)만 써요. 실제 CLI가 돌지 않았다는 것까지 단언해요.
  - 꼭 넣을 단언: 권한 모드 × 제공자 12칸, 가드 동작, 키·이메일 모양 문자열이 디스크·로그·문서 어디에도 남지 않음, 네트워크 정적 검사.
  - 병합 전에 실제 CLI로 한 번 확인해요: `claude-haiku-5-5`, `effort: low`, 한 줄 프롬프트, 임시 git 저장소.

### 2.5 디자인 시스템 (문서 5)

- 앱 화면은 shadcn/ui(`radix-ui` 단일 패키지) + 우리 토큰이에요. 다크 먼저 다듬고 라이트도 유지해요. UI 기본 글자는 Pretendard 14px(메타 13px)이고 문서 본문은 16px이에요. 행 높이 28px, 모서리 6px이고, 색은 shadcn 무채색 토큰(`--primary`, `--ring`, `--accent`, `--muted`)이에요. 색조는 상태색(`--ok`, `--warn`, `--destructive`)에만 써요(doc 6 §4). 명령 메뉴(`Ctrl/Cmd+K`)는 `cmdk`로 다시 만들어요.
- shadcn의 `--accent`는 중립 hover 색이에요. 보라 `--accent`/`--brand`는 #131에서 무채색 토큰으로 바뀌었어요.
- **캔버스는 Eraser와 똑같이(문서 5 §5).** 앱 토큰은 `shared/render/`에 들어가지 않아요. 두 톤이 만나는 곳은 이렇게 맞춰요(추천 하나):
  - 캔버스 배경은 다이어그램 테마 색으로 칠하고, 앱 화면은 테두리만 그려요.
  - 선택 색은 캔버스 테마에 둬요. 기본값은 `--ring`과 같은 무채색이에요.
  - 다크/라이트는 스위치 하나로 둘 다 바꿔요. 다이어그램은 필터로 뒤집지 않고 색 이름마다 테마별 팔레트로 그려요. 지금 쓰는 `invert` 필터는 스타일 티켓에서 없애요.

## 3. 하위 문서끼리 충돌

### 3.1 문서 4 ↔ 문서 5

정면으로 부딪히는 결정은 없어요. 아래 세 가지는 합칠 때 맞춰야 해요.

| 지점 | 문서 4 | 문서 5 | 정리 |
|---|---|---|---|
| 폰트 출처 | 규칙 문서인데 폰트를 다루지 않아요. `docs/tickets.md`는 "Fonts from their original OFL sources"예요 | Inter·Pretendard를 npm 재배포판(`@fontsource-variable/inter`, `pretendard`)으로 번들해요 | 둘 다 OFL이고 외부 요청이 없어서 규칙의 취지에는 맞아요. 다만 "원 배포처"와 문구가 달라요. 사용자 확인이 필요해요(열린 질문 7) |
| 화면에 보이는 명령 문구 | 멈춤 감지는 명령의 해시와 횟수만 저장하고, 원문은 저장하지 않아요 | 세션 보드 스케치에 `npm test 실패 (2)`가 보여요 | 화면 표시는 메모리에 있는 현재 활동에서만 읽고, 기록·디스크에는 남기지 않아요. 티켓 E19의 완료 조건으로 넣어요 |
| 세션 표시 이름 | 무작위 짧은 이름(Juno, Cal)만 써요 | 보드·명령 메뉴 스케치가 `impl-2`, `review-1`(slug)을 이름처럼 써요 | 이름은 짧은 이름으로 쓰고, slug는 브랜치 칩에만 보여요. 스케치만 고치면 돼요 |

### 3.2 그 밖의 충돌과 정리

| 지점 | 갈린 내용 | 정리 |
|---|---|---|
| 원문 저장 (1·2·3 ↔ 4) | 1은 `.dispatch/transcripts` 저장을 예외로 허용하자고 했고, 2·3은 원문이 그대로 남는다고 가정했어요. 4는 메모리에만 두자고 했어요 | **임시: 메모리에만**(§1). 기록의 `sid`는 그 세션이 살아 있을 때만 대화로 이어져요 |
| 섹션 이름·상태 위치 (2 ↔ 3) | 2는 `plan` 섹션에 상태를 넣지 않고, 3은 `pipeline` 필드에 실행 상태까지 넣었어요 | 이름은 `plan`으로 해요. 파일에는 드물게 바뀌는 계획 상태(`state`, `approvedRevision`)만 두고, 실시간 값은 `.drawing/runs`에 둬요 |
| 단계 순서의 원본 (2 ↔ 3) | 2는 다이어그램 연결선이 기본 순서이고 `after`가 덮어써요. 3은 단계 목록이 원본이고 다이어그램을 생성해요 | `write_plan`은 `after`를 직접 써서 다이어그램을 만들어요. 사람이 손으로 그린 파이프라인은 연결선에서 순서를 읽어요. 둘 다 `after`가 있으면 `after`가 이겨요. 어느 쪽을 기본으로 할지는 열린 질문 5 |
| 기록 줄 내용 (3 ↔ 4) | 3은 보고 첫 줄(120자)을 기록에 남겨요. 4는 답변 원문을 디스크에 두지 않아요 | 기록에는 관리자가 일부러 쓴 `note_step`(200자, 가림 처리)만 남겨요. 보고 첫 줄은 실행 중 화면에서 메모리로만 보여요 |
| 쓰기 헤더 (1 ↔ 4) | 1은 `x-dispatch: 1`을 유지하고, 4는 모든 비-GET에 `x-drawing: 1`을 요구해요 | `x-drawing: 1`을 요구하고 `x-dispatch: 1`도 같은 뜻으로 받아요 |
| worktree·상태 위치 (1 ↔ 4) | 1은 `<project>/.dispatch/`, 4는 `<workspace>/.drawing/wt/`예요 | 열린 질문 2. 추천은 1이에요(독립 Dispatch, 훅, 플러그인과 같은 위치라 이전 기간에 섞이지 않아요) |
| 한도 공유 파일 (1 ↔ 4) | 1은 `~/.dispatch/limits.json`을 유지하고, 4는 작업 공간 안에만 두자고 해요 | 열린 질문 1. 추천: 이전 기간에는 `~/.dispatch/limits.json`을 유지해요(독립 Dispatch와 같이 돌 때 가드가 서로의 한도를 못 보면 위험해요). 은퇴 단계에서 다시 봐요 |
| 서버 탐색 (1 ↔ 4) | 1은 등록 파일과 4330 스캔을 두고, 4는 탐색을 옮기지 말자고 해요 | 포트 탐색은 버려요. 등록 파일(`~/.dispatch/servers/`)은 열린 질문 1과 같이 정해요 |
| Codex 키 라우트 (1 ↔ 4) | 1은 `auth.js`를 그대로 옮기고, 4는 키 라우트를 빼요 | 빼요. 터미널에서 `codex login --with-api-key`를 쓰라고 안내해요 |
| 노드 테두리 색 (2 §5 ↔ 2 §5.1) | 처음 초안은 Dispatch 상태별로 색을 고정했어요 | §5.1(상태 5개, 역할 색)이 대체해요. 문서 2를 고쳐 뒀어요 |

## 4. CLAUDE.md에서 바뀔 줄

문서 4 §5.1 초안에 §1의 임시 기본값을 반영했어요. 11번 줄은 열린 질문 1·2의 추천을 따른 문구예요. 이 변경은 첫 티켓(E10)에서 해요.

| 줄 | 지금 | 바꿀 문구 |
|---|---|---|
| 3 | `Atelier: a local, internal-only diagramming tool ... The old draw.io live viewer is retired.` | 괄호 뒤에 추가: `, and runs agent pipelines planned in those documents (merged from Dispatch, issue #87; design in docs/design/dispatch-integration.md)` |
| 11 | `The server binds to 127.0.0.1 only and makes no outbound network requests; ... It writes only inside the workspace folder it was started with.` | `The server binds to 127.0.0.1 only and its own code makes no outbound network requests (loopback only); everything (fonts, Excalidraw assets, icons) is bundled or vendored. It writes only inside the workspace folder (run records under <workspace>/.drawing/), the git project that holds it (<project>/.dispatch/ and session worktrees), and ~/.dispatch/ (shared usage limits).` |
| 11 뒤 새 줄 | — | `- Agent sessions are the user's own CLIs (claude, codex, agy) started as child processes, only after the user connects a provider. Child processes are limited to those, git and gh (PR/CI status, can be turned off per workspace), all through server/dispatch/cli.js, never with a shell. The server never proxies their traffic or reads their credentials.` |
| 새 줄 | — | `- Permission modes are manual, acceptEdits, auto, plan; never run a session looser than the mode chosen (refuse instead). No bypassPermissions. Usage-limit and session-length guards stay on with their defaults unless an issue says otherwise.` |
| 새 줄 | — | `- Pipeline runs: one approval (시작하기) per plan; the lead merges reviewed PRs into develop without a second approval; nobody pushes to main.` |
| 새 줄 | — | `- Every non-GET /api request needs the x-drawing: 1 header (x-dispatch: 1 is accepted for the plugin).` |
| 13 | `Privacy: no transcripts, tokens, API keys, emails or real names stored or logged. Never read .env files.` | `Privacy: no transcripts, auth tokens, API keys, emails or real names stored or logged. Agent transcripts live in memory only. Disk, documents and run records keep metadata only (step states, times, model, token counts, cost, branch, commit, PR number). Never read .env files.` |
| 15 | `Testing: point the server at a scratch workspace folder (in a temp dir), never at a real project folder.` | `Testing: point the server at a scratch workspace folder inside a scratch git repo with one commit (in a temp dir), never at a real project folder. npm test uses the fake CLIs in test/fixtures/fake-cli/ and must never start a real claude, codex or agy. A manual run against a real CLI uses claude-haiku-5-5 at effort low with one-line prompts.` |

새 파일 `AGENTS.md`(한 줄: "Read and follow CLAUDE.md")도 같은 티켓에서 만들어요. Codex 세션은 이 파일을 읽어요.

## 5. 티켓

크기: **S** ≈ 반나절, **M** ≈ 1~2일, **L** ≈ 3일 이상. 이슈 제목은 `E<n>: ...`이에요. 지금은 이 티켓대로 계획해서 개발하고, 진행판(E24–E26)이 생기면 다이어그램이 이 목록을 대신해요.

| # | 티켓 | 크기 | 의존 |
|---|---|---|---|
| E10 | 규칙 먼저: CLAUDE.md(§4), `AGENTS.md` | S | 이 문서 병합, 열린 질문 1·2 |
| E11 | 서버 이식: `server/dispatch/`, 라우트 어댑터, SSE `onAttach`, port getter, 원문 메모리화, 키 라우트·포트 탐색 제거, 테스트 12개 이식 | L | E10 |
| E12 | CLI 이음매와 안전 테스트: `spawnCli`, 가짜 CLI 3종, 권한 매트릭스(Gemini 거절), 가림 처리, 루프백 정적 검사, `x-drawing` 헤더 | M | E11 |
| E13 | 프로젝트 모드: 작업 공간 ⊂ git 판별, git 아니면 끄기, 두 서버 방지 | S | E11 |
| E14 | 디자인 토큰·폰트·`dark:` 변형(옛 변수 별칭) + 새 브랜치에서 WIP `748f6a4`의 `ui/*`만 가져와 `radix-ui`로 | M | — |
| E15 | 명령 메뉴 `cmdk` + 명령 등록부, TopBar·Sidebar를 `ui/*`로 | M | E14 |
| E16 | **Eraser 다이어그램 스타일 맞추기 1단계: 차이 조사.** 노드 모양, 팔레트(`colorMode` 3종 × 색 이름), 연결선(`connectorStyle` 3종, 화살촉, 굵기), 라벨, 그룹 상자, 아이콘 배치, 글꼴 크기(`typeface` 3종), 간격을 Eraser 화면과 나란히 놓고 비교한 표(헤드리스 스크린숏, 라이트/다크). 근거 `04` §7–§10, `02` styling 표 | S | — (기준점은 `fix/crisp-diagram-blocks` 병합 뒤) |
| E17 | **Eraser 다이어그램 스타일 맞추기 2단계: 수정.** E16 표의 차이를 `shared/render/`에서 고치고 스냅샷을 갱신해요. 테마별 팔레트를 채운 뒤 `invert` 필터를 제거하고, 캔버스 배경·선택 색의 경계를 정리해요(문서 5 §5) | L | E16, E14(경계 부분만) |
| E18 | 파일 형식 v4 `plan`: `shared` `planProblem`/`cleanPlan`/`planOrder`, `normalizeContent`, `PATCH /api/file/plan`, 트리 배지, `새 파이프라인` 템플릿, `docs/workspace-api.md` | M | — |
| E19 | Dispatch 화면 이식: 세션 보드, 세션 시트(드로어), 작업 보드, 한도, 설정, lazy chunk. 명령 문구는 메모리에서만 읽어요 | L | E11, E14 |
| E20 | 계획·승인: `write_plan`, `note_step`, `set_task.step`, `create_sessions` 승인 게이트, `시작하기` 띠·확인 창, 가드 확인 | M | E11, E18 |
| E21 | 실행 기록기: `.drawing/runs`(보관 기한 정리, 이동·휴지통), SSE `run`, `GET /api/runs*` | M | E20 |
| E22 | 실행 화면: 상태 띠, `실행` 탭(단계·세션·한도·기록), 기본 배지 | M | E19, E21 |
| E23 | PR·CI 추적(임시 기본값): `gh` 자식 프로세스, 작업 공간 설정으로 끔, 번호·상태만 저장 | S | E21 |
| E24 | **진행판 오버레이 1단계: 연결 키·상태 스키마.** 단계↔노드 id, 연결선 `from`/`to` 키, `step.view` 5상태 계산, `SceneEdge` 추가 | S | E18, E21 |
| E25 | **진행판 오버레이 2단계: 렌더.** SVG 층(캔버스 `RunOverlay` + 문서 `DiagramView` 임베드), 노드 펄스·흐르는 점선, 역할 색, `prefers-reduced-motion`, 기호+글자 병행 | M | E24, E22 (권장: E17 뒤) |
| E26 | **진행판 오버레이 3단계: 진행률·범례.** 가중 진행률(막힘·리뷰 규칙), `N단계 중 k 완료 · p% · 남은 m`, 에이전트·상태 범례 | S | E25 |
| E27 | 멈춤·이어서 하기: 한도에 걸린 단계 멈춤, `멈추기`, `계획 다시 열기` | M | E22 |
| E28 | 기록: 완료 요약 블록, 버전 라벨, `복제해서 새 계획`, 지난 실행 고르기 | S | E22 |
| E29 | Dispatch UI 나머지: 사용량, 타임라인, 상시 화면 | M | E19 |
| E30 | 플러그인 전환: `plugin/`, 배포 묶음, 스킬 문구, `dispatch-update` | M | E19, E27, 열린 질문 3 |
| E31 | 독립 Dispatch 은퇴: README 안내(삭제·강제 push 없음) | S | E30 + 내장 버전 일주일 사용 |

**`fix/crisp-diagram-blocks`와 겹치는 범위 (E16·E17).** 그 브랜치(아직 `develop`에 없음)는 아래를 이미 고쳐요. E16 조사는 그 브랜치가 병합된 뒤의 모습을 기준으로 해요.

| 그 브랜치의 변경 | E16/E17 비교 항목 | 겹침 |
|---|---|---|
| 연결선 라벨을 작은 알약 모양 위에 그림, 연결선 끝을 둥글게 (`3913c33`, `shared/render/svg.ts`·`layout-graph.ts`·`theme.ts`) | 라벨, 연결선 | **겹쳐요.** E16에서 다시 비교만 하고, 남은 차이만 E17에서 고쳐요 |
| 확대·화면 배율에서 블록 그림을 선명하게 (`resolution.ts`, `ExcalidrawCanvas.tsx`) | — | 안 겹쳐요(모양이 아니라 선명도) |
| 새 블록이 이미 놓인 블록과 안 겹치게 배치 (`51df5ef`) | — | 안 겹쳐요 |
| 렌더 스냅샷 갱신 | E17 스냅샷 | 순서만 겹쳐요. 그 브랜치를 먼저 병합해요 |

**순서와 병렬 줄**

- Dispatch 줄: E10 → E11 → (E12, E13) → E19 → E29
- 형식 줄: E18 (언제든)
- 디자인 줄: E14 → E15. E16 → E17 (`fix/crisp-diagram-blocks` 병합 뒤)
- 실행 줄: (E11, E18) → E20 → E21 → (E22, E23, E24) → E25 → E26. E22 다음 (E27, E28)
- 마무리: E30 → E31

## 6. 열린 질문 (사용자 결정이 필요한 순)

다섯 문서의 질문에서 중복을 지우고, §1에서 이미 정한 것(2-Q4, 3-Q1, 5-Q1, 5-Q5, 1-Q1, 4-Q2의 Atelier 쪽)은 뺐어요.

1. **홈 폴더 쓰기 예외.** 한도(`~/.dispatch/limits.json`)와 서버 등록 파일을 계속 홈 폴더에 쓸까요? 추천: 이전 기간에는 유지해요(독립 Dispatch와 한도를 나눠 봐야 가드가 정확해요). (1 §5, 4-Q1)
2. **작업 공간과 worktree 위치.** 기본 작업 공간 폴더 `pipelines/`, 상태와 worktree는 `<project>/.dispatch/`로 할까요? 4번 문서 안은 모두 `<workspace>/.drawing/` 아래예요. 파이프라인 파일은 트리 아무 데나 두고 점 배지를 붙일지, 고정 섹션으로 보일지도 같이 정해요. (1-Q2, 3-Q5, 2-Q3)
3. **플러그인 배포와 이름.** 빌드된 묶음을 릴리스에 붙일지(추천), 첫 실행 때 빌드할지? 실행 기능을 계속 "Dispatch"로 부를지? Atelier 작업 공간이 아닌 프로젝트에서도 Dispatch 화면만 쓸 수 있게 할지? (1-Q3, 1-Q4, 3-Q2)
4. **기록에 비용을 달러로 보일까요?** 파일을 공유받는 사람이 지출을 보게 돼요. 토큰 수만 보이는 선택지도 있어요. (3-Q3)
5. **단계 순서의 원본.** 다이어그램 연결선(사람이 그린 그림이 순서)과 단계 목록 `after`(관리자가 쓴 계획) 중 무엇을 기본으로 할까요? (2-Q1, §3.2)
6. **관리자 없이 사람이 쓴 계획으로 시작할 수 있게 할까요?** 그러면 Atelier가 계획을 과제로 하는 관리자를 띄워요. 추천은 예, E20 뒤예요. (3-Q4)
7. **폰트 출처 문구.** Inter·Pretendard를 npm 재배포판(OFL)으로 번들해도 될까요, 원 배포처에서 받은 파일만 쓸까요? (§3.1)
8. **앱 화면 세부.** 강조색을 보라 하나로 할지 무채색으로 할지(5-Q2), 사이드바 220px·행 28px로 할지(5-Q3), Dispatch "모니터" 테마를 다크에 합칠지(5-Q4)?
9. **진행판·기록 세부.** 끝난 실행의 상태를 내보내기에 넣을 수 있게 할지(2-Q5)? 보관 기준(50개·90일·256KB)을 작업 공간 설정으로 열지(2-Q6)? 파일 하나에 계획 하나로 할지(2-Q2)?

사람 결정 없이 구현하면서 확인할 것: `[Dispatch]` 접두어와 `DISPATCH_*` 이름 유지(추천 유지, 4-Q3), Claude `--permission-mode manual` 값이 실제로 받아지는지(4-Q4), Gemini 환경변수를 `sessionEnv()`로 맞추기(4-Q5), Codex·Gemini 러너를 E11에 같이 옮기기(추천 같이, 1-Q5), 독립 Dispatch도 원문 저장을 끊을지(4-Q2 Dispatch 쪽, Dispatch 저장소에서 따로 정해요).

## 7. 사용자 결정 (2026-11-13)

§6의 질문 중 아래는 사용자가 정했어요. 나머지(1, 3, 7, 8, 9)는 각 질문의 추천을 따르고, 해당 티켓에서 다시 확인해요.

| 질문 | 결정 |
|---|---|
| 2. 작업 공간과 worktree 위치 | **추천대로.** 계획 파일은 프로젝트 안 `pipelines/`, 상태와 worktree는 `<project>/.dispatch/`. |
| 4. 비용 표시 | **달러와 토큰 둘 다** 보여요(구독제에서는 API 기준 추정치라고 표시). |
| 5. 단계 순서의 원본 | **다이어그램 연결선.** 그림의 화살표가 순서예요. `after`는 연결선이 없을 때만 써요. |
| 6. 사람이 쓴 계획으로 바로 시작 | **나중에.** 기본 흐름은 "사용자가 목표를 정의 → 에이전트들이 파이프라인(문서·다이어그램)을 먼저 만든다 → 사용자가 검토 → 승인 후 개발"이에요. E20은 이 흐름만 만들어요. |

§1의 임시 기본값(PR 추적, 승인 1회, 테마, 원문 메모리)은 그대로 임시예요.

## 8. 독립 Dispatch가 아직 하는데 Atelier에 없는 것 (#731)

세션 보드(세션·타임라인·사용량·상시 화면·새 세션·설정·프로바이더 연결·한도·PR 추적)는 모두 앱 안에 있고, 앱 안에서 독립 Dispatch 화면으로 나가는 링크·버튼은 없어요. 독립 Dispatch를 끄기 전에 아래가 남아 있어요. 코드로 확인한 것이고, 목록에 없는 것은 Atelier에 이미 있어요.

| 남은 것 | 지금 상태 | 메모 |
|---|---|---|
| 한 서버에서 여러 프로젝트 폴더를 함께 보기 | Atelier 서버는 작업 공간 하나(또는 프로젝트 모드의 한 저장소)만 봐요 | 세션 보드의 프로젝트 묶음은 그 작업 공간 안의 폴더 기준이에요 |
| 독립 Dispatch 저장소의 세션 기록 이어받기 | Atelier는 `<workspace>/.drawing/`의 메타데이터만 읽어요 | 원문 저장 금지 규칙 때문에 옮기지 않아요 |
| `dispatch` 스킬의 설치·실행 스크립트 이름 | `plugin/skills/dispatch*`가 `DISPATCH_*` 환경변수와 `[Dispatch]` 접두어를 그대로 써요 | 열린 질문 4-Q3 (추천: 유지) |
| 독립 Dispatch 포트의 북마크 | `/dispatch`는 `/#board`로 넘기거나 프로젝트 모드에서 같은 보드를 보여줘요 | 옛 해시(`#usage`, `#folder=`, `#tv`, `#settings`)도 받아요 |
