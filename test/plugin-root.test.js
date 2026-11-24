// The "dispatch" Claude Code plugin installs from the repository root (marketplace source "./", as the
// standalone Dispatch did), so the plugin cache holds the server too. Its manifest points at plugin/skills and
// plugin/hooks/hooks.json, whose commands run ${CLAUDE_PLUGIN_ROOT}/hooks/*.mjs: small entry files at the root
// that load the real hooks. No server or CLI is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

test('root marketplace and plugin manifest keep the dispatch identity and agree on the version', () => {
  const mp = json('.claude-plugin/marketplace.json');
  assert.equal(mp.name, 'dispatch');
  assert.deepEqual(mp.plugins.map((p) => [p.name, p.source]), [['dispatch', './']]);
  const pl = json('.claude-plugin/plugin.json');
  assert.equal(pl.name, 'dispatch');
  const version = json('package.json').version;
  for (const p of ['.claude-plugin/plugin.json', 'plugin/.claude-plugin/plugin.json', 'plugin/.codex-plugin/plugin.json']) assert.equal(json(p).version, version, p);
  assert.ok(existsSync(join(root, pl.skills, 'dispatch', 'SKILL.md')));
  for (const s of ['dispatch', 'dispatch-team', 'dispatch-update']) assert.ok(readdirSync(join(root, pl.skills)).includes(s), s);
  const hooks = json(pl.hooks);
  for (const cmd of JSON.stringify(hooks.hooks).match(/\$\{CLAUDE_PLUGIN_ROOT\}\/[^"\\]+/g)) {
    const rel = cmd.replace('${CLAUDE_PLUGIN_ROOT}/', '');
    assert.ok(existsSync(join(root, rel)), `${rel} at the repository root`);
    assert.ok(existsSync(join(root, 'plugin', rel)), `${rel} under plugin/`);
  }
});

test('root main-delegates entry runs the real hook: it waits for the hook input on stdin, then exits 0 silently', async () => {
  const child = spawn(process.execPath, [join(root, 'hooks', 'main-delegates.mjs')], { env: { ...process.env, DISPATCH_SESSION: '', DISPATCH_URL: '' } });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  const exited = new Promise((r) => child.on('exit', r));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(child.exitCode, null, 'reading its input (an entry file that loads nothing would have exited)');
  child.stdin.end('{}');
  assert.equal(await exited, 0);
  assert.equal(out, '');
});

test('root long-session entry runs the real hook: a long session gets the hand-over note', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dispatch-plugin-root-'));
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sessions: [{ id: 'k1', longRun: { mtok: 9 } }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const env = { ...process.env, HOME: home, DISPATCH_URL: `http://127.0.0.1:${server.address().port}`, DISPATCH_SESSION: 'k1' };
    const child = spawn(process.execPath, [join(root, 'hooks', 'long-session.mjs')], { env });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stdin.end('{}');
    assert.equal(await new Promise((r) => child.on('exit', r)), 0);
    assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /Dispatch 훅/);
  } finally {
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
});
