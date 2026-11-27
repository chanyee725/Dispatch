<div align="center">

<img src="./web/brand/dispatch-logo.png" alt="Dispatch Modules 로고" width="56">

# Dispatch

**AI 에이전트 세션을 한 화면에서 돌리고 지켜봐요. 내 컴퓨터에서만 도는 앱이에요.**<br>
Claude Code · Codex · Gemini 세션과 팀을 띄우고 세션 보드에서 진행 상황을 봐요.

1.2에서는 세션 보드를 열고 관리자를 골라 팀을 봐요. 작업 보드에서 작업별 남은 시간과 담당자를 확인해요.

[English](README.md) · **한국어**

[![version](https://img.shields.io/badge/version-1.2.0-6366f1)](CHANGELOG.md#120)
[![node](https://img.shields.io/badge/node-%E2%89%A522.18-339933?logo=nodedotjs&logoColor=white)](#-빠른-시작)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-d97757)](#-스킬-설치)
[![Codex plugin](https://img.shields.io/badge/Codex-plugin-111111)](#-스킬-설치)
[![local only](https://img.shields.io/badge/127.0.0.1-local_only-0ea5e9)](#-개인정보와-로컬-전용)

</div>

## ✨ 핵심 기능

- **세션 보드**에서 **전체**를 누르면 세션이 관리자별로 묶여요. 연결된 관리자가 없는 세션은 **관리자 연결 없음**에 나와요. 관리자를 고르면 그 관리자의 하위 세션을 봐요.
- **작업 보드**에서 작업별 단계, ETA, 담당자를 확인해요. ETA가 있으면 남은 시간이나 초과한 시간을 보여 줘요. 담당자가 비어 있으면 **맡은 사람 없음**으로 표시해요.
- **프로젝트**에는 실행이 확인된 Dispatch 서비스의 프로젝트 이름과 개수가 나와요. 사이드바에서 프로젝트 이름을 고르면 해당 서비스의 보드가 열려요. 세션은 세션 보드에서 확인해요.
- **에이전트 팀**의 관리자, 구현자, 리뷰어(Claude Code · Codex · Gemini)는 각자 git worktree에서 일하고 변경 사항을 리뷰하고 PR을 열어요.
- **브랜치와 사용량**은 사이드바에서 열어요. 브랜치, 비용, 제공자별 사용량 한도를 확인해요.

## 🚀 빠른 시작

필요한 것: Node.js 22.18 이상, git

```bash
git clone https://github.com/chanyee725/Dispatch.git
cd Dispatch
npm install && npm run build
mkdir -p ~/dispatch-notes && npm start -- ~/dispatch-notes
```

터미널에 나온 주소(기본 `http://127.0.0.1:4330/`)를 브라우저로 열어요.

| 설정 | 뜻 |
|---|---|
| `<작업 폴더>` | 파일이 저장되는 폴더. 미리 만들어 둬요. |
| `DISPATCH_PORT` | 포트 번호. 없으면 4330. `DISPATCH_PORT=4340 npm start -- <작업 폴더>`. 예전 이름 `DRAW_PORT`도 돼요. 둘 다 있으면 `DISPATCH_PORT`를 써요. |

- `npm run build`를 건너뛰면 페이지 대신 "Web app not built"가 나와요.
- 포트가 이미 쓰이고 있으면 서버가 바로 끝나고 다른 포트를 고르라고 알려줘요.

## 🔌 스킬 설치

GitHub 저장소에서 바로 설치해요. 플러그인은 저장소 루트 전체라서(1.0 전과 같아요) 서버도 함께 받아요. 스킬과 훅은 `plugin/`에 있어요.

**Claude Code**

```text
/plugin marketplace add chanyee725/Dispatch
/plugin install dispatch@dispatch
```

**Codex CLI**

```bash
codex plugin marketplace add chanyee725/Dispatch
codex plugin add dispatch@dispatch
```

그다음 프로젝트에서 "디스패치 켜줘"라고 말하거나 `dispatch` 스킬을 써요. 자세한 내용: [plugin/README.md](plugin/README.md)

### Atelier나 Dispatch 0.x에서 옮겨 올 때

Dispatch 1.0은 Atelier라고 부르던 앱을 Dispatch 이름으로 낸 거예요. 옮기는 동안 아무것도 지우지 않아요.

- **Atelier로 쓰던 프로젝트**: `<프로젝트>/.atelier`는 그대로 둬요. 서버가 시작할 때 `.atelier`에 저장된 세션이 없으면 보드와 설정을 포함한 프로젝트 상태를 `<프로젝트>/.dispatch`로 한 번 복사해요(그 전까지는 `.atelier`를 그대로 써요). 예전 worktree는 제자리에 있어요.
- **내 기본값**: `~/.atelier/`의 `drawing.json`, `limits.json`, `prefs.json`을 `~/.dispatch/`에 같은 파일이 없을 때만 한 번 복사해요.
- **Dispatch 0.x로 쓰던 프로젝트**: 지금 있는 `<프로젝트>/.dispatch`(worktree는 `wt/`)를 그대로 써요. 0.x 서버는 먼저 꺼 주세요. `~/.dispatch/servers/`(0.x 등록 파일)는 읽지도 쓰지도 않아요.
- **환경 변수**: `ATELIER_API_TIMEOUT`, `ATELIER_QUICKFIX_FILES`도 계속 돼요. 새 이름은 `DISPATCH_API_TIMEOUT`, `DISPATCH_QUICKFIX_FILES`예요.

## 🧩 스킬 7개

| 스킬 | 하는 일 | 이렇게 말해요 |
|---|---|---|
| `dispatch` | 프로젝트에서 서버 켜기·끄기, Claude·Codex·Gemini 연결 | "디스패치 켜줘" |
| `dispatch-update` | 최신 GitHub 릴리스로 업데이트하고 서버 다시 켜기 | "디스패치 업데이트" |
| `dispatch-team` | 이슈 하나에 리드·구현자·리뷰어 팀 꾸리기 | "팀 꾸려서 진행해" |
| `dispatch-quickfix` | 1~3개 파일을 한 세션으로 빠르게 고치기 | "문구만 고쳐줘" |
| `dispatch-session` | 세션 하나 띄우기, 메시지·중단·권한 응답 | "세션 하나 띄워줘" |
| `dispatch-status` | 세션 상태, 남은 시간, 막힘, 사용량 한도 | "지금 뭐 하고 있어?" |
| `dispatch-settings` | 비용·토큰, 한도 가드, 역할별 모델 | "역할별 모델 바꿔줘" |

## 🧭 팀이 일하는 방식

`dispatch-session` 스킬로 관리자에게 짧게 지시해요.

1. 관리자가 팀원을 두고 일을 나눠요.
2. 구현자는 git worktree에서 일하고, 리뷰어가 변경 사항을 확인하면 관리자가 검토를 통과한 PR을 병합해요.
3. 세션 보드에서 세션과 작업의 진행 상황을 봐요.

대기 메시지가 있으면 관리자 카드나 실시간 화면에서 **메시지 N건 대기**를 확인해요. 관리자는 사용자 지시, 팀원 메시지, 자동 보고를 받은 순서대로 턴마다 한 건씩 처리해요. **설정 → 관리자와 팀 → 관리자 메시지 최대 대기**에서 관리자 한 명의 대기 한도를 1~100건으로 정해요. 기본값은 20건이고 건수는 설정한 한도까지만 표시해요.

관리자가 새 세션으로 자동 교체되면 인계 내용, 팀원, 작업 보드, 대기 메시지가 함께 옮겨져요. 수동으로 인계할 때는 `POST /api/tasks/:id/handoff`로 작업 카드와 선택한 팀원을 같은 프로젝트의 다른 관리자에게 넘겨요. 카드 ID와 단계 이력도 함께 넘어가요.

완료된 관리자를 자동으로 정리하려면 **설정 → 관리자와 팀 → 끝난 관리자 자동 정리**를 켜요. 카드가 한 장 이상 있는 유휴 관리자는 모든 카드의 병합이 확인되고, 팀원이 일을 마쳤으며, 남은 작업이나 대기 응답이 없으면 정리 대상이 돼요. 기본 유예 시간은 120초예요. 관리자가 `finish`로 정리를 요청할 수도 있어요. 정리 후에도 worktree와 작업 카드는 남아요.

## 🔒 개인정보와 로컬 전용

- 서버는 `127.0.0.1`에만 열리고, 서버 코드는 밖으로 요청을 보내지 않아요. 글꼴과 아이콘은 같이 들어 있어요.
- 작업 폴더, 그 폴더가 든 git 프로젝트, 공용 사용량 한도 폴더 안에서만 써요.
- 에이전트 대화는 메모리에만 두고, 디스크에는 단계·시간·모델·토큰·비용·브랜치·커밋·PR 번호 같은 메타데이터만 남겨요.
- 세션은 사용자가 연결한 CLI(`claude`, `codex`, `agy`)만 쓰고, 서버는 그 자격 증명을 읽지 않아요.

## 🏗 구조

```text
server/   127.0.0.1 서버: 에이전트 세션, 팀, 사용량(server/dispatch)
web/      React 앱: 세션 보드, 사이드바, 사용량, 설정
shared/   서버·웹 공용 세션 타입과 도우미
plugin/   Claude Code · Codex 플러그인: 스킬 7개와 훅
scripts/  패키징과 개발 도구
test/     node:test 테스트, 가짜 CLI, 헤드리스 e2e
```

## 🛠 개발

| 명령 | 하는 일 |
|---|---|
| `npm test` | 서버와 웹 로직 테스트(가짜 CLI만 써요) |
| `npm run build` | 웹 앱을 `public/`에 빌드 |
| `npm run dev:web` | Vite 개발 서버(`/api`는 4330 포트 서버로 넘겨요) |

브라우저 e2e는 켤 때만 돌아요.

```
DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
```

작업은 GitHub 이슈로 관리해요. 바뀐 점은 [CHANGELOG.md](CHANGELOG.md)에 있어요.

## 지원하지 않는 것

- 여러 사람이 동시에 편집하기, 원격 접속, 계정
- 문서, 캔버스, 다이어그램, 계획 실행(2026-11-23에 뺐어요)

## 라이선스

외부 프로젝트 고지는 [NOTICE.md](NOTICE.md)에 있어요.
