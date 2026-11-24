import ELK from 'elkjs/lib/elk.bundled.js'
const elk = new ELK()
const W = 120, H = 48
function toElk(n) {
  const c = (n.children ?? []).map(toElk)
  return c.length ? { id: n.id, children: c, layoutOptions: { 'elk.padding': '[top=36,left=16,bottom=16,right=16]' } } : { id: n.id, width: W, height: H }
}
export async function layout(g) {
  const graph = {
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.spacing.nodeNode': '30', 'elk.layered.spacing.nodeNodeBetweenLayers': '60' },
    children: g.root.children.map(toElk),
    edges: g.edges.map((e, i) => ({ id: 'e' + i, sources: [e.from], targets: [e.to], labels: e.label ? [{ text: e.label, width: e.label.length * 7, height: 14 }] : [] })),
  }
  return elk.layout(graph)
}
