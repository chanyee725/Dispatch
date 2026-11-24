// 관리자와 팀 section of the 설정 modal (#624): how often a conversation starts over and how many teammates one
// lead may hold. The session-length guards (토큰·컨텍스트 한도) live in 사용 한도 with the usage guards.
import { TeamFieldsForm } from './shared';

export default function TeamSection() {
  return <TeamFieldsForm section="team" title="관리자와 팀" hint="관리자가 대화를 이어 가는 주기와 팀 크기예요. 새로 여는 세션부터 적용돼요." testId="settings-section-team" />;
}
