/**
 * /api/admin/logo-import
 *
 * One-off migration into the in-repo logo library (/api/logo-library).
 *
 * The old tg-logo-library app was backed by the "Logo Library" Airtable base
 * (appWOGt1R6SaoSaVy). Its Brands + Assets tables were exported on
 * 3 Jul 2026 into public/logo-import-manifest.json (230 brands, 462 asset
 * files, all on the old app's public Blob store) — so this endpoint needs
 * no discovery and no old-app password. It copies each brand's best asset
 * (SVG, else transparent PNG, else original PNG) into OUR Blob store and
 * adds the entry to the Redis index, so nothing keeps depending on the old
 * app and it can be retired.
 *
 *   GET (no flag)  → probe: how many brands the manifest holds and how many
 *                    are still to import. Writes nothing.
 *   GET ?run=1     → import, browser-clickable (POST also works). Skips
 *                    brands whose name is already in our index, so it is
 *                    safe to run repeatedly until "remaining: 0".
 *
 * Admin-gated. Time-budgeted (vercel.json maxDuration 120): a run that
 * reports exhausted:true just needs running again to continue.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireAdmin, setAdminCors } from './_guard.js';
import { getJson, setJson } from '../_redis.js';

const INDEX_KEY = 'logolib:index:v1';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const TIME_BUDGET_MS = 100 * 1000;
const CONCURRENCY = 4;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, '..', '..', 'public', 'logo-import-manifest.json');

function loadManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data.brands) ? data.brands : [];
}

const EXT_BY_TYPE = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/gif': 'gif',
};

async function copyImage(asset, name, put, token) {
  const r = await fetch(asset.url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('image HTTP ' + r.status);
  const declared = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error('empty image');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('image too large');
  const looksSvg = declared === 'image/svg+xml' || asset.type === 'SVG' || /^\s*<(\?xml|svg)/i.test(buf.toString('utf8', 0, 200));
  const type = looksSvg ? 'image/svg+xml' : (EXT_BY_TYPE[declared] ? declared : 'image/png');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'logo';
  const blob = await put(`logo-library/${slug}.${EXT_BY_TYPE[type]}`, buf, {
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
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (?run=1 to import) or POST only' });
  }
  const q = req.query || {};
  const doImport = req.method === 'POST' || q.run === '1' || q.run === 'true';
  const started = Date.now();

  try {
    const manifest = loadManifest();
    const idx = (await getJson(INDEX_KEY)) || { brands: [], updatedAt: null };
    if (!Array.isArray(idx.brands)) idx.brands = [];
    const have = new Set(idx.brands.map((b) => String(b.name).toLowerCase()));
    const todo = manifest.filter((b) => !have.has(String(b.name).toLowerCase()));

    if (!doImport) {
      return res.status(200).json({
        ok: true,
        probe: true,
        manifestBrands: manifest.length,
        alreadyImported: manifest.length - todo.length,
        remaining: todo.length,
        sample: todo.slice(0, 3).map((b) => b.name),
        next: todo.length ? 'Add ?run=1 to this URL to import.' : 'Nothing left to import.',
      });
    }

    const token = process.env.TG_Blob_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return res.status(500).json({ ok: false, error: 'Blob storage not configured' });
    const { put } = await import('@vercel/blob');

    const results = { imported: 0, skippedExisting: manifest.length - todo.length, failed: [], exhausted: false };
    const added = [];

    let i = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
      while (i < todo.length) {
        if (Date.now() - started > TIME_BUDGET_MS) { results.exhausted = true; return; }
        const b = todo[i++];
        try {
          // Copy the best asset only (manifest assets are pre-sorted:
          // SVG > PNG-Transparent > PNG-Original).
          const copied = await copyImage(b.assets[0], b.name, put, token);
          added.push({
            id: 'lg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
            name: b.name,
            domain: b.domain || '',
            category: b.category === 'Other' ? '' : (b.category || ''),
            ...(b.tgSupplier ? { tgSupplier: true } : {}),
            ...(b.colourPrimary ? { colourPrimary: b.colourPrimary } : {}),
            ...(b.colourSecondary ? { colourSecondary: b.colourSecondary } : {}),
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
    return res.status(200).json({
      ok: true,
      totalInLibrary: idx.brands.length,
      remaining: todo.length - results.imported, // failures stay remaining — they retry next run
      ...results,
      next: results.exhausted ? 'Ran out of time — click ?run=1 again to continue.' : (results.failed.length ? 'Some images failed — click again to retry them.' : 'Done.'),
    });
  } catch (err) {
    console.error('[logo-import]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
