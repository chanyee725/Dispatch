import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Persists session metadata and usage totals only. Transcripts stay in memory (and in each CLI's own history).
export class Store {
  constructor(root) {
    this.file = path.join(root, ".dispatch", "state.json");
    this.data = { seq: 0, sessions: {}, daily: {}, settings: { guard: { enabled: true, five: 0.9, seven: 0.85 }, enabled: { claude: false, openai: false } } };
    this.timer = null;
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8"));
      this.data = { ...this.data, ...saved, settings: { ...this.data.settings, ...saved.settings } };
    } catch { /* first run */ }
    return this.data;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }

  async flush() {
    clearTimeout(this.timer);
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    await writeFile(tmp, JSON.stringify(this.data, null, 2));
    await rename(tmp, this.file);
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
