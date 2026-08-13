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
 * POSTs the raw image bytes to THIS same-origin endpoint, and the SERVER streams
 * them to Blob with put(). Nothing but our own origin is contacted, so it works
 * through firewalls that block third-party CDNs and storage domains.
 *
 * Trade-off: a Vercel function request body is capped at 4.5MB, so this path
 * handles photos up to ~4MB. The builder sends larger files down the client
 * route (upload-photo.js) as a fallback, so the 8MB ceiling still holds when the
 * network allows it.
 *
 * Request:  POST raw image bytes; Content-Type is the image mime; optional
 *           `x-filename` header for a friendly stored name.
 * Response: { url } — the public Blob URL.
 *
 * Auth: same-origin tg_session cookie, verified by requireAuth. Requires
 * BLOB_READ_WRITE_TOKEN (set when a Blob store is connected to the project).
 */

import { requireAuth } from './_lib/auth/middleware.js';
import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

// The function reads the raw request body itself, so Vercel's JSON/body parser
// must be off or it would consume the stream before we can.
export const config = { api: { bodyParser: false } };

const MAX_PHOTO_BYTES = 4.5 * 1024 * 1024; // Vercel request-body ceiling
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

/** Read the request stream into a Buffer, rejecting once it exceeds `limit`. */
function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too large'));
        try { req.destroy(); } catch { /* noop */ }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[upload-photo-direct] BLOB_READ_WRITE_TOKEN not set');
    return res.status(500).json({ error: 'Storage not configured' });
  }

  // Auth reads the cookie/header only — it never touches the body stream, so it
  // is safe to run before we read the raw bytes.
  const ctx = await requireAuth(req, res);
  if (!ctx) return; // middleware wrote the 401

  const key = (ctx.email || '').toLowerCase().trim() || ctx.userRecordId || ctx.clientRecordId || 'unknown';
  if (!applyRateLimit(res, `uploadphoto:${key}`, RATE_LIMITS.widgetWrite)) return;

  const contentType = String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
  if (!isAllowedImageType(contentType)) {
    return res.status(400).json({ error: 'Only JPG, PNG, WebP, GIF or AVIF images are allowed' });
  }

  let buf;
  try {
    buf = await readRawBody(req, MAX_PHOTO_BYTES);
  } catch (err) {
    if (err && err.message === 'too large') {
      return res.status(413).json({ error: 'Image is over 4MB for direct upload' });
    }
    console.error('[upload-photo-direct] body read failed:', err && err.message);
    return res.status(400).json({ error: 'Could not read the image' });
  }
  if (!buf || !buf.length) return res.status(400).json({ error: 'Empty upload' });

  let name = 'photo';
  try {
    name = sanitiseUploadName(decodeURIComponent(String(req.headers['x-filename'] || 'photo')));
  } catch {
    name = sanitiseUploadName(String(req.headers['x-filename'] || 'photo'));
  }

  try {
    const { put } = await import('@vercel/blob');
    const blob = await put('offer-photos/' + name, buf, {
      access: 'public',
      contentType,
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return res.status(200).json({ url: blob && blob.url });
  } catch (err) {
    console.error('[upload-photo-direct] put failed:', err && err.message);
    return res.status(502).json({ error: 'Upload storage error' });
  }
}
