// Unified patch (git diff / git show) split into files with numbered lines. Pure, shared by the session sheet's
// 변경사항 tab and the live view's 작업 보기 (#905).

export type Line = { kind: 'add' | 'del' | 'ctx' | 'hunk'; text: string; old?: number; new?: number };
export type FileDiff = { path: string; commit?: string; add: number; del: number; lines: Line[]; binary: boolean };

/** Splits a unified patch (git diff or git show) into files with numbered lines. */
export function parsePatch(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null, commit: string | undefined, o = 0, n = 0;
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('commit ')) { commit = raw.slice(7); continue; }
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
    if (head) { cur = { path: head[2]!, commit, add: 0, del: 0, lines: [], binary: false }; files.push(cur); continue; }
    if (!cur) continue;
    if (raw.startsWith('Binary files')) { cur.binary = true; continue; }
    if (/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity |rename |old mode|new mode)/.test(raw)) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (h) { o = +h[1]!; n = +h[2]!; cur.lines.push({ kind: 'hunk', text: h[3]!.trim() }); continue; }
    if (raw.startsWith('+')) { cur.lines.push({ kind: 'add', text: raw.slice(1), new: n++ }); cur.add++; }
    else if (raw.startsWith('-')) { cur.lines.push({ kind: 'del', text: raw.slice(1), old: o++ }); cur.del++; }
    else if ((raw.startsWith(' ') || raw === '') && cur.lines.length) cur.lines.push({ kind: 'ctx', text: raw.slice(1), old: o++, new: n++ });
  }
  return files;
}
