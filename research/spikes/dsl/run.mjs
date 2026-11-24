import fs from 'node:fs'
import { parse } from './parser.mjs'; import { layout } from './layout.mjs'; import { toSvg } from './render.mjs'
const g = parse(fs.readFileSync(new URL('./sample.dsl', import.meta.url), 'utf8'))
console.log('nodes', g.nodes.size, 'edges', g.edges.length, 'errors', g.errors.length)
let t = performance.now(); const L = await layout(g); console.log('elk ms', (performance.now() - t).toFixed(1))
fs.writeFileSync(new URL('./out.svg', import.meta.url), toSvg(g, L)); console.log('wrote out.svg')
// scale test
const big = Array.from({ length: 300 }, (_, i) => `N${i} > N${(i * 7 + 3) % 300}`).join('\n')
const gb = parse(big); t = performance.now(); await layout(gb); console.log('300-node elk ms', (performance.now() - t).toFixed(0))
