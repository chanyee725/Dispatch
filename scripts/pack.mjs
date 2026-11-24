// Build the release bundle: dist/drawing-<version>.tgz = server + shared + built public + plugin.
//
//   node scripts/pack.mjs                 pack from the repo root into dist/
//   node scripts/pack.mjs --out <dir>     write the tarball somewhere else
//
// The server has no npm dependencies, so the bundle runs with `node server/index.js` and no install.
// Run `npm run build` first: public/ is not in git. No network access; the only child process is tar.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Directories copied as they are (relative to the source root). */
const DIRS = ['server', 'shared', 'public', 'plugin'];
/** Never ship these, wherever they sit in the tree. */
const SKIP = new Set(['node_modules', '.dispatch', '.git', '.drawing', '.DS_Store']);
const skipEntry = (src) => {
  const name = src.split('/').pop();
  return !(SKIP.has(name) || name === '.env' || name.startsWith('.env.') || name.endsWith('.log'));
};

/** Pack `root` into `<out>/drawing-<version>.tgz` and return its path. */
export function packBundle({ root = DEFAULT_ROOT, out = join(root, 'dist') } = {}) {
  root = resolve(root);
  out = resolve(out);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = String(pkg.version || '');
  if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(version)) throw new Error(`package.json version is not semver: "${version}"`);
  for (const d of DIRS) {
    if (!existsSync(join(root, d))) throw new Error(`${d}/ is missing${d === 'public' ? ' (run npm run build first)' : ''}`);
  }
  if (!existsSync(join(root, 'public', 'index.html'))) throw new Error('public/index.html is missing (run npm run build first)');

  const name = `drawing-${version}`;
  const stage = mkdtempSync(join(tmpdir(), 'drawing-pack-'));
  try {
    const top = join(stage, name);
    mkdirSync(top);
    for (const d of DIRS) cpSync(join(root, d), join(top, d), { recursive: true, filter: skipEntry });
    if (existsSync(join(root, 'NOTICE.md'))) cpSync(join(root, 'NOTICE.md'), join(top, 'NOTICE.md'));
    // package.json keeps "type": "module" (server code is ESM) without the dev dependencies.
    writeFileSync(join(top, 'package.json'), JSON.stringify({ name: pkg.name, version, private: true, type: 'module', engines: pkg.engines }, null, 2) + '\n');
    // The plugin version always follows the bundle version (Claude Code and Codex manifests alike).
    for (const kind of ['.claude-plugin', '.codex-plugin']) {
      const manifest = join(top, 'plugin', kind, 'plugin.json');
      if (existsSync(manifest)) {
        writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), version }, null, 2) + '\n');
      }
    }
    mkdirSync(out, { recursive: true });
    const file = join(out, `${name}.tgz`);
    rmSync(file, { force: true });
    // Fixed order, owner and mtime: the same inputs give the same bytes.
    execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', file, '-C', stage, name]);
    return file;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  try {
    const file = packBundle(i > 0 ? { out: process.argv[i + 1] } : {});
    console.log(file);
  } catch (e) {
    console.error(`pack failed: ${e.message}`);
    process.exit(1);
  }
}
