// Generate the bundled icon data (no runtime fetch; everything is a local build asset):
// - shared/render/icon-data.ts: a small set of Lucide (ISC) and Simple Icons (CC0-1.0) icons listed below,
//   always in the render bundle (fallback glyphs).
// - shared/render/icon-packs/: the full sets, split into chunks that load on demand, plus `names.ts` (icon
//   name → set, key, chunk file) and THIRD-PARTY.md (each set, version and licence). Sources: lucide-static,
//   simple-icons (npm) and the official AWS / Azure / Google Cloud icons vendored in shared/vendor/icons/
//   by scripts/import-cloud-icons.mjs.
//
//   node scripts/build-icons.mjs          write the files
//   node scripts/build-icons.mjs --check  exit 1 if a checked-in file is out of date
//
// Rules enforced here (the build fails instead of quietly shipping something we may not use):
// - Simple Icons: only icons with no per-icon licence or CC0-1.0 (some logos carry CC-BY/Apache/...).
// - Simple Icons never supplies AWS / Google Cloud / Azure logos: those come from the vendors' own
//   architecture icon sets, under their terms.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const OUT = fileURLToPath(new URL('../shared/render/icon-data.ts', import.meta.url));

/** Lucide icons bundled by name. Every glyph target in shared/render/icons.ts must be listed. */
export const LUCIDE = [
  'user', 'users', 'server', 'database', 'monitor', 'smartphone', 'cloud', 'columns-3', 'network',
  'square-function', 'hard-drive', 'zap', 'box', 'lock', 'globe', 'flag', 'mail', 'file-text',
  'settings', 'chart-column', 'code', 'bell', 'search',
  // General names people type directly.
  'key', 'shield', 'cpu', 'router', 'wifi', 'calendar', 'clock', 'credit-card', 'shopping-cart',
  'message-square', 'git-branch', 'terminal', 'workflow', 'package', 'layers', 'link', 'image', 'video',
  'laptop', 'tablet', 'building', 'house', 'map-pin', 'heart', 'star', 'check', 'x',
  'triangle-exclamation-point', 'info', 'activity', 'bot', 'brain', 'sparkles', 'webhook', 'folder',
  'upload', 'download', 'funnel', 'tag', 'truck', 'wallet', 'rocket', 'lightbulb', 'book', 'bug',
  'inbox', 'archive', 'cylinder', 'layout-grid',
];

/** Simple Icons slugs bundled. Kept to common infrastructure and developer tools. */
export const SIMPLE = [
  'postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'sqlite', 'elasticsearch', 'rabbitmq',
  'docker', 'kubernetes', 'helm', 'nginx', 'nodedotjs', 'python', 'go', 'typescript', 'react',
  'svelte', 'nextdotjs', 'graphql', 'github', 'gitlab', 'githubactions', 'terraform', 'ansible',
  'grafana', 'prometheus', 'datadog', 'sentry', 'stripe', 'supabase', 'vercel', 'netlify',
  'cloudflare', 'ubuntu', 'apple', 'spring', 'django', 'flask', 'fastapi', 'rubyonrails',
  'kotlin', 'swift', 'auth0', 'okta', 'vault', 'consul', 'istio', 'envoyproxy',
  'databricks', 'clickhouse', 'neo4j', 'minio', 'digitalocean', 'figma', 'jira',
  'confluence', 'notion', 'postman', 'kibana', 'logstash', 'elastic',
];

const VENDOR_CLOUD = /^(aws|amazon|googlecloud|google|gcp|microsoftazure|azure)/;
const num = (v) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) throw new Error(`bad number ${v}`);
  return n;
};

/**
 * A path that opens with a relative `m` starts at that point only while it is its own element. Joined
 * after another element it would start from where that one ended, outside the 24px box. Make the first
 * move absolute; the pairs that follow it stay relative lines.
 */
export function absoluteStart(d) {
  const m = /^\s*m\s*([+-]?(?:\d*\.\d+|\d+\.?))[\s,]*([+-]?(?:\d*\.\d+|\d+\.?))[\s,]*/.exec(d);
  if (!m) return d;
  const rest = d.slice(m[0].length);
  return `M${m[1]} ${m[2]}${/^[+-.\d]/.test(rest) ? 'l' : ''}${rest}`;
}

/** Lucide element → path data. Only the element kinds Lucide uses. */
function elementToPath([tag, a]) {
  switch (tag) {
    case 'path':
      return absoluteStart(a.d);
    case 'line':
      return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const p = a.points.trim().split(/[\s,]+/).map(num);
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return tag === 'polygon' ? `${d}Z` : d;
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(a.cx);
      const cy = num(a.cy);
      const rx = num(tag === 'circle' ? a.r : a.rx);
      const ry = num(tag === 'circle' ? a.r : a.ry);
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
    }
    case 'rect': {
      const x = num(a.x);
      const y = num(a.y);
      const w = num(a.width);
      const h = num(a.height);
      const rx = Math.min(num(a.rx ?? a.ry), w / 2);
      const ry = Math.min(num(a.ry ?? a.rx), h / 2);
      if (!rx && !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return (
        `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}` +
        `h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`
      );
    }
    default:
      throw new Error(`lucide: unsupported element <${tag}>`);
  }
}

export function generate() {
  const lucideNodes = JSON.parse(readFileSync(require.resolve('lucide-static/icon-nodes.json'), 'utf8'));
  const lucideVersion = JSON.parse(readFileSync(require.resolve('lucide-static/package.json'), 'utf8')).version;
  const siDir = `${dirname(require.resolve('simple-icons'))}/`;
  const siVersion = JSON.parse(readFileSync(`${siDir}package.json`, 'utf8')).version;
  const siRaw = JSON.parse(readFileSync(`${siDir}data/simple-icons.json`, 'utf8'));
  const siMeta = new Map((Array.isArray(siRaw) ? siRaw : siRaw.icons).map((i) => [i.slug, i]));
  const siIcons = new Map(Object.values(require('simple-icons')).filter((i) => i && i.slug).map((i) => [i.slug, i]));

  const lucide = LUCIDE.map((name) => {
    const nodes = lucideNodes[name];
    if (!nodes) throw new Error(`lucide: no icon "${name}"`);
    return [name, nodes.map(elementToPath).join(' ')];
  });
  const simple = SIMPLE.map((slug) => {
    if (VENDOR_CLOUD.test(slug)) throw new Error(`simple-icons: "${slug}" is a cloud vendor logo, not allowed`);
    const meta = siMeta.get(slug);
    const icon = siIcons.get(slug);
    if (!meta || !icon) throw new Error(`simple-icons: no icon "${slug}"`);
    if (meta.license && meta.license.type !== 'CC0-1.0') throw new Error(`simple-icons: "${slug}" is ${meta.license.type}, not CC0`);
    return [slug, { title: icon.title, hex: `#${icon.hex.toLowerCase()}`, d: icon.path }];
  });

  // Path data and colours end up inside SVG attributes: allow path syntax only.
  const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]+$/;
  for (const [k, d] of lucide) if (!PATH.test(d)) throw new Error(`lucide: "${k}" has unexpected path data`);
  for (const [k, v] of simple) {
    if (!PATH.test(v.d)) throw new Error(`simple-icons: "${k}" has unexpected path data`);
    if (!/^#[0-9a-f]{6}$/.test(v.hex)) throw new Error(`simple-icons: "${k}" has a bad colour`);
  }

  const q = (s) => JSON.stringify(s);
  return [
    '// GENERATED by scripts/build-icons.mjs. Do not edit by hand; run `npm run icons`.',
    `// Lucide ${lucideVersion} (ISC; some icons MIT from Feather) and Simple Icons ${siVersion} (CC0-1.0).`,
    '// See NOTICE.md. Logos are trademarks of their owners.',
    '',
    '/** Lucide outline icons, 24x24, drawn with stroke. Name → path data. */',
    'export const LUCIDE_ICONS: ReadonlyMap<string, string> = new Map([',
    ...lucide.map(([k, d]) => `  [${q(k)}, ${q(d)}],`),
    ']);',
    '',
    '/** Simple Icons brand logos, 24x24, drawn with fill. Slug → title, brand colour, path data. */',
    'export const SIMPLE_ICONS: ReadonlyMap<string, { title: string; hex: string; d: string }> = new Map([',
    ...simple.map(([k, v]) => `  [${q(k)}, { title: ${q(v.title)}, hex: ${q(v.hex)}, d: ${q(v.d)} }],`),
    ']);',
    '',
  ].join('\n');
}


// ---------------------------------------------------------------------------------------------------------
// Full icon packs (shared/render/icon-packs/)

const PACK_DIR = fileURLToPath(new URL('../shared/render/icon-packs/', import.meta.url));
const VENDOR_DIR = fileURLToPath(new URL('../shared/vendor/icons/', import.meta.url));
/** Rough size of one chunk file; sets are split so a diagram loads only the chunks its icons are in. */
const CHUNK_BYTES = 320_000;

/** Lucide names that a Simple Icons logo of the same name replaces (the brand is what people mean). */
const BRAND_OVER_LUCIDE = new Set(['apple', 'bitcoin', 'blender', 'snowflake']);
/** Names never given to a logo: they usually mean the generic thing (see BRANDS in icons.ts). */
const NOT_A_BRAND = new Set(['vault']);
/**
 * Extra spellings for logos, written like the names people use in Eraser-style code. Values are
 * Simple Icons slugs. Rules below add `apache<name>`, `<name>dotjs` and the logos' own "aka" names.
 */
const SIMPLE_ALIASES = {
  postgres: 'postgresql', pg: 'postgresql', mongo: 'mongodb', k8s: 'kubernetes', node: 'nodedotjs', nodejs: 'nodedotjs',
  golang: 'go', reactjs: 'react', next: 'nextdotjs', nextjs: 'nextdotjs', vue: 'vuedotjs', vuejs: 'vuedotjs', rails: 'rubyonrails',
  'spring-boot': 'springboot', envoy: 'envoyproxy', 'hashicorp-vault': 'vault', 'socket-io': 'socketdotio',
  'three-js': 'threedotjs', 'fly-io': 'flydotio', 'bunny-net': 'bunnydotnet', 'box-com': 'box',
  'flask-python': 'flask', 'material-ui': 'mui',
  'delta-lake': 'delta', 'plane-so': 'plane', 'cursor-ide': 'cursor', 'vs-code': 'vscodium',
};
/** Cloud names that point at another icon of the same set (renamed services, common short forms). */
const CLOUD_ALIASES = {
  'aws-vpc': 'aws-virtual-private-cloud-vpc',
  'aws-s3': 'aws-simple-storage-service',
  'aws-sqs': 'aws-simple-queue-service',
  'aws-sns': 'aws-simple-notification-service',
  'aws-ses': 'aws-simple-email-service',
  'aws-eks': 'aws-elastic-kubernetes-service',
  'aws-ecs': 'aws-elastic-container-service',
  'aws-ecr': 'aws-elastic-container-registry',
  'aws-ebs': 'aws-elastic-block-store',
  'aws-kms': 'aws-key-management-service',
  'aws-iam': 'aws-identity-and-access-management',
  'aws-elb-application-load-balancer': 'aws-elastic-load-balancing-application-load-balancer',
  'aws-elb-network-load-balancer': 'aws-elastic-load-balancing-network-load-balancer',
  'aws-elb-classic-load-balancer': 'aws-elastic-load-balancing-classic-load-balancer',
  'aws-elb-gateway-load-balancer': 'aws-elastic-load-balancing-gateway-load-balancer',
  'aws-elb': 'aws-elastic-load-balancing',
  'aws-alb': 'aws-elastic-load-balancing-application-load-balancer',
  'aws-nlb': 'aws-elastic-load-balancing-network-load-balancer',
  'aws-internet-gateway': 'aws-vpc-internet-gateway',
  'aws-nat-gateway': 'aws-vpc-nat-gateway',
  'aws-vpn-gateway': 'aws-vpc-vpn-gateway',
  'aws-vpn-connection': 'aws-vpc-vpn-connection',
  'aws-route-table': 'aws-vpc-router',
  'aws-endpoints': 'aws-vpc-endpoints',
  'aws-network-access-control-list': 'aws-vpc-network-access-control-list',
  'aws-elastic-ip': 'aws-ec2-elastic-ip-address',
  'aws-ami': 'aws-ec2-ami',
  'aws-iam-role': 'aws-identity-access-management-role',
  'aws-route53': 'aws-route-53',
  'aws-kinesis-firehose': 'aws-data-firehose',
  'aws-kinesis-data-analytics': 'aws-managed-service-for-apache-flink',
  'aws-memorydb-for-redis': 'aws-memorydb',
  'aws-workspaces': 'aws-workspaces-family',
  'aws-appstream': 'aws-appstream-2',
  'aws-container': 'aws-elastic-container-service-container-1',
  'azure-vm': 'azure-virtual-machine',
  'azure-sql': 'azure-sql-database',
  'azure-storage': 'azure-storage-accounts',
  'azure-functions': 'azure-function-apps',
  'azure-aks': 'azure-kubernetes-services',
  'azure-front-doors': 'azure-front-door-and-cdn-profiles',
  'gcp-gke': 'gcp-google-kubernetes-engine',
  'gcp-kubernetes-engine': 'gcp-google-kubernetes-engine',
};

/** `AlertCircle` → `alert-circle`, `BarChart2` → `bar-chart-2`. */
function kebab(pascal) {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase();
}

/** Old and alternative Lucide names (`alert-circle`), read from lucide-react's export list. */
function lucideAliases(known) {
  const src = readFileSync(require.resolve('lucide-react').replace(/dist\/cjs\/.*$/, 'dist/esm/lucide-react.mjs'), 'utf8');
  const out = new Map();
  for (const m of src.matchAll(/export \{([^}]*)\} from '\.\/icons\/([a-z0-9-]+)\.mjs'/g)) {
    if (!known.has(m[2])) continue;
    for (const [, name] of m[1].matchAll(/default as (\w+)/g)) {
      if (name.startsWith('Lucide') || name.endsWith('Icon')) continue;
      const k = kebab(name);
      if (k !== m[2] && !known.has(k)) out.set(k, m[2]);
    }
  }
  return out;
}

/** Split `{ key: entry }` into chunk objects by packChunk. */
function chunked(entries, packChunk) {
  const bytes = entries.reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);
  const n = Math.max(1, Math.ceil(bytes / CHUNK_BYTES));
  const chunks = Array.from({ length: n }, () => []);
  for (const e of entries) chunks[packChunk(e[0], n)].push(e);
  return chunks;
}

export async function generatePacks() {
  const { packChunk } = await import('../shared/render/icon-hash.ts');
  const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+eE-]+$/;
  const sets = [];

  // Lucide: every icon, stroked on a 24 grid.
  const lucideNodes = JSON.parse(readFileSync(require.resolve('lucide-static/icon-nodes.json'), 'utf8'));
  const lucideVersion = JSON.parse(readFileSync(require.resolve('lucide-static/package.json'), 'utf8')).version;
  const lucide = Object.keys(lucideNodes)
    .sort()
    .map((name) => {
      const d = lucideNodes[name].map(elementToPath).join(' ');
      if (!PATH.test(d)) throw new Error(`lucide: "${name}" has unexpected path data`);
      return [name, ['0 0 24 24', d]];
    });
  sets.push({ id: 'lucide', kind: 'stroke', title: 'Lucide', version: lucideVersion, license: 'ISC (some icons MIT, from Feather)', url: 'https://lucide.dev', entries: lucide });

  // Simple Icons: every logo without its own non-CC0 licence, filled in its brand colour.
  const siDir = `${dirname(require.resolve('simple-icons'))}/`;
  const siVersion = JSON.parse(readFileSync(`${siDir}package.json`, 'utf8')).version;
  const siRaw = JSON.parse(readFileSync(`${siDir}data/simple-icons.json`, 'utf8'));
  const siMeta = new Map((Array.isArray(siRaw) ? siRaw : siRaw.icons).map((i) => [i.slug, i]));
  const simple = Object.values(require('simple-icons'))
    .filter((i) => i && i.slug)
    .filter((i) => !VENDOR_CLOUD.test(i.slug) && !NOT_A_BRAND.has(i.slug))
    .filter((i) => !siMeta.get(i.slug)?.license || siMeta.get(i.slug).license.type === 'CC0-1.0')
    .sort((a, b) => (a.slug < b.slug ? -1 : 1))
    .map((i) => {
      const hex = `#${i.hex.toLowerCase()}`;
      if (!PATH.test(i.path)) throw new Error(`simple-icons: "${i.slug}" has unexpected path data`);
      if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Error(`simple-icons: "${i.slug}" has a bad colour`);
      return [i.slug, ['0 0 24 24', i.path, hex], i.title];
    });
  sets.push({ id: 'simple', kind: 'fill', title: 'Simple Icons', version: siVersion, license: 'CC0-1.0 (logos are trademarks of their owners)', url: 'https://simpleicons.org', entries: simple });

  // Official cloud icon sets, vendored and already sanitized.
  for (const id of ['aws', 'azure', 'gcp']) {
    const v = JSON.parse(readFileSync(`${VENDOR_DIR}${id}.json`, 'utf8'));
    const entries = Object.entries(v.icons).map(([name, i]) => {
      if (/<\/?(script|style|image|foreignObject|use|a)\b|\son\w+=|href="(?!#)/i.test(i.body)) throw new Error(`${id}: "${name}" has markup that is not allowed`);
      return [name, [i.vb, i.body], i.label];
    });
    sets.push({ id, kind: 'art', title: v.title, version: v.version, license: v.license, url: v.url, entries });
  }

  // Names: name → "set:key" (key omitted when equal to the name). Earlier wins.
  const names = new Map();
  const titles = new Map();
  const add = (name, set, key) => {
    if (!/^[a-z0-9][a-z0-9.+-]*$/.test(name) || names.has(name)) return;
    names.set(name, key === name ? set : `${set}:${key}`);
  };
  const byId = Object.fromEntries(sets.map((s) => [s.id, s]));
  for (const id of ['aws', 'azure', 'gcp']) for (const [k, , title] of byId[id].entries) add(k, id, k), titles.set(`${id}:${k}`, title);
  const cloudKeys = new Set(['aws', 'azure', 'gcp'].flatMap((id) => byId[id].entries.map((e) => e[0])));
  for (const [alias, key] of Object.entries(CLOUD_ALIASES)) {
    if (!cloudKeys.has(key)) throw new Error(`cloud alias ${alias}: no icon "${key}"`);
    add(alias, key.split('-')[0], key);
  }
  const lucideKeys = new Set(lucide.map((e) => e[0]));
  const simpleKeys = new Set(simple.map((e) => e[0]));
  for (const k of BRAND_OVER_LUCIDE) add(k, 'simple', k);
  for (const k of SIMPLE.filter((k) => simpleKeys.has(k))) add(k, 'simple', k);
  for (const k of lucideKeys) add(k, 'lucide', k);
  for (const [k, , title] of simple) add(k, 'simple', k), titles.set(`simple:${k}`, title);
  for (const [alias, slug] of Object.entries(SIMPLE_ALIASES)) {
    if (!siMeta.has(slug)) throw new Error(`simple alias ${alias}: no icon "${slug}"`);
    // A logo left out for its licence keeps no alias either.
    if (simpleKeys.has(slug)) add(alias, 'simple', slug);
  }
  for (const k of simpleKeys) {
    const m = /^apache(.+)$/.exec(k) ?? /^(.+)dotjs$/.exec(k);
    if (m) add(m[1], 'simple', k);
  }
  for (const [slug, meta] of siMeta) {
    if (!simpleKeys.has(slug)) continue;
    for (const aka of meta.aliases?.aka ?? []) add(aka.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), 'simple', slug);
  }
  for (const [alias, key] of lucideAliases(lucideKeys)) add(alias, 'lucide', key);

  // Files.
  const q = JSON.stringify;
  const files = new Map();
  const head = '// GENERATED by scripts/build-icons.mjs. Do not edit by hand; run `npm run icons`. See THIRD-PARTY.md.';
  const chunkCounts = {};
  for (const s of sets) {
    const chunks = chunked(s.entries.map(([k, v]) => [k, v]), packChunk);
    chunkCounts[s.id] = chunks.length;
    chunks.forEach((c, i) => {
      files.set(
        `${s.id}-${i}.ts`,
        [head, "import type { PackChunk } from '../icon-registry.ts';", '', 'const chunk: PackChunk = {', ...c.map(([k, v]) => `  ${q(k)}: ${q(v)},`), '};', 'export default chunk;', ''].join('\n'),
      );
    });
  }
  const loaders = sets.flatMap((s) => Array.from({ length: chunkCounts[s.id] }, (_, i) => `  ${q(`${s.id}-${i}`)}: () => import('./${s.id}-${i}.ts'),`));
  files.set(
    'loaders.ts',
    [
      head,
      "import type { PackChunk, PackSet } from '../icon-registry.ts';",
      '',
      '/** Drawing kind and chunk count of each set. */',
      `export const PACK_SETS: Record<PackSet, { kind: 'stroke' | 'fill' | 'art'; chunks: number }> = {`,
      ...sets.map((s) => `  ${s.id}: { kind: ${q(s.kind)}, chunks: ${chunkCounts[s.id]} },`),
      '};',
      '',
      '/** Chunk file loaders, `<set>-<n>`. */',
      'export const PACK_LOADERS: Record<string, () => Promise<{ default: PackChunk }>> = {',
      ...loaders,
      '};',
      '',
    ].join('\n'),
  );
  const sortedNames = [...names].sort(([a], [b]) => (a < b ? -1 : 1));
  files.set(
    'names.ts',
    [
      head,
      '',
      '/** Icon name (as written in `icon: <name>`) → "set" (key = name) or "set:key". */',
      'export const ICON_NAMES: Record<string, string> = {',
      ...sortedNames.map(([k, v]) => `  ${q(k)}: ${q(v)},`),
      '};',
      '',
      '/** "set:key" → the source title, for search (only where it differs from the name). */',
      'export const ICON_TITLES: Record<string, string> = {',
      ...[...titles].filter(([k, t]) => t && t.toLowerCase().replace(/[^a-z0-9]+/g, '-') !== k.split(':')[1]).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, t]) => `  ${q(k)}: ${q(t)},`),
      '};',
      '',
    ].join('\n'),
  );
  files.set(
    'THIRD-PARTY.md',
    [
      '# Bundled icon sets',
      '',
      'Generated by `scripts/build-icons.mjs`. The sets are bundled with the app (no runtime download); the full',
      'licence texts of Lucide and Simple Icons are in the repository NOTICE.md. Logos and product icons are',
      'trademarks of their owners; their use here does not imply endorsement.',
      '',
      '| Set | Version | Icons | Licence / terms | Source |',
      '| --- | --- | --- | --- | --- |',
      ...sets.map((s) => `| ${s.title} | ${s.version} | ${s.entries.length} | ${s.license} | ${s.url} |`),
      '',
      `Names: ${names.size} (icon names, aliases included).`,
      '',
    ].join('\n'),
  );
  return files;
}

/** Every generated file: path relative to the repo root → content. */
async function allFiles() {
  const out = new Map([[OUT, generate()]]);
  for (const [name, text] of await generatePacks()) out.set(`${PACK_DIR}${name}`, text);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = await allFiles();
  let existing = [];
  try {
    existing = readdirSync(PACK_DIR).map((f) => `${PACK_DIR}${f}`);
  } catch {}
  if (process.argv.includes('--check')) {
    const stale = [...files].filter(([path, text]) => {
      try {
        return readFileSync(path, 'utf8') !== text;
      } catch {
        return true;
      }
    });
    const extra = existing.filter((p) => !files.has(p));
    if (stale.length || extra.length) {
      console.error(`icon data is out of date (${[...stale.map(([p]) => p), ...extra].length} files): run \`npm run icons\``);
      process.exit(1);
    }
  } else {
    mkdirSync(PACK_DIR, { recursive: true });
    for (const p of existing) if (!files.has(p)) rmSync(p);
    let bytes = 0;
    for (const [path, text] of files) {
      writeFileSync(path, text);
      bytes += text.length;
    }
    console.log(`wrote ${files.size} files (${bytes} bytes)`);
  }
}
