/**
 * Static server for public/ with an /api passthrough to the deployed site.
 *
 * Written for scripts/generate-widget-previews.mjs. Shooting the previews
 * straight off the deployed dashboard is the obvious approach, but a headless
 * browser behind a policy proxy loses the tunnel mid-page. Serving locally
 * keeps every browser request on localhost, and this process makes the few
 * upstream calls the data-backed widgets need (offers, events, feeds) from
 * Node, which handles the proxy properly.
 *
 * Run: node scripts/serve-public.mjs [--port 8099] [--upstream <origin>]
 * Note: set NODE_USE_ENV_PROXY=1 on Node 22+ if the environment uses a proxy.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('--port', '8099'));
const UPSTREAM = arg('--upstream', 'https://tg-widgets.vercel.app').replace(/\/$/, '');
const ROOT = fileURLToPath(new URL('../public/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
        method: req.method,
        headers: { accept: req.headers.accept || '*/*' },
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'access-control-allow-origin': '*',
      });
      return res.end(body);
    } catch (err) {
      // A widget that cannot reach its data should draw its empty state, not
      // hang the page and stall the capture behind it.
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'upstream_unreachable', detail: String(err.message || err) }));
    }
  }

  // Serve from public/, defaulting to index.html, and accepting the extensionless
  // paths vercel.json rewrites (/editor-faq -> /editor-faq.html).
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (rel === '/' || rel === '') rel = '/index.html';
  let file = join(ROOT, rel);
  try {
    const s = await stat(file).catch(() => null);
    if (!s || s.isDirectory()) {
      if ((await stat(file + '.html').catch(() => null))) file += '.html';
      else if (s && s.isDirectory()) file = join(file, 'index.html');
    }
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving public/ on http://127.0.0.1:${PORT} (api -> ${UPSTREAM})`);
});
