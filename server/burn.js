// Cost burn rate per session: dollars per hour over the last 30 minutes, and a warning when a
// session spends far more than its team or has run long on a large context.
//
// Only numbers are kept: an in-memory series of (time, cumulative cost) per session, and each
// session's cost per day in the store's daily buckets (id → { name, role, cost }) so the usage page
// can say which sessions made a day expensive. No transcript text is stored.

export const WINDOW = 30 * 60e3; // rate window
export const MIN_SPAN = 5 * 60e3; // shorter than this is too little to call a rate
export const SPIKE = 3; // × the team median
export const SPIKE_FLOOR = 1; // $/h below which nothing counts as a spike
export const LONG_CTX = 0.6; // context share …
export const LONG_AGE = 3 * 3600e3; // … and age of a long-lived session

/** Median of a list of numbers; null when empty. */
export function median(xs) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Dollars per hour from a series of { t, cost } samples (cumulative cost, oldest first).
 * The cost at the window start is the last sample at or before it; a series younger than the
 * window counts from its first sample. `perHour` is null while the series spans less than MIN_SPAN;
 * no series at all (a Codex or Gemini session, which reports no cost) returns null.
 */
export function rateOf(samples, now, window = WINDOW) {
  if (!samples?.length) return null;
  const start = now - window;
  let base = samples[0];
  if (base.t <= start) {
    base = { t: start, cost: base.cost };
    for (const p of samples) if (p.t <= start) base.cost = p.cost; else break;
  }
  const span = now - base.t;
  if (span < MIN_SPAN) return { perHour: null, windowMin: Math.round(span / 60e3) };
  const spent = samples.at(-1).cost - base.cost;
  return { perHour: Math.round(Math.max(0, spent) / span * 3600e3 * 100) / 100, windowMin: Math.round(span / 60e3) };
}

/**
 * Why a session's spending deserves a look, as codes the UI turns into words:
 * `spike` (≥ SPIKE × the team median $/h) and `longLived` (context ≥ LONG_CTX and running ≥ LONG_AGE).
 * `advice: "swapLead"` asks for a fresh lead session when the session is a lead.
 */
export function warnOf(s, perHour, teamMedian, now) {
  if (s.status === "done") return null;
  const reasons = [];
  const out = {};
  if (perHour != null && perHour >= SPIKE_FLOOR && teamMedian && perHour >= SPIKE * teamMedian) {
    reasons.push("spike");
    out.ratio = Math.round(perHour / teamMedian * 10) / 10;
    out.medianPerHour = teamMedian;
  }
  const ctxShare = s.ctxWindow ? s.ctx / s.ctxWindow : 0;
  const age = now - s.startedAt;
  if (ctxShare >= LONG_CTX && age >= LONG_AGE) {
    reasons.push("longLived");
    out.ctxShare = Math.round(ctxShare * 100) / 100;
    out.hours = Math.floor(age / 3600e3);
  }
  if (!reasons.length) return null;
  return { reasons, ...out, advice: s.canSpawn ? "swapLead" : null };
}

export class Burn {
  constructor(store, now = () => Date.now()) {
    this.store = store;
    this.now = now;
    this.series = new Map(); // id → [{ t, cost }]
    this.sent = new Map(); // id → last { burn, burnWarn } handed out, as JSON
  }

  /** Records a session's current cost; a rise is also added to today's bucket for that session. */
  observe(s) {
    if (typeof s.cost !== "number") return;
    const t = this.now();
    const list = this.series.get(s.id);
    if (!list) { this.series.set(s.id, [{ t, cost: s.cost }]); return; }
    const last = list.at(-1);
    if (s.cost === last.cost) return;
    if (s.cost > last.cost) this.addDay(s, s.cost - last.cost, t);
    list.push({ t, cost: s.cost });
    // Keep one sample at or before the window start, so the base cost stays known.
    while (list.length > 1 && list[1].t <= t - WINDOW) list.shift();
  }

  addDay(s, delta, t) {
    const day = new Date(t).toLocaleDateString("sv-SE");
    const d = (this.store.data.daily[day] ||= { cost: 0, models: {}, roles: {} });
    const e = ((d.sessions ||= {})[s.id] ||= { name: s.name, role: s.role, cost: 0 });
    e.cost += delta;
    this.store.save();
  }

  /** `{ burn, burnWarn }` for one session at the current time, judged against every listed session. */
  compute(s, sessions) {
    this.observe(s);
    const now = this.now();
    const live = new Set(sessions.map(x => x.id));
    for (const id of this.series.keys()) if (!live.has(id)) this.series.delete(id);
    for (const id of this.sent.keys()) if (!live.has(id)) this.sent.delete(id);
    const rates = sessions.map(x => rateOf(this.series.get(x.id), now)?.perHour).filter(r => r > 0);
    const burn = rateOf(this.series.get(s.id), now);
    return { burn, burnWarn: warnOf(s, burn?.perHour ?? null, median(rates), now) };
  }

  /** Same as compute, and remembers what was handed out so `due` can tell when time alone changed it. */
  fields(s, sessions) {
    const f = this.compute(s, sessions);
    this.sent.set(s.id, JSON.stringify(f));
    return f;
  }

  /**
   * Sessions whose burn or burnWarn differs from what was last handed out. Claude's cost moves only
   * when a turn ends, so an idle session sends no events; without a periodic check its rate would
   * stay at the peak it had right after its last turn.
   */
  due(sessions) {
    return sessions.filter(s => JSON.stringify(this.compute(s, sessions)) !== this.sent.get(s.id));
  }
}
