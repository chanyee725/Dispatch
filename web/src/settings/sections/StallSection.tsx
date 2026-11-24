// 멈춤 감지 section of the 설정 modal (#624): when the server reads a session as stuck and tells the lead. Each
// check can be turned off with 0; ranges and defaults mirror server/dispatch/settings.js.
import { TeamFieldsForm } from './shared';

export default function StallSection() {
  return <TeamFieldsForm section="stuck" title="멈춤 감지" hint="세션이 멈춘 것 같으면 관리자에게 알려요. 0이면 그 검사를 꺼요." testId="settings-section-stuck" />;
}
