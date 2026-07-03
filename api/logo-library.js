/**
 * /api/logo-library
 *
 * The Travelgenix shared logo library, now living inside tg-widgets
 * (decision 3 Jul 2026 — it previously lived in the separate
 * tg-logo-library app, which the editors only consumed via its hosted
 * picker). Images live in the public Vercel Blob store; the index lives
 * in Redis under one key.
 *
 *   GET          → { brands: [{ id, name, domain, category, assets,
 *                    preferredUrl, canDelete }], updatedAt }
 *   POST         → add a logo { name, category?, domain?, dataUrl }
 *                  → { ok, brand }. Uploads are shared with every client
 *                  instantly (locked decision 3 Jul 2026).
 *   DELETE ?id=  → remove an entry. Staff or the original uploader only.
 *
 * Auth: any signed-in user — editors are same-origin so the session cookie
 * rides along, and requireAuth also honours Bearer tokens. Rate limited on
 * writes. The index is read-modify-write without a lock: uploads are rare
 * and human-paced, so a lost update is theoretical; revisit if the library
 * ever gets automated writers.
 */

import { requireAuth } from './_lib/auth/middleware.js';
import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import { jsonError } from './_lib/auth/http.js';
import { isStaffEmail } from './_lib/auth/staff.js';
import { getJson, setJson } from './_redis.js';

const INDEX_KEY = 'logolib:index:v1';
const MAX_BRANDS = 800;
const MAX_BYTES = 2 * 1024 * 1024; // matches upload-logo.js
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

const blobToken = () => process.env.TG_Blob_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;

async function readIndex() {
  const idx = await getJson(INDEX_KEY);
  return (idx && Array.isArray(idx.brands)) ? idx : { brands: [], updatedAt: null };
}

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

// Accept "abta.com", "www.abta.com" or a full URL; store the bare hostname.
function cleanDomain(v) {
  let s = cleanText(v, 200).toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(s) ? s : '';
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'logo';
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ctx = await requireAuth(req, res);
  if (!ctx) return; // middleware wrote the 401
  const who = (ctx.email || '').toLowerCase().trim();
  if (!who) return jsonError(res, 401, 'no_email', 'Authentication required');
  const staff = isStaffEmail(who);

  // ── GET: the whole library (the picker filters client-side) ─────────────
  if (req.method === 'GET') {
    const idx = await readIndex();
    res.setHeader('Cache-Control', 'no-store'); // per-user canDelete → never shared-cache
    return res.status(200).json({
      updatedAt: idx.updatedAt,
      brands: idx.brands.map((b) => ({
        id: b.id,
        name: b.name,
        domain: b.domain || '',
        category: b.category || '',
        assets: b.assets || [],
        preferredUrl: b.preferredUrl || '',
        canDelete: staff || (b.addedBy && b.addedBy === who) || false,
      })),
    });
  }

  // ── POST: add a logo ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!applyRateLimit(res, `logolib:${who}`, RATE_LIMITS.widgetWrite)) return;
    const token = blobToken();
    if (!token) {
      console.error('[logo-library] No Blob read-write token set');
      return jsonError(res, 500, 'storage_unconfigured', 'Storage not configured');
    }

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch {
      return jsonError(res, 400, 'invalid_json', 'Body must be JSON');
    }

    const name = cleanText(body.name, 80);
    if (!name) return jsonError(res, 400, 'name_required', 'Give the logo a name');
    const category = cleanText(body.category, 40);
    const domain = cleanDomain(body.domain);

    const m = DATA_URL_RE.exec(String(body.dataUrl || ''));
    if (!m) return jsonError(res, 400, 'invalid_image', 'Expected a PNG, JPEG or WebP image');
    const contentType = m[1];
    let buffer;
    try { buffer = Buffer.from(m[2], 'base64'); } catch { buffer = null; }
    if (!buffer || !buffer.length) return jsonError(res, 400, 'invalid_image', 'The image was empty');
    if (buffer.length > MAX_BYTES) return jsonError(res, 400, 'too_large', 'Logo must be 2MB or smaller after processing');
    const okMagic =
      (contentType === 'image/png'  && buffer.length > 8  && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) ||
      (contentType === 'image/jpeg' && buffer.length > 3  && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) ||
      (contentType === 'image/webp' && buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP');
    if (!okMagic) return jsonError(res, 400, 'invalid_image', 'That does not look like a valid image');

    const idx = await readIndex();
    if (idx.brands.length >= MAX_BRANDS) {
      return jsonError(res, 413, 'library_full', 'The library is full — ask Travelgenix to prune it');
    }
    // Shared-instantly means name clashes pollute everyone's picker, so a
    // duplicate name is a prompt to search, not a second copy.
    if (idx.brands.some((b) => String(b.name).toLowerCase() === name.toLowerCase())) {
      return jsonError(res, 409, 'duplicate_name', 'A logo with that name is already in the library — search for it instead');
    }

    const ext = contentType === 'image/jpeg' ? 'jpg' : (contentType === 'image/webp' ? 'webp' : 'png');
    let url;
    try {
      const { put } = await import('@vercel/blob');
      const blob = await put(`logo-library/${slug(name)}.${ext}`, buffer, {
        access: 'public',
        addRandomSuffix: true,
        contentType,
        token,
      });
      url = blob.url;
    } catch (err) {
      console.error('[logo-library] put failed:', err?.message);
      return jsonError(res, 500, 'store_failed', 'Could not store the logo — please try again');
    }

    const assetType = contentType === 'image/png' ? 'PNG-Transparent' : (contentType === 'image/webp' ? 'WebP' : 'JPEG');
    const brand = {
      id: 'lg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      name,
      domain,
      category,
      assets: [{ type: assetType, url }],
      preferredUrl: url,
      addedBy: who,
      addedAt: new Date().toISOString(),
    };
    idx.brands.push(brand);
    idx.brands.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    idx.updatedAt = new Date().toISOString();
    if (!(await setJson(INDEX_KEY, idx))) {
      return jsonError(res, 500, 'index_failed', 'Could not update the library index — please try again');
    }
    const { addedBy, ...pub } = brand;
    return res.status(200).json({ ok: true, brand: { ...pub, canDelete: true } });
  }

  // ── DELETE: remove an entry (staff or uploader) ──────────────────────────
  if (req.method === 'DELETE') {
    if (!applyRateLimit(res, `logolib:${who}`, RATE_LIMITS.widgetWrite)) return;
    const id = cleanText((req.query || {}).id, 60);
    if (!id) return jsonError(res, 400, 'id_required', 'id required');
    const idx = await readIndex();
    const i = idx.brands.findIndex((b) => b.id === id);
    if (i === -1) return jsonError(res, 404, 'not_found', 'That logo is not in the library');
    const brand = idx.brands[i];
    if (!staff && brand.addedBy !== who) {
      return jsonError(res, 403, 'not_yours', 'Only Travelgenix staff or the uploader can remove this logo');
    }
    idx.brands.splice(i, 1);
    idx.updatedAt = new Date().toISOString();
    if (!(await setJson(INDEX_KEY, idx))) {
      return jsonError(res, 500, 'index_failed', 'Could not update the library index — please try again');
    }
    // Best-effort blob cleanup — the index is the source of truth, so a
    // failed file delete just leaves an unreferenced blob behind.
    try {
      const token = blobToken();
      const urls = (brand.assets || []).map((a) => a && a.url).filter(Boolean);
      if (token && urls.length) {
        const { del } = await import('@vercel/blob');
        await del(urls, { token });
      }
    } catch (err) {
      console.warn('[logo-library] blob delete failed (ignored):', err?.message);
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return jsonError(res, 405, 'method_not_allowed', 'GET, POST or DELETE only');
}
