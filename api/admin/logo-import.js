/**
 * /api/admin/logo-import
 *
 * One-off migration: copy the retired tg-logo-library app's brands into the
 * in-repo logo library (/api/logo-library), re-uploading every image into
 * OUR Blob store so nothing keeps depending on the old app.
 *
 *   GET (no flag)  → discovery only: which index URL was found and how many
 *                    brands it holds, with a shape sample. Writes nothing.
 *   GET ?run=1     → import, browser-clickable (POST also works). Skips
 *                    brands whose name is already in our index, so it is
 *                    safe to run repeatedly until done.
 *
 * The old app's exact API is unknown from this repo, so discovery tries the
 * likely JSON paths and, failing those, reads the old picker's JS and lifts
 * any same-host fetch path out of it. Everything is pinned to the old app's
 * origin — this endpoint can fetch nothing else.
 *
 * Admin-gated. Time-budgeted (vercel.json maxDuration 120): a run that runs
 * out of time reports imported-so-far with exhausted:true; run it again to
 * continue.
 */

import { requireAdmin, setAdminCors } from './_guard.js';
import { getJson, setJson } from '../_redis.js';

const OLD_ORIGIN = 'https://tg-logo-library.vercel.app';
const INDEX_KEY = 'logolib:index:v1';
const CANDIDATE_PATHS = [
  '/api/brands', '/api/logos', '/api/library',
  '/brands.json', '/logos.json', '/data/brands.json', '/index.json',
];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const TIME_BUDGET_MS = 100 * 1000;
const CONCURRENCY = 4;

async function fetchOld(path, asText) {
  const r = await fetch(OLD_ORIGIN + path, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return asText ? r.text() : r.json();
}

/** Find the old app's brand index: try known paths, then mine its picker JS
 *  for same-host fetch paths and try those. Returns { path, list } or null. */
async function discoverIndex() {
  const tried = [];
  const paths = [...CANDIDATE_PATHS];
  try {
    const js = await fetchOld('/logo-picker.js', true);
    const re = /fetch\(\s*(['"`])([^'"`]+)\1/g;
    let m;
    while ((m = re.exec(js))) {
      let p = m[2];
      if (p.startsWith(OLD_ORIGIN)) p = p.slice(OLD_ORIGIN.length);
      if (p.startsWith('/') && !paths.includes(p)) paths.push(p);
    }
  } catch (e) {
    tried.push({ path: '/logo-picker.js', error: e.message });
  }
  for (const path of paths) {
    try {
      const data = await fetchOld(path);
      const list = Array.isArray(data) ? data
        : (data && Array.isArray(data.brands)) ? data.brands
        : (data && Array.isArray(data.data)) ? data.data
        : (data && Array.isArray(data.logos)) ? data.logos
        : null;
      if (list && list.length) return { path, list, tried };
      tried.push({ path, error: list ? 'empty list' : 'unrecognised shape' });
    } catch (e) {
      tried.push({ path, error: e.message });
    }
  }
  return { path: null, list: null, tried };
}

/** Map whatever shape the old app used onto our brand fields. */
function mapBrand(b) {
  if (!b || typeof b !== 'object') return null;
  const name = String(b.name || b.title || b.brand || '').trim().slice(0, 80);
  if (!name) return null;
  const host = String(b.domain || b.website || b.url || '').trim()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].toLowerCase();
  const domain = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(host) ? host : '';
  const category = String(b.category || b.group || '').trim().slice(0, 40);
  let assets = Array.isArray(b.assets)
    ? b.assets.filter((a) => a && a.url).map((a) => ({ type: String(a.type || 'Image'), url: String(a.url) }))
    : [];
  const single = b.preferredUrl || b.image || b.logo || b.src;
  if (!assets.length && single) assets = [{ type: 'Image', url: String(single) }];
  if (!assets.length) return null;
  const pick = (t) => assets.find((a) => a.type === t);
  const preferred = (pick('SVG') || pick('PNG-Transparent') || assets[0]).url;
  return { name, domain, category, assets, preferredUrl: preferred };
}

const EXT_BY_TYPE = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/gif': 'gif',
};

async function copyImage(url, name, put, token) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('image HTTP ' + r.status);
  const declared = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error('empty image');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('image too large');
  const looksSvg = declared === 'image/svg+xml' || /^\s*<(\?xml|svg)/i.test(buf.toString('utf8', 0, 200));
  const type = looksSvg ? 'image/svg+xml' : (EXT_BY_TYPE[declared] ? declared : 'image/png');
  const ext = EXT_BY_TYPE[type];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'logo';
  const blob = await put(`logo-library/${slug}.${ext}`, buf, {
    access: 'public',
    addRandomSuffix: true,
    contentType: type,
    token,
  });
  return { url: blob.url, type: looksSvg ? 'SVG' : (type === 'image/png' ? 'PNG-Transparent' : 'Image') };
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const started = Date.now();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (?probe=1 or ?run=1) or POST only' });
  }
  // ?run=1 lets the admin trigger the import from the browser address bar —
  // this is a staff-gated one-off migration tool, so a GET with an explicit
  // run flag is a fair trade against making Andy craft a POST.
  const q = req.query || {};
  const doImport = req.method === 'POST' || q.run === '1' || q.run === 'true';

  try {
    const found = await discoverIndex();
    if (!found.list) {
      return res.status(502).json({
        ok: false,
        error: 'Could not find the old library index',
        tried: found.tried,
        hint: 'Open ' + OLD_ORIGIN + ' in devtools, note the JSON URL its picker fetches, and tell Claude the path.',
      });
    }
    const mapped = found.list.map(mapBrand).filter(Boolean);
    if (!doImport) {
      return res.status(200).json({
        ok: true,
        probe: true,
        indexPath: found.path,
        totalFound: found.list.length,
        usable: mapped.length,
        sample: mapped.slice(0, 3),
        next: 'Looks right? Add ?run=1 to this URL to import.',
      });
    }

    const token = process.env.TG_Blob_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return res.status(500).json({ ok: false, error: 'Blob storage not configured' });
    const { put } = await import('@vercel/blob');

    const idx = (await getJson(INDEX_KEY)) || { brands: [], updatedAt: null };
    if (!Array.isArray(idx.brands)) idx.brands = [];
    const have = new Set(idx.brands.map((b) => String(b.name).toLowerCase()));

    const todo = mapped.filter((b) => !have.has(b.name.toLowerCase()));
    const results = { imported: 0, skippedExisting: mapped.length - todo.length, failed: [], exhausted: false };
    const added = [];

    let i = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
      while (i < todo.length) {
        if (Date.now() - started > TIME_BUDGET_MS) { results.exhausted = true; return; }
        const b = todo[i++];
        try {
          // Copy the preferred asset only — one good image per brand beats
          // dragging every variant across.
          const copied = await copyImage(b.preferredUrl, b.name, put, token);
          added.push({
            id: 'lg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
            name: b.name,
            domain: b.domain,
            category: b.category,
            assets: [{ type: copied.type, url: copied.url }],
            preferredUrl: copied.url,
            addedBy: 'import:tg-logo-library',
            addedAt: new Date().toISOString(),
          });
          results.imported++;
        } catch (e) {
          results.failed.push({ name: b.name, error: e.message });
        }
      }
    }));

    if (added.length) {
      idx.brands.push(...added);
      idx.brands.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      idx.updatedAt = new Date().toISOString();
      if (!(await setJson(INDEX_KEY, idx))) {
        return res.status(500).json({ ok: false, error: 'Copied images but could not write the index', ...results });
      }
    }
    return res.status(200).json({ ok: true, indexPath: found.path, totalInLibrary: idx.brands.length, ...results });
  } catch (err) {
    console.error('[logo-import]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
