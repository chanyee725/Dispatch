import { existsSync } from "node:fs";
import path from "node:path";

// Hub's auto-remove of finished teammates after their report reached the lead.
// Mixed into Hub.prototype by hub.js, so `this` is the Hub.
export class HubAutoRemove {
  /* ---------------- Auto-remove finished teammates (Dispatch #39, Drawing #632) ---------------- */
  // Leads forgot stop_session(remove: true), so finished teammates piled up holding worktrees and slots.
  // Once a teammate's report has reached its lead and nothing waits on a person, the server removes it
  // after a grace period unless the lead writes to it. The timer lives in memory only: after a restart
  // nothing is armed until the teammate's next report.

  /** Why `s` must not be auto-removed now, or null when it may be. */
  /** @this {import("./hub-util.js").HubThis} */
  autoRemoveBlocked(s) {
    if (!s || !this.team().autoRemoveDone) return "off";
    if (!s.parent || s.canSpawn) return "lead"; // only teammates; a lead is never removed by the server
    if (s.status !== "idle") return s.status; // running, waiting, error, done
    if (s.asksUser) return "asks";
    const r = this.live.get(s.id);
    if (r?.perms.size) return "perm";
    if (r?.pendingReport) return "report"; // not delivered yet
    return null;
  }

  /** Starts (or restarts) the grace timer for a teammate whose report just reached its lead. */
  /** @this {import("./hub-util.js").HubThis} */
  armAutoRemove(s) {
    this.cancelAutoRemove(s.id);
    if (this.autoRemoveBlocked(s)) return;
    const r = this.rt(s.id);
    // Transcript entries counted at arming time: any entry after it means the teammate is working again.
    r.armedSeq = r.seq;
    r.autoRemove = setTimeout(() => { r.autoRemove = null; this.autoRemove(s.id).catch(() => {}); }, this.team().autoRemoveGraceSec * 1000);
    r.autoRemove.unref?.();
  }

  /** @this {import("./hub-util.js").HubThis} */
  cancelAutoRemove(id) {
    const r = this.live.get(id);
    if (r?.autoRemove) { clearTimeout(r.autoRemove); r.autoRemove = null; }
  }

  /** The grace period ran out: stop and remove the teammate, then tell its lead. */
  /** @this {import("./hub-util.js").HubThis} */
  async autoRemove(id) {
    const s = this.get(id);
    if (!s || this.autoRemoveBlocked(s)) return false;
    const { parent, name, branch, cwd, worktree } = s;
    const who = `${name}(${s.roleName ?? s.role})`;
    // Work since the report (a queued message started another turn, events with status still idle) keeps it.
    const r = this.live.get(id);
    if (r?.armedSeq !== undefined && r.seq !== r.armedSeq) return false;
    const info = {};
    const dropped = this.remove(id, { strict: true, info });
    const kept = worktree && (await dropped) === false && existsSync(cwd);
    // The project-relative path (.atelier/worktrees/<slug>) is shorter for the lead and does not spell out the home folder.
    const rel = cwd && path.relative(this.root, cwd);
    const where = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : cwd;
    const why = info.detached ? ` 분리된 HEAD라 worktree를 남겼어요${info.sha ? ` (커밋 ${info.sha})` : ""}. 작업 폴더는 ${where}예요.`
      : info.unknown ? ` git 상태를 확인하지 못해 작업 폴더 ${where}는 남겼어요.`
      : ` 커밋 안 된 변경이나 git이 무시하는 파일이 있거나 상태를 확인하지 못해 작업 폴더 ${where}는 남겼어요.`;
    this.notifyLead(parent, `[Dispatch] ${who} 세션을 정리했어요${branch ? `(브랜치 ${branch})` : ""}.`
      + (kept ? why : ""));
    return true;
  }
}
