// Whitelist SVG sanitizer for vendored icon artwork (scripts/import-cloud-icons.mjs).
// The result is drawn inside our own SVG output, so only plain drawing survives: shapes, groups, gradients,
// clip paths and masks with checked attribute values. Scripts, styles, links, images, filters, text and
// anything unknown are dropped. Ids are renamed under a per-icon prefix so two icons never share one.

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
const CONTAINERS = new Set(['g', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient']);
const KEEP = new Set([...SHAPES, ...CONTAINERS, 'stop']);
/** Elements whose whole subtree is dropped. */
const SKIP = new Set(['title', 'desc', 'metadata', 'style', 'filter', 'script', 'foreignObject', 'image', 'text', 'a', 'use', 'symbol', 'pattern', 'switch']);

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i;
const PCT = /^[+-]?(?:\d+\.?\d*|\.\d+)%?$/;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+eE-]*$/;
const POINTS = /^[0-9.,\s+eE-]*$/;
const TRANSFORM = /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([0-9.,\s+eE-]*\)\s*,?)*\s*$/;
const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', none: 'none', transparent: 'none' };

/** #rgb / #rrggbb / a few names → #rrggbb (or none). Anything else → undefined. */
export function color(v) {
  const s = v.trim().toLowerCase();
  if (s in NAMED) return NAMED[s];
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
  if (rgb) return `#${rgb.slice(1).map((c) => Math.min(255, Number(c)).toString(16).padStart(2, '0')).join('')}`;
  return undefined;
}

const ENUMS = {
  'fill-rule': ['nonzero', 'evenodd'],
  'clip-rule': ['nonzero', 'evenodd'],
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'round', 'bevel'],
  gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  maskUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  maskContentUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  spreadMethod: ['pad', 'reflect', 'repeat'],
  'mask-type': ['luminance', 'alpha'],
};
const NUMERIC = new Set(['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'fx', 'fy', 'x1', 'y1', 'x2', 'y2', 'stroke-width', 'stroke-miterlimit']);
const FRACTION = new Set(['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'offset']);
const PAINT = new Set(['fill', 'stroke', 'stop-color']);
const REF = new Set(['clip-path', 'mask']);

/** Parse `a:b; c:d` into pairs. */
function declarations(css) {
  return css
    .split(';')
    .map((d) => d.split(':'))
    .filter((p) => p.length === 2)
    .map(([k, v]) => [k.trim(), v.trim()]);
}

/** `.a{fill:#fff}.b,.c{opacity:.5}` → class → declarations. Only class selectors are understood. */
function classRules(css) {
  const out = new Map();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    for (const sel of m[1].split(',')) {
      const c = /^\s*\.([\w-]+)\s*$/.exec(sel);
      if (c) out.set(c[1], [...(out.get(c[1]) ?? []), ...declarations(m[2])]);
    }
  }
  return out;
}

function parseAttrs(src) {
  const out = [];
  for (const m of src.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out.push([m[1], m[2] ?? m[3] ?? '']);
  return out;
}

/**
 * Sanitize one SVG file. Returns `{ vb, body }` (viewBox string and inner markup) or throws when the file
 * has no usable root or no drawing left.
 */
export function sanitizeSvg(svg, prefix) {
  const text = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  const css = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, '')).join('\n');
  const classes = classRules(css);
  const ids = new Map();
  const idOf = (old) => {
    if (!ids.has(old)) ids.set(old, `${prefix}-${ids.size}`);
    return ids.get(old);
  };
  // First pass: rename every id in document order so forward references resolve.
  for (const m of text.matchAll(/\sid\s*=\s*"([^"]*)"/g)) idOf(m[1]);

  const ref = (v) => {
    const m = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)$/.exec(v.trim());
    return m && ids.has(m[1]) ? `url(#${ids.get(m[1])})` : undefined;
  };

  const clean = (name, value) => {
    const v = value.trim();
    if (NUMERIC.has(name)) return NUM.test(v) ? v.replace(/px$/i, '') : undefined;
    if (FRACTION.has(name)) return PCT.test(v) ? v : undefined;
    if (PAINT.has(name)) return color(v) ?? ref(v);
    if (REF.has(name)) return ref(v);
    if (name in ENUMS) return ENUMS[name].includes(v) ? v : undefined;
    if (name === 'd') return PATH.test(v) ? v.replace(/\s+/g, ' ') : undefined;
    if (name === 'points') return POINTS.test(v) ? v.replace(/\s+/g, ' ') : undefined;
    if (name === 'transform' || name === 'gradientTransform') return TRANSFORM.test(v) ? v.replace(/\s+/g, ' ') : undefined;
    return undefined;
  };

  let root;
  let out = '';
  let skipDepth = 0;
  const open = [];
  for (const m of text.matchAll(/<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g)) {
    const [, closing, tag, attrSrc, selfClose] = m;
    if (closing) {
      const top = open.pop();
      if (top === undefined) continue;
      if (top.skip) skipDepth--;
      else if (top.emit) out += `</${top.tag}>`;
      continue;
    }
    if (tag === 'svg' && root === undefined) {
      root = Object.fromEntries(parseAttrs(attrSrc));
      if (!selfClose) open.push({ tag, emit: false, skip: false });
      continue;
    }
    const skip = skipDepth > 0 || SKIP.has(tag) || !KEEP.has(tag);
    if (skip) {
      if (!selfClose) {
        open.push({ tag, emit: false, skip: true });
        skipDepth++;
      }
      continue;
    }
    // Attributes: class rules first, then presentation attributes, then style (CSS order of precedence).
    const attrs = new Map();
    const raw = parseAttrs(attrSrc);
    const cls = raw.find(([k]) => k === 'class')?.[1];
    for (const c of cls?.split(/\s+/) ?? []) for (const [k, v] of classes.get(c) ?? []) attrs.set(k, v);
    for (const [k, v] of raw) if (k !== 'class' && k !== 'style') attrs.set(k, v);
    for (const [k, v] of declarations(raw.find(([k]) => k === 'style')?.[1] ?? '')) attrs.set(k, v);
    if (attrs.get('display') === 'none' || attrs.get('visibility') === 'hidden') {
      if (!selfClose) {
        open.push({ tag, emit: false, skip: true });
        skipDepth++;
      }
      continue;
    }
    let s = `<${tag}`;
    const id = attrs.get('id');
    if (id !== undefined && ids.has(id)) s += ` id="${ids.get(id)}"`;
    for (const [k, v] of attrs) {
      if (k === 'id') continue;
      if ((k === 'href' || k === 'xlink:href') && (tag === 'linearGradient' || tag === 'radialGradient')) {
        const t = /^#(.+)$/.exec(v.trim());
        if (t && ids.has(t[1])) s += ` href="#${ids.get(t[1])}"`;
        continue;
      }
      const c = clean(k, v);
      if (c !== undefined) s += ` ${k}="${c}"`;
    }
    out += selfClose ? `${s}/>` : `${s}>`;
    if (!selfClose) open.push({ tag, emit: true, skip: false });
  }
  if (!root) throw new Error('no <svg> root');
  let vb = root.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some((x) => !Number.isFinite(x))) {
    const w = parseFloat(root.width);
    const h = parseFloat(root.height);
    if (!(w > 0 && h > 0)) throw new Error('no viewBox or size');
    vb = [0, 0, w, h];
  }
  if (!/<(path|rect|circle|ellipse|polygon|polyline|line)\b/.test(out)) throw new Error('no drawing left');
  // Empty groups and empty defs add nothing.
  let prev;
  do {
    prev = out;
    out = out.replace(/<(g|defs)>\s*<\/\1>/g, '');
  } while (out !== prev);
  return { vb: vb.map((x) => +x.toFixed(3)).join(' '), body: out };
}
