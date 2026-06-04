/**
 * POST /api/admin/clients/upload-logo
 *
 * Stores an agency logo for the Control Branding tab. The browser rasterises
 * the chosen image (including SVG) down to a small PNG and POSTs it here as a
 * base64 data URL. This route decodes it and writes it to Vercel Blob with a
 * SERVER-SIDE put().
 *
 * Why server-side put (not the client-upload token flow used by upload-pdf.js):
 * logos are tiny (<=480px PNG), so they sit far under Vercel's request-body
 * limit. Posting the bytes here and writing to Blob server-side avoids the
 * browser's cross-origin PUT to blob.vercel-storage.com — that PUT was being
 * rejected (400) without CORS headers, so the client SDK could not read the
 * error and the upload stalled. This path has no cross-origin step and returns
 * a clean, readable error on failure.
 *
 * Auth: widget_suite owner or admin (Travelgenix staff).
 * Body: { id?: 'recXXX', dataUrl: 'data:image/png;base64,...' }
 * Returns: { ok: true, url }
 *
 * Requires BLOB_READ_WRITE_TOKEN (set automatically when a Blob store is
 * connected to the project).
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { setCors, applyRateLimit, RATE_LIMITS } from '../../_auth.js';
import { jsonError } from '../../_lib/auth/http.js';
import { PRODUCTS, PERMISSIONS } from '../../_lib/auth/schema.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB cap after browser-side resize
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', 'POST only');

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[upload-logo] BLOB_READ_WRITE_TOKEN not set');
    return jsonError(res, 500, 'storage_unconfigured', 'Storage not configured');
  }

  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  const role = requireProductAccess(
    ctx,
    PRODUCTS.slugs.WIDGET_SUITE,
    [PERMISSIONS.roles.OWNER, PERMISSIONS.roles.ADMIN],
    res
  );
  if (!role) return;
  const who = (ctx.email || '').toLowerCase().trim() || 'staff';
  if (!applyRateLimit(res, `uploadlogo:${who}`, RATE_LIMITS.widgetWrite)) return;

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return jsonError(res, 400, 'invalid_json', 'Body must be JSON');
  }

  const id = String(body.id || '').trim();
  if (id && !REC_ID_RE.test(id)) {
    return jsonError(res, 400, 'invalid_id', 'id must be a valid record id');
  }

  const m = DATA_URL_RE.exec(String(body.dataUrl || ''));
  if (!m) return jsonError(res, 400, 'invalid_image', 'Expected a PNG, JPEG or WebP image');
  const contentType = m[1];

  let buffer;
  try {
    buffer = Buffer.from(m[2], 'base64');
  } catch {
    return jsonError(res, 400, 'invalid_image', 'Could not decode the image');
  }
  if (!buffer.length) return jsonError(res, 400, 'invalid_image', 'The image was empty');
  if (buffer.length > MAX_BYTES) {
    return jsonError(res, 400, 'too_large', 'Logo must be 2MB or smaller after processing');
  }

  // Magic-byte check so the declared type matches the actual bytes.
  const okMagic =
    (contentType === 'image/png'  && buffer.length > 8  && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) ||
    (contentType === 'image/jpeg' && buffer.length > 3  && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) ||
    (contentType === 'image/webp' && buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP');
  if (!okMagic) return jsonError(res, 400, 'invalid_image', 'That does not look like a valid image');

  const ext = contentType === 'image/jpeg' ? 'jpg' : (contentType === 'image/webp' ? 'webp' : 'png');
  const pathname = `client-logos/${id || 'logo'}-${Date.now()}.${ext}`;

  try {
    const { put } = await import('@vercel/blob');
    const blob = await put(pathname, buffer, {
      access: 'public',
      addRandomSuffix: true,
      contentType,
    });
    return res.status(200).json({ ok: true, url: blob.url });
  } catch (err) {
    console.error('[upload-logo] put failed:', err?.message);
    return jsonError(res, 500, 'store_failed', 'Could not store the logo: ' + (err?.message || 'unknown error'));
  }
}
