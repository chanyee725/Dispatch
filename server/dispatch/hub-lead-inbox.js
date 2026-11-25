import { randomUUID } from "node:crypto";
import { clip } from "./hub-util.js";
import { redact } from "./redact.js";

function leadMessageId(id = randomUUID()) {
  if (typeof id !== "string" || !/^[\w.-]{1,128}$/.test(id)) {
    throw Object.assign(new Error("messageId가 올바르지 않아요"), { status: 400 });
  }
  return id;
}

// User instructions and teammate reports share one FIFO. Teammate items stay in sender memory until delivery.
export class HubLeadInbox {
  /** @this {import("./hub-util.js").HubThis} */
  messageSession(id, text, { images = null, messageId } = {}) {
    const lead = this.get(id);
    if (!lead?.canSpawn) {
      this.send(id, text, { images });
      return { ok: true };
    }
    if (lead._killed || lead.status === "done") throw Object.assign(new Error("끝난 세션이에요"), { status: 400 });
    if (images?.length && lead.provider !== "claude") throw Object.assign(new Error("이미지는 Claude 세션에만 보낼 수 있어요"), { status: 400 });
    const r = this.rt(id);
    const key = leadMessageId(messageId);
    if (r.acceptedLeadInstructions?.has(key)) return { ok: true, duplicate: true };
    // A fresh instruction explicitly resumes a cancelled or failed turn. Give the oldest accepted item
    // the turn even if the inbox is full, so a full inbox can still be resumed.
    const resume = r.leadInboxHeld || lead.asksUser || lead.status === "error";
    this.checkLeadInboxSpace(lead, { resume });
    r.leadInbox.push({ text, images, order: ++this.leadReportSeq });
    (r.acceptedLeadInstructions ||= new Set()).add(key);
    if (resume) r.leadInboxResume = true;
    this.emit("session", this.publicSession(lead));
    this.drainLeadInbox(lead);
    return { ok: true };
  }

  /** @this {import("./hub-util.js").HubThis} */
  messageLead(id, text, messageId) {
    const sender = this.get(id);
    if (!sender) throw Object.assign(new Error("세션이 없어요"), { status: 404 });
    if (sender._killed || sender.status === "done") throw Object.assign(new Error("끝난 세션이에요"), { status: 400 });
    if (!String(text).trim()) throw Object.assign(new Error("보낼 내용이 없어요"), { status: 400 });
    const key = leadMessageId(messageId);
    const out = this.rt(id);
    if (out.acceptedLeadMessages?.has(key)) return { ok: true, duplicate: true };
    const lead = sender.parent && this.get(sender.parent);
    if (!lead || lead.status === "done") throw Object.assign(new Error("연결된 관리자가 없어요"), { status: 400 });
    this.checkLeadInboxSpace(lead);
    const heading = `[${sender.name}(${sender.roleName}) 메시지${sender.branch ? ` · ${sender.branch}` : ""}]`;
    (out.acceptedLeadMessages ||= new Set()).add(key);
    this.queueLeadReport(sender, `${heading}\n${clip(redact(String(text)), 4000)}`, { board: false, messageId: key });
    return { ok: true };
  }

  /** @this {import("./hub-util.js").HubThis} */
  checkLeadInboxSpace(lead, { resume = false } = {}) {
    const limit = this.team().maxLeadInbox;
    const waiting = this.leadInboxSize(lead);
    if (waiting < limit) return;
    if (resume) this.drainLeadInbox(lead, { resume });
    throw Object.assign(new Error("관리자 메시지 대기열이 가득 찼어요. 자리가 생기면 같은 messageId로 다시 보내세요."), {
      status: 429, code: "lead_inbox_full", waiting, limit,
    });
  }

  /** @this {import("./hub-util.js").HubThis} */
  queueLeadReport(sender, text, { board = true, tellsLong = false, messageId } = {}) {
    this.rt(sender.id).pendingReports.push({
      sender: sender.id, text: redact(text), board, tellsLong, messageId, order: ++this.leadReportSeq,
    });
    const lead = sender.parent && this.get(sender.parent);
    if (!lead || lead.status === "done") return;
    this.emit("session", this.publicSession(lead));
    this.drainLeadInbox(lead);
  }

  /** @this {import("./hub-util.js").HubThis} */
  *leadInboxQueues(lead) {
    const own = this.live.get(lead.id)?.leadInbox;
    if (own?.length) yield own;
    for (const sender of this.sessions) {
      if (sender.parent !== lead.id) continue;
      const reports = this.live.get(sender.id)?.pendingReports;
      if (reports?.length) yield reports;
    }
  }

  /** @this {import("./hub-util.js").HubThis} */
  leadInboxSize(lead) {
    if (lead.status === "done") return 0;
    let waiting = 0;
    for (const queue of this.leadInboxQueues(lead)) waiting += queue.length;
    return Math.min(waiting, this.team().maxLeadInbox);
  }

  /** @this {import("./hub-util.js").HubThis} */
  drainLeadInbox(lead, { resume = false } = {}) {
    const r = this.live.get(lead.id);
    resume ||= r?.leadInboxResume;
    if (this.stopping || !r || this.get(lead.id) !== lead || lead._killed ||
        (lead.status !== "idle" && !(resume && lead.status === "error")) ||
        (!resume && (lead.asksUser || r.leadInboxHeld)) || r.perms.size || r.drainingLeadInbox ||
        (r.proc && lead.provider !== "claude")) return;
    let queue;
    for (const pending of this.leadInboxQueues(lead)) {
      if (!queue || pending[0].order < queue[0].order) queue = pending;
    }
    if (!queue || this.pausedFor(lead) || this.holdTeam?.(lead.id) || this.runBlock(lead)) return;
    r.drainingLeadInbox = true;
    const item = queue.shift();
    try {
      this.send(lead.id, item.text + (item.board ? this.boardNote(lead.id) : ""), { images: item.images });
    } catch {
      queue.unshift(item);
      return;
    } finally {
      r.drainingLeadInbox = false;
    }

    const sender = item.sender && this.get(item.sender);
    if (sender) {
      // The length guard may replace a teammate on its next turn after its lead has heard the warning.
      if (item.tellsLong && sender.longRun) {
        sender.longRun.told = true;
        this.store.save();
      }
      if (item.board) this.armAutoRemove(sender);
    }
    if (this.get(lead.id)) this.emit("session", this.publicSession(lead));
  }
}
