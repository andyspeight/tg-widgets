/**
 * Travelgenix Widget Suite — Offer Photo Upload (same-origin server proxy)
 *
 * The robust sibling to api/upload-photo.js. That route uses Vercel Blob's
 * CLIENT upload: the browser loads the @vercel/blob SDK from a third-party CDN
 * (esm.sh) and then uploads straight to blob.vercel-storage.com. A locked-down
 * corporate network (agency offices — Tullys Travel, Aug 2026) blocks one or
 * both of those external hosts, and the upload silently fails.
 *
 * This route removes every external dependency the browser touches: the browser
 * sends the image to THIS same-origin endpoint and the SERVER streams it to
 * Blob. Nothing but our own origin is contacted, so it works through firewalls
 * that block third-party CDNs and storage domains.
 *
 * Transport: the image rides as base64 inside a normal JSON body. That uses the
 * exact body handling every other endpoint here relies on (req.body, parsed) —
 * NOT a raw request stream. An earlier raw-stream version hung forever on
 * "Uploading…" because `bodyParser:false` is a Next.js flag these plain Vercel
 * functions do not honour, so the stream was already consumed and the read never
 * resolved. base64 inflates by ~33%, and a Vercel request body is capped at
 * 4.5MB, so this path carries images up to ~3.3MB; the builder sends larger
 * files down the client route (upload-photo.js) as a fallback.
 *
 * Request:  POST { filename, contentType, dataBase64 }
 * Response: { url } — the public Blob URL.
 *
 * Auth: same-origin tg_session cookie, verified by requireAuth. Requires
 * BLOB_READ_WRITE_TOKEN (set when a Blob store is connected to the project).
 */

import { requireAuth } from './_lib/auth/middleware.js';
import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

// Decoded image ceiling. base64 of this stays comfortably under Vercel's 4.5MB
// request-body limit, so the browser's JSON post is never rejected upstream.
const MAX_PHOTO_BYTES = 3.3 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** True for a mime we accept. Exact match against the allow-list, case-folded. */
export function isAllowedImageType(ct) {
  return ALLOWED_TYPES.indexOf(String(ct || '').toLowerCase().split(';')[0].trim()) !== -1;
}

/** Mirror the widget's safeFileName: keep a short, path-free, plain name so a
 *  crafted filename can never escape the offer-photos/ prefix or the URL. */
export function sanitiseUploadName(name) {
  const base = String(name == null ? 'photo' : name)
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .trim()
    .slice(0, 80);
  return base || 'photo';
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Offer photos are PUBLIC (shown on offer cards + pages). The project's default
  // BLOB_READ_WRITE_TOKEN points at a PRIVATE store that rejects access:'public'
  // writes ("Cannot use public access on a private store"), so — exactly like the
  // logo uploads — write via the dedicated public-store token when present. This
  // was the real cause of every "photo upload failed": the private store, not a
  // network block.
  const blobToken = process.env.TG_Blob_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    console.error('[upload-photo-direct] No Blob read-write token set');
    return res.status(500).json({ error: 'Storage not configured' });
  }

  const ctx = await requireAuth(req, res);
  if (!ctx) return; // middleware wrote the 401

  const key = (ctx.email || '').toLowerCase().trim() || ctx.userRecordId || ctx.clientRecordId || 'unknown';
  if (!applyRateLimit(res, `uploadphoto:${key}`, RATE_LIMITS.widgetWrite)) return;

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const contentType = String(body.contentType || '').toLowerCase().split(';')[0].trim();
  if (!isAllowedImageType(contentType)) {
    return res.status(400).json({ error: 'Only JPG, PNG, WebP, GIF or AVIF images are allowed' });
  }

  const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
  if (!dataBase64) return res.status(400).json({ error: 'No image data' });

  let buf;
  try {
    buf = Buffer.from(dataBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Could not decode the image' });
  }
  if (!buf.length) return res.status(400).json({ error: 'Empty image' });
  if (buf.length > MAX_PHOTO_BYTES) {
    return res.status(413).json({ error: 'Image is too large for direct upload' });
  }

  const name = sanitiseUploadName(body.filename);

  try {
    const { put } = await import('@vercel/blob');
    const blob = await put('offer-photos/' + name, buf, {
      access: 'public',
      contentType,
      addRandomSuffix: true,
      token: blobToken,
    });
    return res.status(200).json({ url: blob && blob.url });
  } catch (err) {
    console.error('[upload-photo-direct] put failed:', err && err.message);
    return res.status(502).json({ error: 'Upload storage error' });
  }
}
