import { pluginDir } from "./plugins.js";

// modern-web-guidance (Claude Code plugin modern-web-guidance@googlechrome): when it is installed,
// the roles that do web work (implementer, designer, reviewer) are told to consult it for
// HTML/CSS/client-side JS, and the lead is told to put that in web briefs. Not installed: nothing.
// Read once per server start.

export const PLUGIN = "modern-web-guidance";
export const SKILL = "modern-web-guidance:modern-web-guidance";
export const WEB_ROLES = ["impl", "design", "review"];

const SCOPE = `웹 플랫폼 작업(HTML/CSS/클라이언트 JS, 웹 UI)에만 쓴다. 서버·API·DB, 테스트, 빌드 설정, CI, 스크립트 같은 웹이 아닌 일에는 쓰지 않는다.`;
const RULES = `- 프로젝트 규칙(CLAUDE.md/AGENTS.md)이 가이드보다 우선이다. 둘이 다르면 프로젝트 규칙을 따른다.
- 검색어는 일반적인 웹 플랫폼 질의(예: "light dismiss dialog", "responsive data table")만 쓴다. 프로젝트·저장소·파일·컴포넌트·사람 이름이나 비공개 내용은 넣지 않는다.`;

function how(provider) {
  return provider === "claude"
    ? `Skill 도구로 \`${SKILL}\` 스킬을 불러 그 절차를 따른다`
    : `네트워크가 있을 때만 \`npx -y modern-web-guidance@latest search "<질의>"\` → \`npx -y modern-web-guidance@latest retrieve "<id>"\` 순서로 실행한다. 네트워크·권한 문제로 실패하거나 멈추면 재시도·승인 요청·sandbox 완화를 하지 말고 즉시 건너뛰고, 보고·PR 끝 \`### Modern Web Guidance\` 절에 "가이드 조회 불가(네트워크 없음)" 한 줄을 적는다`;
}

const WORKER = {
  impl: "구현 전에 search로 해당 기능의 가이드를 찾고 retrieve로 읽은 뒤, 작성한 코드를 가이드와 대조한다.",
  design: "다듬기 전에 search로 해당 UI 패턴의 가이드를 찾고 retrieve로 읽은 뒤, 바꾼 화면 코드를 가이드와 대조한다.",
  review: "리뷰할 웹 변경마다 search로 가이드를 찾고 retrieve로 읽은 뒤, 코드를 가이드와 대조해 어긋난 곳을 지적한다.",
};

export function webGuidancePrompt(role, provider = "claude") {
  const head = `[Modern Web Guidance] ${SCOPE}`;
  if (WEB_ROLES.includes(role)) {
    return `${head}
- 웹 작업이면 ${how(provider)}. 순서: search → retrieve → 가이드와 코드 대조. ${WORKER[role]}
- 웹 작업을 마친 보고(PR 본문 포함) 끝에 \`### Modern Web Guidance\` 절을 붙여, 적용한 가이드 id와 무엇을 바꿨는지 적는다. 찾아봤지만 맞는 가이드가 없으면 그렇다고 한 줄 적는다.
${RULES}`;
  }
  if (role === "lead") {
    return `${head}
- 구현자·디자이너·리뷰어에게 웹 작업을 맡길 때 지시에 넣는다: \`${SKILL}\` 스킬(또는 \`npx -y modern-web-guidance@latest\`)로 search → retrieve → 가이드와 코드 대조, 보고·PR 끝에 \`### Modern Web Guidance\` 절.
- 웹 작업 보고에 그 절이 없으면 병합 전에 채우게 한다. "조회 불가"라고 적힌 절은 채워진 것으로 본다. 웹이 아닌 작업에는 넣지 않는다.
${RULES}`;
  }
  return "";
}

let installed;
// The prompt section for this role, or "" when the plugin is not installed or the role does no web work.
export function webGuidance(role, provider, home) {
  const on = home !== undefined ? !!pluginDir(PLUGIN, home) : (installed ??= !!pluginDir(PLUGIN));
  return on ? webGuidancePrompt(role, provider) : "";
}
