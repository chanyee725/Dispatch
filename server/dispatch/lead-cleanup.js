import { resolveCommit } from "./git.js";
import { taskIssue } from "./task-close.js";

const SHA = /^[0-9a-f]{7,40}$/i;

function hasCurrentMergeProof(card) {
  const proof = card.mergeCheck;
  if (proof?.ok !== true || proof.via === "issue") return false;
  const candidate = card.commit ?? null;
  if (proof.via === "pr") {
    // An issue-linked PR can close the card, but cannot prove a named commit or branch merged.
    return candidate === null && proof.candidate === null && proof.issue != null && proof.issue === taskIssue(card);
  }
  if (SHA.test(candidate ?? "")) {
    // Older successful checks stored the resolved SHA without the original candidate.
    return proof.commit?.toLowerCase().startsWith(candidate.toLowerCase()) === true;
  }
  return candidate !== null && proof.candidate === candidate && !!proof.commit;
}

// Lead lifecycle is separate from the teammate cleanup that follows report delivery.
export class LeadCleanup {
  constructor(hub) {
    this.hub = hub;
    this.pending = new Map();
    this.config = hub.team();
    for (const event of ["session", "tasks", "tickets", "removed"]) {
      hub.on(event, () => this.reconcile());
    }
  }

  cards(id) {
    return Object.values(this.hub.store.data.tasks || {}).filter(t => t.lead === id);
  }

  branchCandidates(id) {
    return this.cards(id).filter(t => t.commit && !SHA.test(t.commit))
      .map(card => ({ card, ref: card.commit, sha: card.mergeCheck?.commit }));
  }

  /** Refuse unsafe cleanup even when a lead requests finish explicitly. */
  blocked(lead, { explicit = false, endingTurn = false } = {}) {
    if (!lead?.canSpawn) return "not-lead";
    const { hub } = this;
    if (this.stopped) return "status";
    const runtime = hub.live.get(lead.id);
    if (lead.asksUser || runtime?.perms.size || !hub.leadInboxQueues(lead).next().done ||
        runtime?.leadInboxHeld || runtime?.drainingLeadInbox || lead.interrupted || hub.holdTeam?.(lead.id)) return "waiting";
    if (lead.status !== "idle" && !(endingTurn && lead.status === "running")) return "status";
    if (Object.values(hub.store.data.tickets || {}).some(t => t.lead === lead.id && t.status === "open")) return "ticket";

    const cards = this.cards(lead.id);
    if (cards.some(t => t.stage !== "done" || !hasCurrentMergeProof(t))) return "board";
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
    if (lead.status === "running") {
      job.reportAfterTurn = lead.turns ?? 0;
      if (lead.provider === "claude") {
        const runtime = this.hub.rt(id);
        runtime.finishReportAfterSeq = runtime.seq;
      }
    }
    this.refresh(lead);
    return { ok: true };
  }

  cancel(id) {
    const job = this.pending.get(id);
    if (job) clearTimeout(job.timer);
    this.pending.delete(id);
  }

  settingsChanged() {
    this.config = this.hub.team();
    this.reconcile();
  }

  automaticEnabled() {
    // A save in progress can suspend cleanup immediately, and only a successful save can enable it.
    return this.config.autoRemoveFinishedLeads === true && this.hub.team().autoRemoveFinishedLeads === true;
  }

  stop() {
    this.stopped = true;
    for (const id of this.pending.keys()) this.cancel(id);
  }

  scheduled(lead) {
    const job = this.pending.get(lead.id);
    return !!job?.timer && !this.blocked(lead, { explicit: job.explicit }) &&
      (job.explicit || this.automaticEnabled());
  }

  reconcile() {
    if (!this.pending.size && !this.automaticEnabled()) return;
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
    if ((!explicit && !this.automaticEnabled()) ||
        this.blocked(lead, { explicit, endingTurn: explicit && job.reportAfterTurn !== undefined })) {
      this.cancel(id);
      return;
    }
    if (lead.status !== "idle" || job?.timer || job?.checking) return;
    const runtime = this.hub.live.get(id);
    // Keep the report requirement across cancelled jobs and later automatic checks.
    if (runtime?.finishReportAfterSeq !== undefined) {
      if ((runtime.claudeFinalSeq ?? 0) <= runtime.finishReportAfterSeq) {
        this.cancel(id);
        return;
      }
      delete runtime.finishReportAfterSeq;
    }
    if (job?.reportAfterTurn !== undefined) {
      if ((lead.turns ?? 0) <= job.reportAfterTurn || !runtime?.lastText?.trim()) {
        this.cancel(id);
        return;
      }
      delete job.reportAfterTurn;
    }
    if (!job) this.pending.set(id, job = { lead, timer: null });
    this.checkCandidates(id, job, () => {
      job.timer = setTimeout(() => this.expire(id, job), this.config.autoRemoveGraceSec * 1000);
      job.timer.unref?.();
    });
  }

  checkCandidates(id, job, proceed) {
    const candidates = this.branchCandidates(id);
    if (!candidates.length) return proceed();

    job.checking = Promise.all(candidates.map(({ ref }) => resolveCommit(this.hub.root, ref))).then(tips => {
      if (this.pending.get(id) !== job) return;
      job.checking = null;
      const current = this.branchCandidates(id);
      if (!this.eligible(id, job) || current.length !== candidates.length ||
          candidates.some(({ card, ref, sha }, i) => !tips[i] || tips[i] !== sha ||
            !current.some(c => c.card === card && c.ref === ref && c.sha === sha))) {
        this.cancel(id);
        return;
      }
      proceed();
    });
  }

  eligible(id, job) {
    return this.hub.get(id) === job.lead && !this.blocked(job.lead, { explicit: job.explicit }) &&
      (job.explicit || this.automaticEnabled());
  }

  expire(id, job) {
    if (this.pending.get(id) !== job) return;
    if (!this.eligible(id, job)) {
      this.cancel(id);
      return;
    }
    this.checkCandidates(id, job, () => this.finish(id, job));
  }

  finish(id, job) {
    const { hub } = this;
    job.removing = true;
    try {
      // An editor can save an ignored file after any Git status check, so retain the worktrees.
      const children = hub.sessions.filter(s => s.parent === id);
      for (const child of children) hub.remove(child.id, { keepWorktree: true });
      hub.remove(id, { keepWorktree: true });
      hub.emit("leadFinished", { id, reason: job.explicit ? "explicit" : "automatic" });
    } finally {
      this.cancel(id);
    }
  }
}
