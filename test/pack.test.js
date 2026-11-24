import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packBundle } from '../scripts/pack.mjs';

function fakeRoot({ version = '1.2.3', withPublic = true, withStart = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pack-src-'));
  const put = (rel, text = 'x') => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text, { mode: rel.endsWith('.sh') ? 0o755 : 0o644 });
  };
  put('package.json', JSON.stringify({ name: 'drawing', version, type: 'module', engines: { node: '>=22' }, devDependencies: { vite: '1' } }));
  put('NOTICE.md');
  put('server/index.js');
  put('server/node_modules/dep/index.js');
  put('shared/dispatch/ask.ts');
  put('plugin/.claude-plugin/plugin.json', JSON.stringify({ name: 'atelier', version: '0.0.0' }));
  put('plugin/.codex-plugin/plugin.json', JSON.stringify({ name: 'atelier', version: '0.0.0', skills: './skills/' }));
  put('plugin/hooks/hooks.json', '{}');
  put('plugin/skills/atelier-setup/SKILL.md');
  for (const f of ['restart.sh', 'stop.sh']) {
    put(`plugin/skills/atelier-setup/scripts/${f}`, readFileSync(new URL(`../plugin/skills/atelier-setup/scripts/${f}`, import.meta.url), 'utf8'));
  }
  put('plugin/scripts/server-check.sh', readFileSync(new URL('../plugin/scripts/server-check.sh', import.meta.url), 'utf8'));
  if (withStart) put('plugin/scripts/start.sh', '#!/bin/sh\necho "$DRAW_PORT $DISPATCH_PORT $1" > "$HOME/started"; echo "$DRAWING_HOME" > "$HOME/started-home"\n');
  put('plugin/.env', 'SECRET=1');
  put('test/a.test.js');
  put('web/src/main.tsx');
  if (withPublic) put('public/index.html', '<html></html>');
  return root;
}

const list = (file) => execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean);

test('pack: bundle holds server, shared, public, plugin and nothing else', () => {
  const root = fakeRoot();
  const out = mkdtempSync(join(tmpdir(), 'pack-out-'));
  try {
    const file = packBundle({ root, out });
    assert.equal(file, join(out, 'drawing-1.2.3.tgz'));
    const names = list(file);
    for (const want of ['server/index.js', 'shared/dispatch/ask.ts', 'public/index.html', 'plugin/hooks/hooks.json', 'plugin/skills/atelier-setup/SKILL.md', 'package.json', 'NOTICE.md']) {
      assert.ok(names.includes(`drawing-1.2.3/${want}`), `missing ${want}`);
    }
    for (const bad of ['node_modules', '.env', 'test/', 'web/']) {
      assert.ok(!names.some((n) => n.includes(bad)), `must not ship ${bad}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('pack: plugin version follows package.json and dev dependencies are dropped', () => {
  const root = fakeRoot({ version: '2.0.1' });
  const out = mkdtempSync(join(tmpdir(), 'pack-out-'));
  const dest = mkdtempSync(join(tmpdir(), 'pack-x-'));
  try {
    execFileSync('tar', ['-xzf', packBundle({ root, out }), '-C', dest]);
    const plugin = JSON.parse(readFileSync(join(dest, 'drawing-2.0.1/plugin/.claude-plugin/plugin.json'), 'utf8'));
    assert.equal(plugin.version, '2.0.1');
    const codex = JSON.parse(readFileSync(join(dest, 'drawing-2.0.1/plugin/.codex-plugin/plugin.json'), 'utf8'));
    assert.equal(codex.version, '2.0.1');
    assert.equal(codex.skills, './skills/');
    const pkg = JSON.parse(readFileSync(join(dest, 'drawing-2.0.1/package.json'), 'utf8'));
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.devDependencies, undefined);
  } finally {
    for (const d of [root, out, dest]) rmSync(d, { recursive: true, force: true });
  }
});

test('pack: same inputs give the same bytes', () => {
  const root = fakeRoot();
  const out = mkdtempSync(join(tmpdir(), 'pack-out-'));
  try {
    const a = readFileSync(packBundle({ root, out }));
    const b = readFileSync(packBundle({ root, out }));
    assert.ok(a.equals(b));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('pack: refuses without a built public/ or a semver version', () => {
  const noPublic = fakeRoot({ withPublic: false });
  const badVersion = fakeRoot({ version: 'next' });
  const out = mkdtempSync(join(tmpdir(), 'pack-out-'));
  try {
    assert.throws(() => packBundle({ root: noPublic, out }), /npm run build/);
    assert.throws(() => packBundle({ root: badVersion, out }), /semver/);
  } finally {
    for (const d of [noPublic, badVersion, out]) rmSync(d, { recursive: true, force: true });
  }
});

test('pack: shipped plugin has valid manifests, hooks.json and skills', () => {
  const dir = new URL('../plugin/', import.meta.url).pathname;
  const mp = JSON.parse(readFileSync(join(dir, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(mp.name, 'atelier');
  assert.equal(JSON.parse(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8')).name, 'atelier');
  const codex = JSON.parse(readFileSync(join(dir, '.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(codex.name, 'atelier');
  assert.equal(codex.skills, './skills/');
  const codexMp = JSON.parse(readFileSync(join(dir, '.agents/plugins/marketplace.json'), 'utf8'));
  assert.deepEqual(codexMp.plugins.map((p) => [p.name, p.source.path]), [['atelier', './']]);
  assert.ok(JSON.parse(readFileSync(join(dir, 'hooks/hooks.json'), 'utf8')).hooks.PostToolUse);
  const skills = ['atelier-setup', 'atelier-team', 'atelier-quickfix', 'atelier-status', 'atelier-update', 'atelier-session', 'atelier-settings'];
  assert.deepEqual(readdirSync(join(dir, 'skills')).sort(), [...skills].sort());
  for (const s of skills) {
    const md = readFileSync(join(dir, 'skills', s, 'SKILL.md'), 'utf8');
    assert.match(md, new RegExp(`^---\\nname: ${s}\\ndescription: \\S`));
    assert.doesNotMatch(md, /\bIMPORTANT\b|\bNEVER\b/, s);
  }
});

test('atelier-update: unpacks the release bundle that gh serves, into DRAWING_INSTALL_BASE', () => {
  const root = fakeRoot({ version: '3.1.4' });
  const work = mkdtempSync(join(tmpdir(), 'upd-'));
  try {
    const bundle = packBundle({ root, out: join(work, 'rel') });
    const bin = join(work, 'bin');
    mkdirSync(bin);
    // Fake gh: `release view` prints a tag, `release download` copies the bundle to --dir.
    writeFileSync(join(bin, 'gh'), `#!/bin/sh
if [ "$2" = view ]; then echo v3.1.4; exit 0; fi
while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done
cp "${bundle}" "$dir/"
`, { mode: 0o755 });
    const home = join(work, 'home');
    mkdirSync(home);
    const script = new URL('../plugin/skills/atelier-update/scripts/update.sh', import.meta.url).pathname;
    const out = execFileSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, DRAWING_INSTALL_BASE: join(home, 'd') },
    });
    assert.match(out, /drawing-3\.1\.4/);
    assert.match(readFileSync(join(home, 'd/current/plugin/.claude-plugin/plugin.json'), 'utf8'), /"version": "3.1.4"/);
    assert.ok(readFileSync(join(home, 'd/current/server/index.js'), 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test('atelier-update: warns in Korean when DRAWING_HOME holds an old install, stays quiet otherwise', () => {
  const root = fakeRoot({ version: '3.1.4' });
  const work = mkdtempSync(join(tmpdir(), 'upd-'));
  try {
    const bundle = packBundle({ root, out: join(work, 'rel') });
    const bin = join(work, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), `#!/bin/sh
if [ "$2" = view ]; then echo v3.1.4; exit 0; fi
while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done
cp "${bundle}" "$dir/"
`, { mode: 0o755 });
    const home = join(work, 'home');
    const legacy = join(work, 'legacy');
    mkdirSync(join(legacy, 'drawing-1.0.0'), { recursive: true });
    symlinkSync(join(legacy, 'drawing-1.0.0'), join(legacy, 'current'));
    const script = new URL('../plugin/skills/atelier-update/scripts/update.sh', import.meta.url).pathname;
    const run = (env) => spawnSync('bash', [script, '--no-restart'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, DRAWING_INSTALL_BASE: '', DRAWING_HOME: '', ...env },
    });
    mkdirSync(home);
    const warned = run({ DRAWING_HOME: legacy });
    assert.equal(warned.status, 0, warned.stderr);
    assert.match(warned.stderr, /DRAWING_HOME/);
    assert.match(warned.stderr, /설치돼 있어요/);
    assert.ok(existsSync(join(home, '.dispatch/drawing/current/server/index.js')));
    // Explicit install base: no warning. Plain checkout in DRAWING_HOME (no `current`): no warning.
    assert.doesNotMatch(run({ DRAWING_HOME: legacy, DRAWING_INSTALL_BASE: join(work, 'b') }).stderr, /설치돼 있어요/);
    assert.doesNotMatch(run({ DRAWING_HOME: join(legacy, 'drawing-1.0.0') }).stderr, /설치돼 있어요/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

// --- update.sh restart behaviour (temp HOME, fake gh, fake start.sh; no real server) ---

function updateEnv({ version = '3.1.4', withStart = true } = {}) {
  const root = fakeRoot({ version, withStart });
  const work = mkdtempSync(join(tmpdir(), 'upd-'));
  const bundle = packBundle({ root, out: join(work, 'rel') });
  const bin = join(work, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
if [ "$2" = view ]; then echo v${version}; exit 0; fi
while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done
cp "${bundle}" "$dir/"
`, { mode: 0o755 });
  const home = join(work, 'home');
  mkdirSync(home);
  const project = join(work, 'proj');
  mkdirSync(join(project, '.atelier'), { recursive: true });
  execFileSync('git', ['init', '-q', project]);
  const script = new URL('../plugin/skills/atelier-update/scripts/update.sh', import.meta.url).pathname;
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, DRAWING_INSTALL_BASE: join(home, 'd') };
  const run = (args = []) => execFileSync('bash', [script, ...args], { encoding: 'utf8', env, cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
  const cleanup = () => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); };
  return { work, home, project, env, run, cleanup };
}

// A stand-in for the Drawing server: node running <dir>/server/index.js --project-mode <project>/.atelier.
function fakeServer(dir, project) {
  mkdirSync(join(dir, 'fake/server'), { recursive: true });
  writeFileSync(join(dir, 'fake/server/index.js'), 'setInterval(() => {}, 1000);\n');
  return spawn(process.execPath, [join(dir, 'fake/server/index.js'), '--project-mode', join(realpathSync(project), '.atelier')], { stdio: 'ignore' });
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('atelier-update: restarts only this project server, with the port passed as DRAW_PORT and DISPATCH_PORT', () => {
  const t = updateEnv();
  const child = fakeServer(t.work, t.project);
  try {
    writeFileSync(join(t.project, '.atelier/server.pid'), String(child.pid));
    writeFileSync(join(t.project, '.atelier/server.port'), '4411');
    // A leftover standalone-Dispatch registry entry must be ignored.
    mkdirSync(join(t.home, '.dispatch/servers'), { recursive: true });
    const other = join(t.work, 'other');
    mkdirSync(other);
    writeFileSync(join(t.home, '.dispatch/servers/4330.json'), JSON.stringify({ pid: process.pid, port: 4330, path: other }));
    const out = t.run();
    assert.match(out, /restarted the server of/);
    assert.match(out, /run restart\.sh in each of them/);
    const started = readFileSync(join(t.home, 'started'), 'utf8').trim();
    assert.match(started, /^4411 4411 .*proj$/);
    // DRAWING_HOME for start.sh is the unpacked Drawing checkout, not the install base.
    assert.equal(readFileSync(join(t.home, 'started-home'), 'utf8').trim(), join(t.home, 'd/drawing-3.1.4'));
    assert.ok(!existsSync(join(other, '.dispatch')), 'registry project untouched');
  } finally {
    child.kill();
    t.cleanup();
  }
});

test('atelier-update: no running server means no restart; a bad port value is never executed', () => {
  const t = updateEnv();
  try {
    writeFileSync(join(t.project, '.atelier/server.pid'), '999999');
    writeFileSync(join(t.project, '.atelier/server.port'), `1; touch ${join(t.work, 'pwned')}`);
    assert.match(t.run(), /no running server/);
    assert.ok(!existsSync(join(t.home, 'started')));
    assert.ok(!existsSync(join(t.work, 'pwned')));
  } finally {
    t.cleanup();
  }
});

test('atelier-update: a bundle without plugin/scripts/start.sh stops before current is switched', () => {
  const t = updateEnv({ withStart: false });
  try {
    assert.throws(() => t.run(), /start\.sh/);
    assert.ok(!existsSync(join(t.home, 'd/current')));
    assert.ok(!existsSync(join(t.home, 'd/drawing-3.1.4')));
    t.run(['--no-restart']);
    assert.ok(existsSync(join(t.home, 'd/current/server/index.js')));
  } finally {
    t.cleanup();
  }
});

test('atelier-update: re-downloading the same version replaces it without leftovers', () => {
  const t = updateEnv();
  try {
    t.run();
    const dir = join(t.home, 'd/drawing-3.1.4');
    writeFileSync(join(dir, 'stale.txt'), 'old');
    t.run();
    assert.ok(!existsSync(join(dir, 'stale.txt')));
    assert.ok(existsSync(join(t.home, 'd/current/server/index.js')));
    const left = execFileSync('ls', ['-A', join(t.home, 'd')], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
    assert.deepEqual(left, ['current', 'drawing-3.1.4']);
  } finally {
    t.cleanup();
  }
});

test('atelier-update: a pid file naming some other live process is stale: not signalled, no restart', () => {
  const t = updateEnv();
  const other = spawn('sleep', ['60'], { stdio: 'ignore' });
  try {
    writeFileSync(join(t.project, '.atelier/server.pid'), String(other.pid));
    writeFileSync(join(t.project, '.atelier/server.port'), '4411');
    assert.match(t.run(), /no running server/);
    assert.ok(!existsSync(join(t.home, 'started')));
    assert.ok(alive(other.pid), 'unrelated process left alone');
  } finally {
    other.kill();
    t.cleanup();
  }
});

test('atelier-update: a node server of another workspace is not ours either', () => {
  const t = updateEnv();
  const otherProject = join(t.work, 'elsewhere');
  mkdirSync(otherProject);
  const other = fakeServer(t.work, otherProject);
  try {
    writeFileSync(join(t.project, '.atelier/server.pid'), String(other.pid));
    assert.match(t.run(), /no running server/);
    assert.ok(alive(other.pid));
  } finally {
    other.kill();
    t.cleanup();
  }
});
