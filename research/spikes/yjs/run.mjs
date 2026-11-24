import * as Y from 'yjs'
const a = new Y.Doc(), b = new Y.Doc()
// in-memory "network": relay updates both ways, with an offline window
let online = true, queue = []
const relay = (from, to) => from.on('update', (u, origin) => { if (origin === 'remote') return; online ? Y.applyUpdate(to, u, 'remote') : queue.push([to, u]) })
relay(a, b); relay(b, a)
const ma = a.getMap('nodes'), mb = b.getMap('nodes'), ta = a.getText('dsl'), tb = b.getText('dsl')
ma.set('A', { x: 0, y: 0 }); mb.set('B', { x: 100, y: 0 })
ta.insert(0, 'A > B'); tb.insert(0, '// hi\n')
online = false
ma.set('A', { x: 10, y: 10 }); mb.set('A', { x: 99, y: 99 })   // concurrent conflict on same key
ta.insert(ta.length, ': x'); tb.insert(tb.length, ': y')
online = true; for (const [to, u] of queue) Y.applyUpdate(to, u, 'remote')
const eq = JSON.stringify(ma.toJSON()) === JSON.stringify(mb.toJSON()) && ta.toString() === tb.toString()
console.log('converged:', eq, ma.toJSON(), JSON.stringify(ta.toString()))
console.log('state bytes', Y.encodeStateAsUpdate(a).length)
