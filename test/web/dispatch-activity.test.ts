import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

test('inside web/src/dispatch only lib/presence.ts reads .activity', () => {
  const root = join(import.meta.dirname, '../../web/src/dispatch');
  const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
  const files = walk(root);
  assert.ok(files.length > 5);
  const readers = files.filter(f => /\.activity\b/.test(readFileSync(f, 'utf8'))).map(f => relative(root, f).split(sep).join('/'));
  assert.deepEqual(readers, ['lib/presence.ts']);
});
