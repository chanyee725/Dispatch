<div align="center">

# Dispatch

**AI 에이전트 세션을 한 화면에서 돌리고 지켜봐요. 내 컴퓨터에서만 도는 앱이에요.**<br>
Claude Code · Codex · Gemini 세션과 팀을 띄우고, 세션 보드에서 지켜보고, 채팅으로 말을 걸어요.

1.1에서는 관리자 카드나 실시간 화면을 열어 **메시지 N건 대기**를 확인해요.

[English](README.md) · **한국어**

[![version](https://img.shields.io/badge/version-1.1.0-6366f1)](CHANGELOG.md)
[![node](https://img.shields.io/badge/node-%E2%89%A522.18-339933?logo=nodedotjs&logoColor=white)](#-빠른-시작)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-d97757)](#-스킬-설치)
[![Codex plugin](https://img.shields.io/badge/Codex-plugin-111111)](#-스킬-설치)
[![local only](https://img.shields.io/badge/127.0.0.1-local_only-0ea5e9)](#-개인정보와-로컬-전용)

<a href="docs/images/demo.mp4"><img src="docs/images/demo-poster.png" alt="데모: Dispatch 팀이 PLC 데이터를 받아 로봇을 움직이는 웹 페이지를 계획해요" width="900"></a>

<sub>데모 영상 · <a href="docs/images/demo.mp4">MP4로 보기</a> <!-- TODO(youtube): swap the MP4 link for the YouTube link once uploaded --> · 리드와 팀원이 실제 Claude CLI로 "PLC 데이터를 받아 로봇을 움직이는 웹 페이지"를 계획해요</sub>

</div>

## ✨ 핵심 기능

- **세션 보드**: 첫 화면이에요. 누가 무엇을 하는지, 작업별 단계와 남은 시간, 브랜치, 비용과 5시간·주간 사용량 한도를 봐요.
- **프로젝트와 세션**: 사이드바에 프로젝트 폴더가 있고, 하나를 고르면 그 세션만 봐요.
- **에이전트 팀**: 리드, 구현자, 리뷰어(Claude Code · Codex · Gemini)가 각자 git worktree에서 일하고 서로 리뷰하고 PR을 열어요.
- **채팅**: 앱에서 세션과 이야기해요. 저장한 대화는 사이드바에 있어요.
- **로컬 전용**: 서버는 `127.0.0.1`에만 열리고 밖으로 요청을 보내지 않아요.

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

- **Atelier로 쓰던 프로젝트**: `<프로젝트>/.atelier`는 그대로 둬요. 서버가 시작할 때 저장된 세션이 없으면 보드, 설정, 저장한 대화를 `<프로젝트>/.dispatch`로 한 번 복사해요(그 전까지는 `.atelier`를 그대로 써요). 예전 worktree는 제자리에 있어요.
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

**설정 → 관리자와 팀 → 관리자 메시지 최대 대기**에서 관리자 한 명의 대기 한도를 1~100건으로 정해요. 기본값은 20건이에요. 대기 건수는 설정한 한도까지만 표시해요.

1. 리드에게 한 줄로 말해요: "PLC에서 데이터를 받아온 뒤 로봇을 움직이는 웹 페이지를 만들어야 해."
2. 리드가 팀원을 두고 일을 나눠요.
3. 구현자는 git worktree에서 일하고, 새 리뷰어가 PR마다 코멘트를 달고, 병합 담당이 리뷰를 통과한 PR을 병합해요.
4. 세션 보드에서 모든 세션과 작업을 실시간으로 봐요.

관리자는 사용자 지시, 팀원 메시지, 자동 보고를 받은 순서대로 턴마다 한 건씩 처리해요.

## 🔒 개인정보와 로컬 전용

- 서버는 `127.0.0.1`에만 열리고, 서버 코드는 밖으로 요청을 보내지 않아요. 글꼴과 아이콘은 같이 들어 있어요.
- 작업 폴더, 그 폴더가 든 git 프로젝트, 공용 사용량 한도 폴더 안에서만 써요.
- 에이전트 대화는 메모리에만 두고, 디스크에는 단계·시간·모델·토큰·비용·브랜치·커밋·PR 번호 같은 메타데이터만 남겨요.
- 세션은 사용자가 연결한 CLI(`claude`, `codex`, `agy`)만 쓰고, 서버는 그 자격 증명을 읽지 않아요.

## 🏗 구조

```text
server/   127.0.0.1 서버: 에이전트 세션, 팀, 사용량, 채팅(server/dispatch)
web/      React 앱: 세션 보드, 사이드바, 채팅, 설정
shared/   서버·웹 공용 세션 타입과 도우미
plugin/   Claude Code · Codex 플러그인: 스킬 7개와 훅
scripts/  패키징, 데모 녹화(record-demo.mjs)
test/     node:test 테스트, 가짜 CLI, 헤드리스 e2e
```

## 🛠 개발

| 명령 | 하는 일 |
|---|---|
| `npm test` | 서버와 웹 로직 테스트(가짜 CLI만 써요) |
| `npm run build` | 웹 앱을 `public/`에 빌드 |
| `npm run dev:web` | Vite 개발 서버(`/api`는 4330 포트 서버로 넘겨요) |
| `node scripts/record-demo.mjs` | 데모를 다시 찍어요. 빈 포트·`/tmp` 아래 scratch 프로젝트에서 실제 Claude CLI(claude-sonnet-5-5)가 계획까지만 하고, `docs/images/demo.mp4`와 `demo-poster.png`를 써요. `CHROME`, `PLAYWRIGHT_CORE`, 로그인된 `claude`가 필요해요. `DEMO_FAKE=1`은 가짜 CLI로 스크립트만 확인해요 |

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
