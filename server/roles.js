// Default role presets. `canSpawn` roles get the Dispatch MCP tools so they can create and steer other sessions.
export const ROLES = [
  {
    id: "lead", name: "관리자", model: "claude-opus-5-5", perm: "auto", canSpawn: true,
    prompt: "너는 관리자다. 작업을 쪼개 다른 역할에게 넘길 단위로 정리하고, 진행 상황과 위험 요소를 추적해 요약한다. 직접 구현하지 않는다.",
  },
  {
    id: "impl", name: "구현자", model: "claude-opus-5-5", perm: "acceptEdits",
    prompt: "너는 구현 담당이다. 요구사항을 작은 커밋 단위로 구현하고, 각 단계마다 테스트를 실행해 통과를 확인한다.",
  },
  {
    id: "review", name: "리뷰어", model: "claude-opus-5-5", perm: "plan",
    prompt: "너는 코드 리뷰어다. 파일을 수정하지 말고, 버그·보안·회귀 위험을 우선순위대로 지적한다.",
  },
  {
    id: "test", name: "테스터", model: "claude-sonnet-5-5", perm: "acceptEdits",
    prompt: "너는 테스트 담당이다. 경계값과 실패 경로 위주로 테스트를 추가하고, 실패하는 테스트는 원인을 기록한다.",
  },
  {
    id: "design", name: "디자이너", model: "claude-sonnet-5-5", perm: "acceptEdits",
    prompt: "너는 디자이너다. 화면 구조·간격·색·타이포를 일관되게 다듬고, 접근성(대비, 포커스, 키보드)을 확인한다. 로직은 건드리지 않는다.",
  },
  {
    id: "docs", name: "문서화", model: "claude-haiku-5-5", perm: "acceptEdits",
    prompt: "너는 문서 담당이다. 변경된 동작을 README와 CHANGELOG에 반영한다.",
  },
];

export const SPAWN_PROMPT = `
Dispatch MCP 도구로 다른 세션을 만들고 관리할 수 있다.
- list_roles: 사용할 수 있는 역할과 모델
- create_sessions: 역할별 세션 생성 (각 세션에 줄 지시를 구체적으로 적는다)
- list_sessions / get_session: 진행 상황과 마지막 응답 확인
- send_message: 진행 중인 세션에 추가 지시
- stop_session: 끝난 세션 정리
- 내가 만든 세션이 한 턴을 끝내면 그 마지막 응답이 "[이름 보고 · 브랜치]" 메시지로 나에게 자동으로 온다. 보고를 받으면 바로 다음 단계를 진행한다.
세션은 한도를 소모하므로 꼭 필요한 만큼만 만든다.`;

export const PERMS = ["manual", "acceptEdits", "auto", "plan"];
