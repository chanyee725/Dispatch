// Tiny Eraser-like DSL parser (hand-written, line based).
//   Group [icon: aws, color: blue] { A [icon: x, color: y]; B }
//   A > B: label     (also <, <>, -, --)
export function parse(src) {
  const nodes = new Map(), edges = [], errors = []
  const root = { id: '$root', children: [], props: {} }
  const stack = [root]
  const ensure = (name, parent) => {
    let n = nodes.get(name)
    if (!n) { n = { id: name, label: name, props: {}, parent: parent?.id ?? '$root' }; nodes.set(name, n); parent?.children?.push(n) }
    return n
  }
  const parseProps = s => Object.fromEntries((s || '').split(',').map(p => p.split(':').map(x => x.trim())).filter(p => p[0]))
  src.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (!line) return
    if (line === '}') { if (stack.length > 1) stack.pop(); else errors.push({ line: i + 1, msg: 'unmatched }' }); return }
    const cur = stack[stack.length - 1]
    const edge = line.match(/^(.+?)\s*(<>|>|<|--|-)\s*([^:]+?)\s*(?::\s*(.*))?$/)
    if (edge && !/[\[{]/.test(edge[1] + edge[3])) {
      const a = ensure(edge[1].trim(), cur), b = ensure(edge[3].trim(), cur)
      edges.push({ from: a.id, to: b.id, op: edge[2], label: edge[4] ?? '' }); return
    }
    const decl = line.match(/^([^\[{]+?)\s*(?:\[([^\]]*)\])?\s*(\{)?$/)
    if (!decl) { errors.push({ line: i + 1, msg: 'cannot parse: ' + line }); return }
    const n = ensure(decl[1].trim(), cur); Object.assign(n.props, parseProps(decl[2]))
    if (decl[3]) { n.children = n.children ?? []; stack.push(n) }
  })
  return { nodes, edges, root, errors }
}
