// Import the official cloud architecture icon sets into shared/vendor/icons/ (vendored, checked in).
// Run by hand when a set is updated; the build never downloads anything (scripts/build-icons.mjs reads the
// vendored files). Download and unzip each package into its own empty folder first:
//
//   AWS Architecture Icons    https://aws.amazon.com/architecture/icons/   (Asset-Package_*.zip)
//   Azure Architecture Icons  https://learn.microsoft.com/azure/architecture/icons/   (Azure_Public_Service_Icons_V*.zip)
//   Google Cloud icons        https://cloud.google.com/icons   (google-cloud-icons.zip)
//
//   node scripts/import-cloud-icons.mjs --aws <dir> --aws-version 2025-02-07 \
//     --azure <V23 dir>,<V21 dir>,<V17 dir> --azure-version V23 --gcp <icons dir>,<core-products dir> --gcp-version 2025
//
// Azure takes several unzipped versions, newest first: older ones only add names the newer set dropped
// (renamed services). Google Cloud takes google-cloud-icons.zip and core-products-icons.zip.
//
// Each set is optional; a set that is not given keeps its current vendored file.
// Every SVG goes through scripts/svg-sanitize.mjs (whitelist), so only plain shapes and gradients are kept.
// Names follow the Eraser syntax: `aws-<service>`, `azure-<service>`, `gcp-<product>` in lower-case words.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSvg } from './svg-sanitize.mjs';

const OUT_DIR = fileURLToPath(new URL('../shared/vendor/icons/', import.meta.url));

/** Recursively list `.svg` files, skipping macOS resource forks. */
function svgs(dir) {
  const out = [];
  for (const e of readdirSync(dir).sort()) {
    if (e === '__MACOSX' || e.startsWith('._')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...svgs(p));
    else if (e.toLowerCase().endsWith('.svg')) out.push(p);
  }
  return out;
}

/** `Amazon-EC2_Auto Scaling.NET` → `amazon-ec2-auto-scaling-net`. CamelCase stays one word (`CloudFront` → `cloudfront`). */
export function slug(s) {
  return s
    .toLowerCase()
    .replace(/&/g, '-and-')
    .replace(/\+/g, '-plus-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** AWS file stem → name after `aws-`: vendor words dropped (`Amazon-EC2` → `ec2`). */
export function awsName(stem) {
  return slug(stem.replace(/\./g, '-')).replace(/^(amazon|aws)-/, '').replace(/-(amazon|aws)-/g, '-');
}

/** AWS: service icons (64), category icons (64), group icons (32) and resource icons (48). */
function importAws([dir]) {
  const icons = {};
  const add = (name, file, label) => {
    if (!name || icons[name]) return;
    icons[name] = { label, ...sanitizeSvg(readFileSync(file, 'utf8'), `aws-${name}`) };
  };
  const files = svgs(dir);
  // Services first: they own the plain service name; resources and categories only fill gaps.
  for (const f of files) {
    const m = /^Arch_(.+)_64\.svg$/.exec(basename(f));
    if (m) add(`aws-${awsName(m[1])}`, f, m[1].replace(/-/g, ' '));
  }
  for (const f of files) {
    const m = /^Arch-Category_(.+)_64\.svg$/.exec(basename(f));
    if (m) add(`aws-${awsName(m[1])}`, f, m[1].replace(/-/g, ' '));
  }
  for (const f of files) {
    const m = /^(.+)_32\.svg$/.exec(basename(f));
    if (m && f.includes('Group-Icons')) add(`aws-${awsName(m[1])}`, f, m[1].replace(/-/g, ' '));
  }
  for (const f of files) {
    const m = /^Res_(.+)_48(_Light)?\.svg$/.exec(basename(f));
    if (!m || m[2]) continue;
    const parts = m[1].split('_');
    const service = awsName(parts[0]);
    const resource = parts.slice(1).map(awsName).join('-');
    // `Res_Amazon-EC2_Instance` → aws-ec2-instance; a resource named like its service keeps one copy.
    const name = resource && !resource.startsWith(service) ? `${service}-${resource}` : resource || service;
    add(`aws-${name}`, f, m[1].replace(/[-_]/g, ' '));
  }
  return icons;
}

/** Azure: `10021-icon-service-Virtual-Machine.svg` → azure-virtual-machine. Later folders (older versions) only fill gaps. */
function importAzure(dirs) {
  const icons = {};
  for (const dir of dirs) {
    for (const f of svgs(dir)) {
      const m = /^\d+-icon-service-(.+)\.svg$/.exec(basename(f));
      if (!m) continue;
      const stem = slug(m[1]).replace(/^(microsoft-)?azure-/, '');
      const name = `azure-${stem}`;
      if (!stem || icons[name]) continue;
      icons[name] = { label: m[1].replace(/-/g, ' '), ...sanitizeSvg(readFileSync(f, 'utf8'), name) };
    }
  }
  return icons;
}

/**
 * Google Cloud: product icons `<product>/<product>.svg` → gcp-<product> (`google_kubernetes_engine` →
 * gcp-google-kubernetes-engine); the core-products package's `Unique Icons/<Name>/SVG/*.svg` → gcp-<name>.
 */
function importGcp(dirs) {
  const icons = {};
  for (const dir of dirs) {
    for (const f of svgs(dir)) {
      const unique = /Unique Icons\/([^/]+)\/SVG\//.exec(f);
      if (unique && !/-color(-rgb)?\.svg$/.test(f)) continue;
      const raw = unique ? unique[1] : basename(f, '.svg');
      const stem = raw.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const name = `gcp-${stem}`;
      if (!stem || icons[name]) continue;
      icons[name] = { label: raw.replace(/[_-]/g, ' '), ...sanitizeSvg(readFileSync(f, 'utf8'), name) };
    }
  }
  return icons;
}

const SETS = {
  aws: {
    run: importAws,
    title: 'AWS Architecture Icons',
    url: 'https://aws.amazon.com/architecture/icons/',
    license: 'AWS Architecture Icons terms: may be used to build architecture diagrams; do not alter or use as a logo or trademark.',
  },
  azure: {
    run: importAzure,
    title: 'Azure Architecture Icons',
    url: 'https://learn.microsoft.com/azure/architecture/icons/',
    license: 'Microsoft Azure icon terms: may be used in architectural diagrams, training materials or documentation; do not crop, flip or rotate.',
  },
  gcp: {
    run: importGcp,
    title: 'Google Cloud icons',
    url: 'https://cloud.google.com/icons',
    license: 'Google Cloud icon terms: for use in architecture diagrams that show Google Cloud products.',
  },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [key, set] of Object.entries(SETS)) {
    const dir = arg(key);
    if (!dir) continue;
    const version = arg(`${key}-version`);
    if (!version) throw new Error(`--${key}-version is required with --${key}`);
    const icons = set.run(dir.split(','));
    const sorted = Object.fromEntries(Object.entries(icons).sort(([a], [b]) => (a < b ? -1 : 1)));
    const file = join(OUT_DIR, `${key}.json`);
    writeFileSync(file, `${JSON.stringify({ set: key, title: set.title, version, url: set.url, license: set.license, icons: sorted }, null, 0)}\n`);
    console.log(`${key}: ${Object.keys(sorted).length} icons → ${file}`);
  }
}
