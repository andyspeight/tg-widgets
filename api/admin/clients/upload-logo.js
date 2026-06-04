/**
 * POST /api/admin/clients/upload-logo
 *
 * Vercel Blob client-upload token route for agency logos set on the Control
 * client-detail Branding tab. Mirrors api/upload-pdf.js: the browser uploads
 * the (already resized + PNG-converted) image DIRECTLY to Blob using a
 * short-lived token this route mints, so the bytes never pass through the
 * function body and we sidestep Vercel's 4.5MB request-body limit.
 *
 * Flow:
 *   1. Browser calls upload(pathname, file, { handleUploadUrl: '/api/admin/clients/upload-logo' })
 *   2. The SDK POSTs a "generate client token" request to THIS route.
 *   3. onBeforeGenerateToken restricts uploads to images under the size cap,
 *      scoped to the client-logos/ prefix.
 *   4. The browser uploads the file to Blob with the returned token.
 *
 * Auth: the token request is gated to Travelgenix staff (widget_suite owner or
 * admin) via the same-origin tg_session cookie. The upload-completed webhook
 * from Vercel carries no cookie and is verified by handleUpload itself, so it
 * must NOT be gated behind auth.
 *
 * Requires BLOB_READ_WRITE_TOKEN (set automatically when a Blob store is
 * connected to the project).
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { setCors, applyRateLimit, RATE_LIMITS } from '../../_auth.js';
import { PRODUCTS, PERMISSIONS } from '../../_lib/auth/schema.js';

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB cap (logos are tiny after client-side resize)
// The browser rasterises every logo (including SVG) to PNG before upload, so
// only raster types are accepted here. Raw SVG is never stored.
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[upload-logo] BLOB_READ_WRITE_TOKEN not set');
    return res.status(500).json({ error: 'Storage not configured' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // Gate the browser's token request to staff. The Vercel upload-completed
  // webhook (body.type === 'blob.upload-completed') has no cookie and is
  // verified cryptographically by handleUpload, so don't gate that one.
  if (body && body.type === 'blob.generate-client-token') {
    const ctx = await requireAuth(req, res);
    if (!ctx) return; // middleware wrote the 401
    const role = requireProductAccess(
      ctx,
      PRODUCTS.slugs.WIDGET_SUITE,
      [PERMISSIONS.roles.OWNER, PERMISSIONS.roles.ADMIN],
      res
    );
    if (!role) return; // requireProductAccess wrote the 403
    const who = (ctx.email || '').toLowerCase().trim() || 'staff';
    if (!applyRateLimit(res, `uploadlogo:${who}`, RATE_LIMITS.widgetWrite)) return;
  }

  try {
    const { handleUpload } = await import('@vercel/blob/client');
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (typeof pathname !== 'string' || pathname.indexOf('client-logos/') !== 0) {
          throw new Error('Invalid upload path');
        }
        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_LOGO_BYTES,
          addRandomSuffix: true,
        };
      },
      // The browser stores the returned URL in the Branding form and persists
      // it via update-branding on Save, so no server post-processing is needed.
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('[upload-logo] handleUpload failed:', err?.message);
    const msg = err?.message || 'Upload failed';
    const status = /path|content type|size|token/i.test(msg) ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
}
