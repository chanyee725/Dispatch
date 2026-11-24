// 작업 폴더 section of the 설정 modal (#624): what a new session's worktree gets and whether it goes with the session.
import { TeamFieldsForm } from './shared';

export default function WorkspaceSection() {
  return <TeamFieldsForm section="folders" title="작업 폴더" hint="세션마다 만드는 작업 폴더를 어떻게 다룰지 정해요." testId="settings-section-folders" />;
}
