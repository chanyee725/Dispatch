// Status label of an agent session (E536, #653): shared/dispatch/agent-status.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentStatus, AGENT_STATUS as S } from '../shared/dispatch/agent-status.ts';

const run = (tool, target = null) => agentStatus({ status: 'running', tool, target });
const bash = (command) => ({ name: 'Bash', text: JSON.stringify({ command }) });

test('agentStatus: not working -> null; a permission request or a wait -> 대기 중', () => {
  for (const status of ['idle', 'error', 'stopped', undefined, null]) assert.equal(agentStatus({ status }), null);
  assert.equal(agentStatus({ status: 'waiting', tool: bash('curl -X PUT /api/file') }), S.waiting);
  assert.equal(run({ name: 'Monitor', text: '{}' }), S.waiting);
  assert.equal(run(bash('sleep 5')), S.waiting);
});

test('agentStatus: between calls it follows what the session last edited', () => {
  assert.equal(run(null, 'diagram'), S.thinkDiagram);
  assert.equal(run(null, 'doc'), S.writeDoc);
  assert.equal(run(null, 'table'), S.writeTable);
  assert.equal(run(null), S.writeDoc);
  assert.equal(agentStatus({ status: 'starting' }), S.writeDoc);
});

test('agentStatus: reading code vs reading the document', () => {
  assert.equal(run({ name: 'Read', text: '{"file_path":"/x/server/a.js"}' }), S.readCode);
  assert.equal(run({ name: 'Grep', text: '{"pattern":"foo"}' }), S.readCode);
  assert.equal(run(bash('sed -n 1,40p server/cursor/index.js')), S.readCode);
  assert.equal(run({ name: 'Read', text: '{"file_path":"/w/plan.dpx.json"}' }, 'diagram'), S.thinkDiagram);
  assert.equal(run(bash("curl -s 'http://127.0.0.1:4001/api/file?path=a%2Fplan.dpx.json'"), 'diagram'), S.thinkDiagram);
  assert.equal(run(bash("curl -s 'http://127.0.0.1:4001/api/file?path=a%2Fplan.dpx.json'"), 'doc'), S.writeDoc);
});

test('agentStatus: writing a diagram, a table or text', () => {
  const put = (body) => bash(`curl -s -X PUT -H 'x-drawing: 1' 'http://127.0.0.1:4001/api/file?path=plan.dpx.json' -d '${body}'`);
  assert.equal(run(put('{"blocks":[{"id":"b1","code":"A > B"}]}')), S.writeDiagram);
  assert.equal(run(put('{"document":{"type":"doc","content":[{"type":"table","content":[]}]}}')), S.writeTable);
  assert.equal(run(put('{"document":{"type":"doc","content":[{"type":"paragraph"}]},"canvas":{"elements":[]},"blocks":[]}')), S.writeDoc);
  assert.equal(run({ name: 'Edit', text: '{"file_path":"/w/plan.dpx.json","old_string":"x","new_string":"y"}' }, 'diagram'), S.writeDiagram);
  assert.equal(run({ name: 'Edit', text: '{"file_path":"/w/plan.dpx.json","old_string":"x","new_string":"y"}' }), S.writeDoc);
  assert.equal(run({ name: 'edit', text: 'update /w/plan.dpx.json' }, 'table'), S.writeTable);
  assert.equal(run({ name: 'mcp__drawing__write_file', text: '{"path":"plan.dpx.json","code":"flowchart"}' }), S.writeDiagram);
});

test('agentStatus: other work', () => {
  assert.equal(run({ name: 'Edit', text: '{"file_path":"/x/server/a.js"}' }), S.writeCode);
  assert.equal(run(bash('npm test')), S.working);
  assert.equal(run({ name: 'WebSearch', text: '{}' }), S.working);
  for (const v of Object.values(S)) assert.ok(v.length <= 12, v);
});
