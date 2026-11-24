import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHub } from '../server/events.js';

const fakeClient = () => {
  const req = new EventEmitter();
  const res = { out: '', writeHead() {}, write(s) { this.out += s; }, end() {} };
  return { req, res };
};

test('hub: broadcast reaches every attached client until it closes', () => {
  const hub = createHub();
  const a = fakeClient();
  const b = fakeClient();
  hub.attach(a.req, a.res);
  hub.attach(b.req, b.res);
  hub.broadcast('file', { id: 1 });
  assert.match(a.res.out, /event: file\ndata: \{"id":1\}/);
  assert.match(b.res.out, /event: file\ndata: \{"id":1\}/);
  a.req.emit('close');
  hub.broadcast('file', { id: 2 });
  assert.doesNotMatch(a.res.out, /"id":2/);
  assert.match(b.res.out, /"id":2/);
  b.req.emit('close');
  assert.equal(hub.size, 0);
});
