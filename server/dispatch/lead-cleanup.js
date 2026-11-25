// Lead lifecycle is separate from the teammate cleanup that follows report delivery.
export class LeadCleanup {
  constructor(hub) {
    this.hub = hub;
    this.pending = new Map();
    for (const event of ["session", "tasks", "tickets", "removed"]) {
      hub.on(event, () => this.reconcile());
    }
  }

  /** Refuse unsafe cleanup even when a lead requests finish explicitly. */
  blocked(lead, { explicit = false, endingTurn = false } = {}) {
    if (!lead?.canSpawn) return "not-lead";
    const { hub } = this;
    const runtime = hub.live.get(lead.id);
    if (lead.asksUser || runtime?.perms.size || runtime?.leadInbox.length ||
        runtime?.leadInboxHeld || lead.interrupted || hub.holdTeam?.(lead.id)) return "waiting";
    if (lead.status !== "idle" && !(endingTurn && lead.status === "running")) return "status";
    if (Object.values(hub.store.data.tickets || {}).some(t => t.lead === lead.id && t.status === "open")) return "ticket";

    const cards = Object.values(hub.store.data.tasks || {}).filter(t => t.lead === lead.id);
    if (cards.some(t => t.stage !== "done" || t.mergeCheck?.ok !== true || t.mergeCheck.via === "issue")) return "board";
    // Explicit finish can close a lead whose work did not require a board card.
    if (!explicit && !cards.length) return "board";
    const sessions = hub.sessions;
    const children = sessions.filter(s => s.parent === lead.id);
    if (children.some(s => s.status !== "done" || s.canSpawn || sessions.some(c => c.parent === s.id))) return "team";
    return null;
  }

  request(id) {
    const lead = this.hub.get(id);
    const blocked = this.blocked(lead, { explicit: true, endingTurn: true });
    if (blocked) return { ok: false, reason: blocked };

    let job = this.pending.get(id);
    if (!job) this.pending.set(id, job = { lead, timer: null });
    // Promote an already armed automatic job without extending its grace period.
    job.explicit = true;
    this.refresh(lead);
    return { ok: true };
  }

  cancel(id) {
    const job = this.pending.get(id);
    if (job) clearTimeout(job.timer);
    this.pending.delete(id);
  }

  reconcile() {
    for (const [id, job] of this.pending) {
      if (this.hub.get(id) !== job.lead) this.cancel(id);
    }
    for (const lead of this.hub.sessions) {
      if (lead.canSpawn) this.refresh(lead);
    }
  }

  refresh(lead) {
    const id = lead.id;
    let job = this.pending.get(id);
    if (job?.removing) return;
    const explicit = job?.explicit === true;
    // A finish request made inside a running turn waits until that turn posts its final answer.
    if (this.blocked(lead, { explicit, endingTurn: explicit && !job.timer }) ||
        (!explicit && this.hub.team().autoRemoveFinishedLeads !== true)) {
      this.cancel(id);
      return;
    }
    if (lead.status !== "idle" || job?.timer) return;
    if (!job) this.pending.set(id, job = { lead, timer: null });
    job.timer = setTimeout(() => this.expire(id, job), this.hub.team().autoRemoveGraceSec * 1000);
    job.timer.unref?.();
  }

  expire(id, job) {
    if (this.pending.get(id) !== job) return;
    const { hub } = this;
    if (hub.get(id) !== job.lead || this.blocked(job.lead, { explicit: job.explicit }) ||
        (!job.explicit && hub.team().autoRemoveFinishedLeads !== true)) {
      this.cancel(id);
      return;
    }

    job.removing = true;
    try {
      // Hub.remove removes session records synchronously. The strict worktree check completes separately.
      const children = hub.sessions.filter(s => s.parent === id);
      for (const child of children) hub.remove(child.id, { strict: true });
      hub.remove(id, { strict: true });
      hub.emit("leadFinished", { id, reason: job.explicit ? "explicit" : "automatic" });
    } finally {
      this.cancel(id);
    }
  }
}
