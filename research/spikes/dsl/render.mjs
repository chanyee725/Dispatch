const COLORS = { blue: '#cfe2ff', red: '#f8d7da', green: '#d1e7dd', yellow: '#fff3cd', purple: '#e2d9f3', orange: '#ffe5d0' }
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
export function toSvg(g, L) {
  const out = []
  const walk = (el, ox, oy) => {
    for (const c of el.children ?? []) {
      const n = g.nodes.get(c.id), x = c.x + ox, y = c.y + oy, grp = c.children?.length
      const fill = COLORS[n.props.color] ?? (grp ? '#f4f4f4' : '#fff')
      out.push(`<rect x="${x}" y="${y}" width="${c.width}" height="${c.height}" rx="${grp ? 10 : 6}" fill="${fill}" stroke="#555"${grp ? ' stroke-dasharray="4"' : ''}/>`)
      const icon = n.props.icon ? `[${n.props.icon}] ` : ''
      out.push(`<text x="${grp ? x + 8 : x + c.width / 2}" y="${grp ? y + 20 : y + c.height / 2 + 4}" text-anchor="${grp ? 'start' : 'middle'}" font-family="sans-serif" font-size="12">${esc(icon + n.label)}</text>`)
      walk(c, x, y)
    }
  }
  walk(L, 0, 0)
  // ELK gotcha: edge points are relative to the lowest common ancestor of source/target, not the root.
  const abs = new Map(); const index = (el, ox, oy) => { for (const c of el.children ?? []) { abs.set(c.id, { x: c.x + ox, y: c.y + oy }); index(c, c.x + ox, c.y + oy) } }
  index(L, 0, 0)
  const chain = id => { const r = []; for (let n = g.nodes.get(id); n; n = g.nodes.get(n.parent)) r.unshift(n.id); return r }
  const lcaOffset = (a, b) => { const A = chain(a), B = chain(b); let k = 0; while (k < A.length - 1 && k < B.length - 1 && A[k] === B[k]) k++; return k > 0 ? abs.get(A[k - 1]) : { x: 0, y: 0 } }
  // ELK edge coords are relative to the container; with INCLUDE_CHILDREN they are root-relative here.
  L.edges.forEach((e, i) => {
    const s = e.sections?.[0]; if (!s) return
    const o = lcaOffset(e.sources[0], e.targets[0])
    const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(p => ({ x: p.x + o.x, y: p.y + o.y }))
    out.push(`<polyline points="${pts.map(p => p.x + ',' + p.y).join(' ')}" fill="none" stroke="#333" marker-end="url(#a)"/>`)
    const l = e.labels?.[0]; if (l) out.push(`<text x="${l.x + o.x}" y="${l.y + o.y + 11}" font-family="sans-serif" font-size="11" fill="#06c">${esc(l.text)}</text>`)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width + 20}" height="${L.height + 20}" viewBox="-10 -10 ${L.width + 20} ${L.height + 20}"><defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8z"/></marker></defs>${out.join('')}</svg>`
}
