import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { stateLayout } from "./paths.js";

// Persists session metadata and usage totals to <project>/.atelier/state.json (paths.js). Transcripts are
// never written: the Hub keeps them in memory only. Free text that came from a person or a CLI is
// kept in memory and left out of the file: `last` (a clip of the latest reply), `prompt` (the role
// prompt, read from the role again after a restart), `error` (CLI error text) and `ask` (the question
// a reply ends with, #886).
const MEMORY_ONLY = ["last", "prompt", "error", "ask"];

export function diskView(data) {
  const sessions = {};
  for (const [id, s] of Object.entries(data.sessions || {})) {
    const out = { ...s };
    for (const k of MEMORY_ONLY) delete out[k];
    sessions[id] = out;
  }
  // Limit tickets carry clips of the lead's and teammates' last replies and task notes; those stay
  // in memory too. So do task notes on the board (free text a lead writes).
  const tickets = {};
  for (const [id, t] of Object.entries(data.tickets || {})) {
    const { leadLast, ...out } = t;
    if (Array.isArray(t.team)) out.team = t.team.map(({ last, ...m }) => m);
    if (Array.isArray(t.items)) out.items = t.items.map(({ note, ...i }) => i);
    tickets[id] = out;
  }
  const tasks = {};
  for (const [id, t] of Object.entries(data.tasks || {})) {
    const { note, ...out } = t;
    tasks[id] = out;
  }
  return { ...data, sessions, ...(data.tickets && { tickets }), ...(data.tasks && { tasks }) };
}

export class Store {
  /** `layout` (paths.js stateLayout) names the folder; a not-yet-moved .dispatch/ passes its own. */
  constructor(root, layout = stateLayout(root)) {
    this.layout = layout;
    this.file = layout.stateFile;
    this.data = { seq: 0, sessions: {}, daily: {}, settings: { guard: { enabled: true, five: 0.9, seven: 0.85 }, enabled: { claude: false, openai: false, gemini: false } } };
    this.timer = null;
    this.closed = false;
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8"));
      for (const x of Object.values(saved.sessions || {})) { x.last ??= ""; x.error ??= null; }
      for (const t of Object.values(saved.tasks || {})) t.note ??= "";
      this.data = { ...this.data, ...saved, settings: { ...this.data.settings, ...saved.settings } };
    } catch { /* first run */ }
    return this.data;
  }

  save() {
    // After close() nothing more is written: a child that exits late must not race the next server's writes
    // to the same state file (or a test's cleanup of the folder).
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(e => console.error("dispatch state:", e.code ?? e.name)), 500);
  }

  /** Writes now. Writes run one at a time, so two never share the temp file. */
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const run = this.writing.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      await writeFile(tmp, JSON.stringify(diskView(this.data), null, 2));
      await rename(tmp, this.file);
    });
    this.writing = run;
    return run;
  }

  /** The last write, then no more: a pending save is cancelled and later save() calls do nothing. */
  close() {
    const last = this.flush();
    this.closed = true;
    return last;
  }

  // Adds a usage delta to today's bucket.
  addDaily(model, role, delta) {
    const day = new Date().toLocaleDateString("sv-SE");
    const d = (this.data.daily[day] ||= { cost: 0, models: {}, roles: {} });
    d.cost += delta.cost || 0;
    const m = (d.models[model] ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
    for (const k of ["input", "output", "cacheRead", "cacheWrite", "cost"]) m[k] += delta[k] || 0;
    d.roles[role] = (d.roles[role] || 0) + (delta.cost || 0);
    this.save();
  }
}
