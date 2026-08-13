/**
 * Travelgenix Widget Suite — Offer Photo Upload (Vercel Blob client-upload token)
 *
 * The Special Offer Builder uploads offer photos DIRECTLY to Vercel Blob from the
 * browser, using a short-lived client token this route mints. Same pattern and
 * reasoning as api/upload-pdf.js — the bytes never pass through this function, so
 * the upload is bounded by the Blob limit (and our cap below), not Vercel's
 * 4.5MB request-body limit.
 *
 * Flow:
 *   1. Browser calls upload(pathname, file, { handleUploadUrl: '/api/upload-photo' })
 *   2. The SDK POSTs a "generate client token" request to THIS route.
 *   3. onBeforeGenerateToken authenticates the user and restricts the upload to
 *      images under the size cap, scoped to the offer-photos/ prefix.
 *   4. The browser uploads the file to Blob with the returned token.
 *
 * Auth: the token request is authenticated via the same-origin tg_session cookie
 * (the @vercel/blob client SDK cannot set a custom Authorization header on the
 * token request — vercel/storage#796 — but the cookie rides along on the
 * same-origin POST). The upload-completed callback is a signed server-to-server
 * webhook from Vercel with NO cookie, verified by handleUpload itself, so it must
 * NOT be gated behind requireAuth.
 *
 * Requires BLOB_READ_WRITE_TOKEN (set automatically when a Blob store is
 * connected to the project).
 */

import { requireAuth } from './_lib/auth/middleware.js';
import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB cap per photo
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Offer photos are PUBLIC. The default BLOB_READ_WRITE_TOKEN is a PRIVATE store
  // that rejects access:'public' writes, so mint the client token against the
  // dedicated public store (same token the logo uploads use) when present.
  const blobToken = process.env.TG_Blob_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    console.error('[upload-photo] No Blob read-write token set');
    return res.status(500).json({ error: 'Storage not configured' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // The browser's initial token request must be authenticated. The Vercel
  // upload-completed webhook (body.type === 'blob.upload-completed') carries no
  // cookie and is verified by handleUpload itself, so don't gate that one.
  if (body && body.type === 'blob.generate-client-token') {
    const ctx = await requireAuth(req, res);
    if (!ctx) return; // middleware wrote the 401
    const clientEmail = (ctx.email || '').toLowerCase().trim();
    const key = clientEmail || ctx.userRecordId || ctx.clientRecordId || 'unknown';
    if (!applyRateLimit(res, `uploadphoto:${key}`, RATE_LIMITS.widgetWrite)) return;
  }

  try {
    const { handleUpload } = await import('@vercel/blob/client');
    const jsonResponse = await handleUpload({
      body,
      request: req,
      token: blobToken, // mint the client token against the public store
      onBeforeGenerateToken: async (pathname) => {
        // Authorise: images only, under the offer-photos/ prefix, within the cap.
        // These are public images (shown on offer cards and pages), uploads are
        // auth-gated, and addRandomSuffix prevents overwrites, so a shared prefix
        // is fine — per-client folders aren't a security boundary here.
        if (typeof pathname !== 'string' || pathname.indexOf('offer-photos/') !== 0) {
          throw new Error('Invalid upload path');
        }
        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_PHOTO_BYTES,
          addRandomSuffix: true,
        };
      },
      // No server-side post-processing — the builder stores the returned URL in
      // the offer's images array on save — so this is a no-op.
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('[upload-photo] handleUpload failed:', err?.message);
    const msg = err?.message || 'Upload failed';
    const status = /path|content type|size|token/i.test(msg) ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
}
