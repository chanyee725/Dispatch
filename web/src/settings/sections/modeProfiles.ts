// Helpers for the 설정 > 모드별 모델 section (#748): what a mode × role cell shows, which cells changed against what is
// stored, the PUT /api/mode-profiles body, per-model hint keys and the fallback note. React-free so node --test can
// check them. Metadata only: provider, model id, effort, permission mode and short hint text.

export type Cell = { provider: string; model: string | null; effort: string | null; perm: string };
export type Resolved = { provider: string; model: string; effort: string | null; perm: string; source: string; note: string | null };
export type ModeProfiles = {
  modes: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  defaults: Record<string, Record<string, Cell & { fallbacks?: unknown; cross?: boolean }>>;
  /** Built-in hints merged with the user's. */
  hints: Record<string, string>;
  stored: { cells?: Record<string, Record<string, Cell>>; hints?: Record<string, string> };
  grid: Record<string, Record<string, { cell: Cell | null; resolved: Resolved | null; hint: string }>>;
};
/** Local edits: a cell per mode and role; `null` = back to the built-in default. */
export type Edits = Record<string, Record<string, Cell | null>>;

export const HINT_MAX = 40;

const plain = (c: Cell): Cell => ({ provider: c.provider, model: c.model ?? null, effort: c.effort ?? null, perm: c.perm });
export const sameCell = (a: Cell | null | undefined, b: Cell | null | undefined) =>
  !a || !b ? !a && !b : a.provider === b.provider && (a.model ?? null) === (b.model ?? null) && (a.effort ?? null) === (b.effort ?? null) && a.perm === b.perm;

export const storedCell = (p: ModeProfiles, mode: string, role: string): Cell | null => p.stored.cells?.[mode]?.[role] ?? null;
export const defaultCell = (p: ModeProfiles, mode: string, role: string): Cell => {
  const d = p.defaults[mode]?.[role];
  return d ? plain(d) : { provider: 'claude', model: null, effort: null, perm: 'auto' };
};

/** What the user wants stored for a cell: the edit, else nothing when the mode was reset, else what is stored. */
export function wantedCell(p: ModeProfiles, edits: Edits, resets: ReadonlySet<string>, mode: string, role: string): Cell | null {
  const e = edits[mode]?.[role];
  if (e !== undefined) return e && sameCell(e, defaultCell(p, mode, role)) ? null : e;
  return resets.has(mode) ? null : storedCell(p, mode, role);
}

/** What the cell shows: the wanted cell, else the built-in default. */
export const shownCell = (p: ModeProfiles, edits: Edits, resets: ReadonlySet<string>, mode: string, role: string): Cell =>
  wantedCell(p, edits, resets, mode, role) ?? defaultCell(p, mode, role);

/** Whether the row shows something other than what is stored (then the server's resolved note may be stale). */
export const rowChanged = (p: ModeProfiles, edits: Edits, resets: ReadonlySet<string>, mode: string, role: string) =>
  !sameCell(wantedCell(p, edits, resets, mode, role), storedCell(p, mode, role));

/** The changed cells of one mode as a `cells[mode]` patch (`null` = back to default); null when none changed. */
export function modePatch(p: ModeProfiles, edits: Edits, resets: ReadonlySet<string>, mode: string): Record<string, Cell | null> | null {
  const out: Record<string, Cell | null> = {};
  for (const r of p.roles) if (rowChanged(p, edits, resets, mode, r.id)) out[r.id] = wantedCell(p, edits, resets, mode, r.id);
  return Object.keys(out).length ? out : null;
}

/** The hint key for a model: Claude models by id, Codex and Gemini by provider (one hint for the whole catalog). */
export const hintKey = (provider: string, model: string | null) => (provider === 'claude' && model ? model : provider);

/** Changed hints against the merged ones (`null` = back to the built-in text); null when none changed. */
export function hintsPatch(p: ModeProfiles, hintEdits: Record<string, string>): Record<string, string | null> | null {
  const out: Record<string, string | null> = {};
  for (const [k, raw] of Object.entries(hintEdits)) {
    const t = raw.replace(/\s+/g, ' ').trim();
    const custom = p.stored.hints?.[k];
    if (!t) {
      if (custom !== undefined) out[k] = null;
    } else if (t !== (p.hints[k] ?? '')) out[k] = t;
  }
  return Object.keys(out).length ? out : null;
}

/** The hint keys of every model some mode × role cell shows after the edits. */
export function usedHintKeys(p: ModeProfiles, edits: Edits, resets: ReadonlySet<string>): Set<string> {
  const used = new Set<string>();
  for (const m of p.modes)
    for (const r of p.roles) {
      const c = shownCell(p, edits, resets, m.id, r.id);
      used.add(hintKey(c.provider, c.model));
    }
  return used;
}

/**
 * The PUT body for everything changed: every mode's cell patch and the hint patch; null when nothing changed. Hint
 * edits for a model no cell uses any more (edited, then the model was swapped out everywhere) are dropped.
 */
export function saveBody(p: ModeProfiles, edits: Edits, resets: ReadonlySet<string>, hintEdits: Record<string, string>) {
  const cells: Record<string, Record<string, Cell | null>> = {};
  for (const m of p.modes) {
    const patch = modePatch(p, edits, resets, m.id);
    if (patch) cells[m.id] = patch;
  }
  const used = usedHintKeys(p, edits, resets);
  const hints = hintsPatch(p, Object.fromEntries(Object.entries(hintEdits).filter(([k]) => used.has(k))));
  if (!Object.keys(cells).length && !hints) return null;
  return { ...(Object.keys(cells).length ? { cells } : {}), ...(hints ? { hints } : {}) };
}

/** The status line for unsaved edits in modes other than the open one (the open tab's own edits need no line). */
export function dirtyNote(p: ModeProfiles, edits: Edits, resets: ReadonlySet<string>, open: string): string {
  const other = p.modes.find((m) => m.id !== open && modePatch(p, edits, resets, m.id));
  return other ? `${other.name} 모드에 저장하지 않은 변경이 있어요.` : '';
}

/**
 * The server's fallback note split for display: `대신 <model>: <reasons>` gives the model (its label when listed) and
 * the reasons unchanged; a cross-check note (the implementer's model reused) is informational, not a warning.
 */
export function fallbackNote(note: string | null | undefined, label: (id: string) => string | undefined): { model: string | null; text: string; info: boolean } | null {
  if (!note) return null;
  const m = /^대신 ([^:]+): (.*)$/s.exec(note);
  if (m) return { model: label(m[1]) ?? m[1], text: m[2], info: false };
  return { model: null, text: note, info: note.startsWith('구현자와 다른 모델이 없어') };
}
