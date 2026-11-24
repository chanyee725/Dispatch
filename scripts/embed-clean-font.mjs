// Writes the two subset files under shared/render/fonts/ into shared/render/font-clean.ts as base64.
// Run from the repo root after scripts/subset-clean-font.py: node scripts/embed-clean-font.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'shared/render/font-clean.ts';
let text = readFileSync(file, 'utf8');
for (const weight of [400, 600]) {
  const b64 = readFileSync(`shared/render/fonts/drawing-sans-latin-${weight}.woff2`).toString('base64');
  const re = new RegExp(`(DRAWING_SANS_${weight}_WOFF2_BASE64 =\\s*')[A-Za-z0-9+/=]*(';)`);
  if (!re.test(text)) throw new Error(`no DRAWING_SANS_${weight}_WOFF2_BASE64 in ${file}`);
  text = text.replace(re, (_, a, z) => a + b64 + z);
}
writeFileSync(file, text);
