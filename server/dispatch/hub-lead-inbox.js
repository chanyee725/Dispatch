import { clip } from "./hub-util.js";
import { redact } from "./redact.js";

// Only teammate traffic enters this inbox. A lead's own instructions and guard messages keep their existing paths.
export class HubLeadInbox {
  /** @this {import("./hub-util.js").HubThis} */
  messageLead(id, text, messageId) {
    const sender = this.get(id);
    if (!sender) throw Object.assign(new Error("세션이 없어요"), { status: 404 });
    if (sender._killed || sender.status === "done") throw Object.assign(new Error("끝난 세션이에요"), { status: 400 });
    if (!String(text).trim()) throw Object.assign(new Error("보낼 내용이 없어요"), { status: 400 });
    if (messageId !== undefined && (typeof messageId !== "string" || !/^[\w.-]{1,128}$/.test(messageId))) {
      throw Object.assign(new Error("messageId가 올바르지 않아요"), { status: 400 });
    }
    const out = this.rt(id);
    if (messageId && out.acceptedLeadMessages?.has(messageId)) return { ok: true, duplicate: true };
    const lead = sender.parent && this.get(sender.parent);
    if (!lead || lead.status === "done") throw Object.assign(new Error("연결된 관리자가 없어요"), { status: 400 });
    const inbox = this.rt(lead.id).leadInbox;
    const limit = this.team().maxLeadInbox;
    this.fillLeadInbox(lead);
    if (inbox.length >= limit) {
      throw Object.assign(new Error("관리자 메시지 대기열이 가득 찼어요. 자리가 생기면 같은 messageId로 다시 보내세요."), {
        status: 429, code: "lead_inbox_full", waiting: inbox.length, limit,
      });
    }
    const heading = `[${sender.name}(${sender.roleName}) 메시지${sender.branch ? ` · ${sender.branch}` : ""}]`;
    inbox.push({ text: `${heading}\n${clip(redact(String(text)), 4000)}` });
    if (messageId) (out.acceptedLeadMessages ||= new Set()).add(messageId);
    this.emit("session", this.publicSession(lead));
    this.drainLeadInbox(lead);
    return { ok: true };
  }

  /** A report stays on its sender until delivery, including while waiting for space in its lead's inbox. */
  /** @this {import("./hub-util.js").HubThis} */
  queueLeadReport(sender, text, { board = true, tellsLong = false } = {}) {
    this.rt(sender.id).pendingReports.push({
      sender: sender.id, text: redact(text), board, tellsLong, order: ++this.leadReportSeq, queued: false,
    });
    const lead = sender.parent && this.get(sender.parent);
    if (!lead || lead.status === "done") return;
    if (this.fillLeadInbox(lead)) this.emit("session", this.publicSession(lead));
    this.drainLeadInbox(lead);
  }

  /** Move the oldest sender reports into the newly available slots. */
  /** @this {import("./hub-util.js").HubThis} */
  fillLeadInbox(lead) {
    const { leadInbox: inbox } = this.rt(lead.id);
    const slots = this.team().maxLeadInbox - inbox.length;
    if (slots <= 0) return false;
    const pending = this.sessions.filter(s => s.parent === lead.id)
      .flatMap(s => this.live.get(s.id)?.pendingReports.filter(report => !report.queued) ?? []);
    pending.sort((a, b) => a.order - b.order);
    for (const report of pending.slice(0, slots)) {
      report.queued = true;
      inbox.push(report);
    }
    return pending.length > 0;
  }

  /** @this {import("./hub-util.js").HubThis} */
  drainLeadInbox(lead) {
    const r = this.live.get(lead.id);
    if (this.stopping || !r?.leadInbox.length || this.get(lead.id) !== lead || lead._killed || lead.status !== "idle" || lead.asksUser ||
        r.perms.size || r.leadInboxHeld || r.drainingLeadInbox || (r.proc && lead.provider !== "claude") ||
        this.pausedFor(lead) || this.holdTeam?.(lead.id) || this.runBlock(lead)) return;
    r.drainingLeadInbox = true;
    const item = r.leadInbox.shift();
    try {
      this.send(lead.id, item.text + (item.board ? this.boardNote(lead.id) : ""));
    } catch {
      r.leadInbox.unshift(item);
      return;
    } finally {
      r.drainingLeadInbox = false;
    }

    const sender = item.sender && this.get(item.sender);
    if (sender) {
      const out = this.rt(sender.id);
      out.pendingReports = out.pendingReports.filter(report => report !== item);
      // The length guard may replace a teammate on its next turn after its lead has heard the warning.
      if (item.tellsLong && sender.longRun) {
        sender.longRun.told = true;
        this.store.save();
      }
      if (item.board) this.armAutoRemove(sender);
    }
    const recipient = this.get(lead.id);
    if (recipient) {
      this.fillLeadInbox(recipient);
      this.emit("session", this.publicSession(recipient));
    }
  }

  /** Return undelivered reports to their sender when its lead changes or is stopped. */
  /** @this {import("./hub-util.js").HubThis} */
  unqueueLeadReports(lead, senderId = null) {
    const r = this.live.get(lead.id);
    if (!r?.leadInbox.length) return;
    r.leadInbox = r.leadInbox.filter(item => {
      if (senderId && item.sender !== senderId) return true;
      if (item.sender) item.queued = false;
      return false;
    });
  }
}
