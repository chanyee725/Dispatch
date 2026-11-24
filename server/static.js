// Serve the built web app from public/, falling back to index.html.
import { open, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

// Only this server's origin: nothing may reach a CDN, and diagram content
// (HTML labels, images) cannot pull in or send anything out.
// 'unsafe-inline' styles: React and the canvas libraries write style attributes.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' };

export async function serveStatic(req, res, pathname, publicDir) {
  let rel;
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = join(publicDir, rel);
  if (!file.startsWith(publicDir.endsWith(sep) ? publicDir : publicDir + sep) && file !== publicDir) {
    res.writeHead(403).end();
    return;
  }
  let st = await stat(file).catch(() => null);
  if (!st || st.isDirectory()) {
    file = join(publicDir, 'index.html');
    st = await stat(file).catch(() => null);
    if (!st) {
      res.writeHead(503, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
      res.end('Web app not built. Run: npm run build\n');
      return;
    }
  }
  // Open before sending headers so an unreadable file gives a clean error status.
  let fh;
  try {
    fh = await open(file, 'r');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found\n');
    return;
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': st.size,
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') {
    await fh.close();
    return res.end();
  }
  try {
    await pipeline(fh.createReadStream(), res);
  } catch (err) {
    // Client went away or the read failed mid-stream; drop the response, keep the server up.
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('static read failed:', err.code ?? err.message);
    res.destroy();
  }
}
