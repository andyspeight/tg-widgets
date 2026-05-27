/**
 * Travelgenix Widget Suite — PDF Upload (Vercel Blob client-upload token route)
 *
 * The Quote PDF editor uploads attachment PDFs (T&Cs etc) DIRECTLY to Vercel
 * Blob from the browser, using a short-lived client token this route mints.
 *
 * Why client-upload (not the file through this function): Vercel functions have
 * a hard 4.5MB request-body limit. A PDF base64-encoded in a JSON body easily
 * breaches that and the platform rejects it with a 500 BEFORE our code runs.
 * The client-upload pattern streams the file straight to Blob storage and never
 * routes the bytes through this function, so file size is bounded only by the
 * Blob limit (and our maximumSizeInBytes below), not the function body limit.
 *
 * Flow:
 *   1. Browser calls upload(pathname, file, { handleUploadUrl: '/api/upload-pdf' })
 *   2. The SDK POSTs a "generate client token" request to THIS route.
 *   3. onBeforeGenerateToken authenticates the user and restricts the upload
 *      to PDFs under the size cap, scoped to the client's folder.
 *   4. The browser uploads the file to Blob with the returned token.
 *
 * Auth: the initial token request comes from the browser and is authenticated
 * via the same-origin tg_session cookie (the @vercel/blob client SDK cannot set
 * a custom Authorization header on the token request — vercel/storage#796 — but
 * the cookie rides along automatically on the same-origin POST). The follow-up
 * upload-completed callback is a server-to-server webhook from Vercel with NO
 * cookie; handleUpload verifies that one cryptographically via the
 * BLOB_WEBHOOK_PUBLIC_KEY, so we must NOT gate it behind requireAuth.
 *
 * Requires BLOB_READ_WRITE_TOKEN (set automatically when a Blob store is
 * connected to the project).
 */

import { requireAuth } from './_lib/auth/middleware.js';
import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB cap per attachment

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[upload-pdf] BLOB_READ_WRITE_TOKEN not set');
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
    if (!clientEmail) return res.status(401).json({ error: 'Authentication required' });
    if (!applyRateLimit(res, `uploadpdf:${clientEmail}`, RATE_LIMITS.widgetWrite)) return;
  }

  try {
    const { handleUpload } = await import('@vercel/blob/client');
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // Authorise: PDFs only, under the quote-pdf/ prefix, within the size cap.
        // These are public documents (shown to customers), uploads are auth-
        // gated, and addRandomSuffix prevents overwrites, so a shared prefix is
        // fine — per-client folders aren't a security boundary here.
        if (typeof pathname !== 'string' || pathname.indexOf('quote-pdf/') !== 0) {
          throw new Error('Invalid upload path');
        }
        return {
          allowedContentTypes: ['application/pdf'],
          maximumSizeInBytes: MAX_PDF_BYTES,
          addRandomSuffix: true,
        };
      },
      // upload-completed fires via a Blob webhook after the browser finishes.
      // No server-side post-processing needed — the editor stores the returned
      // URL in the widget config on save — so this is a no-op.
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('[upload-pdf] handleUpload failed:', err?.message);
    const msg = err?.message || 'Upload failed';
    const status = /path|content type|size|token/i.test(msg) ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
}
