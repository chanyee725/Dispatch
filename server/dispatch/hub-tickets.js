import { randomUUID } from "node:crypto";
import { redact } from "./redact.js";
import { STALL_MS, isOpenStatus, clip } from "./hub-util.js";

// Hub's tickets (work saved when the usage limit is reached) and the team watchdog that delivers reports.
// Mixed into Hub.prototype by hub.js, so `this` is the Hub.
export class HubTickets {
  // Watchdog: retry undelivered reports, flag teammates no lead hears and teams idle for a long time.
  /* ---------------- Tickets: work saved when the usage limit is reached ---------------- */

  get tickets() {
    const cut = Date.now() - 3 * 86400_000;
    return Object.values(this.store.data.tickets ||= {})
      .filter(t => t.status === "open" || t.updatedAt > cut)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Which guard window is over its threshold now, if any. */
  /** @this {import("./hub-util.js").HubThis} */
  limitHit() {
    const g = this.store.data.settings.guard;
    if (!g?.enabled) return null;
    const l = this.currentLimits();
    if (l.five != null && l.five >= g.five) return { key: `five:${l.fiveReset}`, reason: `5시간 한도 ${Math.round(l.five * 100)}%`, resetAt: l.fiveReset };
    if (l.seven != null && l.seven >= g.seven) return { key: `seven:${l.sevenReset}`, reason: `주간 한도 ${Math.round(l.seven * 100)}%`, resetAt: l.sevenReset };
    if (l.fable != null && l.fable >= (g.fable ?? g.seven)) return { key: `fable:${l.fableReset}`, reason: `Fable 주간 한도 ${Math.round(l.fable * 100)}%`, resetAt: l.fableReset };
    return null;
  }

  /**
   * At the guard threshold: save every unfinished board task (plus each lead's last word) as an
   * open ticket, once per limit window. After the reset, hand open tickets back to their leads.
   */
  /** @this {import("./hub-util.js").HubThis} */
  checkTickets(now = Date.now()) {
    const all = (this.store.data.tickets ||= {});
    const hit = this.limitHit();
    if (hit && this.store.data.ticketedFor !== hit.key) {
      this.store.data.ticketedFor = hit.key;
      const open = this.tasks.filter(t => t.stage !== "done");
      const leads = new Set(open.map(t => t.lead).filter(Boolean));
      // A lead with running teammates but nothing on the board still gets one ticket.
      for (const s of this.sessions) if (s.canSpawn && this.sessions.some(c => c.parent === s.id && c.status === "running")) leads.add(s.id);
      for (const lead of leads) {
        const ls = this.get(lead);
        const items = open.filter(t => t.lead === lead);
        const id = randomUUID();
        all[id] = {
          id, lead, leadName: ls?.name ?? null, status: "open", reason: hit.reason, resetAt: hit.resetAt,
          createdAt: now, updatedAt: now,
          items: items.map(t => ({ title: t.title, stage: t.stage, owner: t.owner, note: t.note })),
          leadLast: clip(redact(this.rt(lead).lastText || ls?.last || ""), 1500),
          team: this.sessions.filter(c => c.parent === lead && c.status !== "done")
            .map(c => ({ name: c.name, status: c.status, branch: c.branch, last: clip(c.last || "", 200) })),
        };
      }
      this.store.save();
      this.emit("tickets", this.tickets);
      // Pause: interrupt every running turn so nothing keeps spending past the threshold.
      for (const s of this.sessions) {
        if (s.status === "running" || s.status === "starting" || s.status === "waiting") {
          this.push(s, { kind: "info", text: `사용량 한도(${hit.reason})로 일시정지 — 티켓으로 저장됨` });
          this.interrupt(s.id);
        }
      }
    }
    // While paused, a session that still runs (e.g. started before the hit was seen) is stopped too.
    if (hit) for (const s of this.sessions) if (s.status === "running" && !this.rt(s.id).pauseNoted) {
      this.rt(s.id).pauseNoted = true;
      this.interrupt(s.id);
    }
    if (!hit) for (const s of this.sessions) if (this.live.get(s.id)?.pauseNoted) this.rt(s.id).pauseNoted = false;
    // Reset passed and no limit is hit any more: resume.
    if (!hit) for (const t of Object.values(all)) {
      if (t.status === "open" && t.resetAt && t.resetAt <= now) this.resumeTicket(t.id);
    }
  }

  /** Sends a ticket back to its lead as the next instruction and marks it resumed. */
  /** @this {import("./hub-util.js").HubThis} */
  resumeTicket(id) {
    const t = (this.store.data.tickets ||= {})[id];
    if (!t || t.status !== "open") return false;
    const lead = this.get(t.lead);
    const list = t.items.length
      ? t.items.map(i => `- ${i.title} (${i.stage}${i.owner ? `, ${i.owner}` : ""})${i.note ? `: ${i.note}` : ""}`).join("\n")
      : "(보드에 올린 작업 없음 — 아래 마지막 메모를 보고 이어 가라)";
    const team = t.team.length ? `\n\n[당시 팀원]\n${t.team.map(c => `- ${c.name} (${c.status}${c.branch ? `, ${c.branch}` : ""})${c.last ? `: ${c.last}` : ""}`).join("\n")}` : "";
    const note = this.ticketNote?.(t.lead) || "";
    const text = `[Dispatch 티켓 재개] ${t.reason}에서 멈췄던 작업이다. 한도가 초기화됐으니 이어서 진행하라. 브랜치·git log로 상태를 다시 확인하고, 팀원이 정리됐으면 필요한 만큼 다시 만들어라.\n\n[남은 작업]\n${list}${team}\n\n[멈출 때 내 마지막 메모]\n${t.leadLast || "(없음)"}${note ? `\n\n${note}` : ""}`;
    if (lead && lead.status !== "done") {
      try { this.send(lead.id, text, { force: true }); } catch { return false; }
    }
    t.status = lead && lead.status !== "done" ? "resumed" : "orphaned";
    t.updatedAt = Date.now();
    this.store.save();
    this.emit("tickets", this.tickets);
    return true;
  }

  /** @this {import("./hub-util.js").HubThis} */
  checkTeams(now = Date.now()) {
    this.checkTickets(now);
    const leads = this.sessions.filter(s => s.canSpawn && isOpenStatus(s.status));
    for (const s of this.sessions) {
      if (this.live.get(s.id)?.pendingReport) this.deliverReport(s);
      let stall = null;
      if (isOpenStatus(s.status) && !s.canSpawn && !s.parent && leads.length) {
        stall = { reason: "관리자에 연결되지 않아 보고가 전달되지 않아요", since: s.startedAt };
      } else if (isOpenStatus(s.status) && s.canSpawn) {
        const team = [s, ...this.sessions.filter(x => x.parent === s.id && isOpenStatus(x.status))];
        const last = Math.max(...team.map(x => x.updatedAt));
        if (team.length > 1 && team.every(x => x.status === "idle") && now - last > STALL_MS) {
          stall = { reason: `팀 전체가 ${Math.round((now - last) / 60000)}분째 대기 중이에요. 사용자 확인을 기다리는지, 멈춘 것인지 확인하세요.`, since: last };
        }
      }
      if ((s.stall?.reason ?? null) !== (stall?.reason ?? null)) this.mark(s, { stall });
      this.refreshStuck(s, now);
    }
    // A lead left idle past the length guard (the setting just turned on, a failed try): swap it now (#969).
    for (const s of this.sessions) if (!s.parent && this.replaceDue(s)) this.replaceSession(s);
    this.checkTaskStuck(now);
  }

  // A child's turn ended: hand its last answer to the lead, so a lead that went idle wakes up instead of
  // waiting to poll. Children have no Dispatch tools of their own to report with.
  // A report waits in pendingReport until it reaches a lead: a session attached later, or a Codex lead
  // busy mid-turn, gets it from setParent() or the watchdog.
  /** @this {import("./hub-util.js").HubThis} */
  reportToParent(s) {
    const r = this.live.get(s.id);
    if (!r?.lastText) return;
    r.pendingReport = `[${s.name}(${s.roleName}) 보고${s.branch ? ` · ${s.branch}` : ""}]\n${clip(r.lastText, 2500)}`;
    // The length-guard note (checkLong) travels with the report instead of waking the lead on its own.
    if (s.longNote) {
      r.pendingReport += `\n\n${s.longNote}`; s.longNote = null;
      // The lead has been told (#969): if it keeps the teammate, its next turn goes to a fresh session.
      if (s.longRun) { s.longRun.told = true; this.store.save(); }
    }
    r.lastText = null;
    this.deliverReport(s);
  }

  /** @this {import("./hub-util.js").HubThis} */
  deliverReport(s) {
    const r = this.live.get(s.id), parent = s.parent && this.get(s.parent);
    if (!r?.pendingReport || !parent || parent.status === "done") return;
    if (this.paused) return; // kept; delivered after the reset
    if (this.holdTeam?.(parent.id)) return; // kept; delivered after 이어서 하기
    try { this.send(parent.id, r.pendingReport + this.boardNote(parent.id)); r.pendingReport = null; } catch { return; /* retried by checkTeams */ }
    this.armAutoRemove(s);
  }
}
