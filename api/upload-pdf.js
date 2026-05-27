/**
 * Travelgenix Widget Suite — PDF Upload API
 *
 * Uploads a client's attachment PDF (e.g. Terms & Conditions) to Vercel Blob
 * and returns its public URL. Used by the Quote PDF editor so a client can
 * attach documents that get merged onto every quote and emailed alongside it.
 *
 * Auth: Bearer token required (verified via the SSO middleware). The upload is
 * scoped to the authenticated user's ClientEmail so one client cannot overwrite
 * another's files (the blob path is namespaced by a hash of the email).
 *
 * Method:
 *   POST { filename, dataBase64 }  → { url, name, size }
 *
 * Request body is JSON (not multipart) to stay consistent with the rest of the
 * suite — the editor reads the file with FileReader and sends base64. The PDF
 * is validated (magic bytes + size cap) before it touches Blob storage.
 *
 * Storage: Vercel Blob. Requires the BLOB_READ_WRITE_TOKEN env var (Vercel sets
 * this automatically once a Blob store is connected to the project).
 */

import { requireAuth } from './_lib/auth/middleware.js';
import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import { createHash } from 'crypto';

// 5 MB cap on a single attachment PDF. T&C documents are well under this; the
// cap stops a runaway upload from bloating storage or the merge step.
const MAX_PDF_BYTES = 5 * 1024 * 1024;

// Base64 inflates ~33%, plus JSON overhead. Reject obviously-too-large bodies
// before we even decode, so a giant payload can't burn memory.
const MAX_BODY_CHARS = Math.ceil(MAX_PDF_BYTES * 1.4);

function sanitiseFilename(name) {
  const base = String(name || 'document')
    .replace(/\\/g, '/')
    .split('/').pop()                 // strip any path
    .replace(/[^a-zA-Z0-9._ -]/g, '') // keep safe chars only
    .trim()
    .slice(0, 80);
  let out = base || 'document';
  if (!/\.pdf$/i.test(out)) out += '.pdf';
  return out;
}

// Namespace blob paths by a short hash of the client email so files are grouped
// per client and one client can't guess/overwrite another's path.
function clientFolder(email) {
  return createHash('sha256').update(email).digest('hex').slice(0, 16);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth — middleware writes its own 401 and returns null on failure.
  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const clientEmail = (ctx.email || '').toLowerCase().trim();
  if (!clientEmail) return res.status(401).json({ error: 'Authentication required' });

  // Rate limit: treat as a write action, keyed per client.
  if (!applyRateLimit(res, `uploadpdf:${clientEmail}`, RATE_LIMITS.widgetWrite)) return;

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { filename, dataBase64 } = body;
  if (typeof dataBase64 !== 'string' || !dataBase64) {
    return res.status(400).json({ error: 'Missing file data' });
  }
  if (dataBase64.length > MAX_BODY_CHARS) {
    return res.status(413).json({ error: 'File too large (max 5MB)' });
  }

  // Accept either a raw base64 string or a data URI; strip the prefix if present.
  const b64 = dataBase64.includes(',') ? dataBase64.slice(dataBase64.indexOf(',') + 1) : dataBase64;

  let buf;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Could not decode file' });
  }

  if (buf.length === 0) return res.status(400).json({ error: 'Empty file' });
  if (buf.length > MAX_PDF_BYTES) return res.status(413).json({ error: 'File too large (max 5MB)' });

  // Validate it really is a PDF — magic bytes are "%PDF" at the start.
  if (buf.slice(0, 5).toString('latin1').indexOf('%PDF-') !== 0) {
    return res.status(400).json({ error: 'That file is not a valid PDF' });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('[upload-pdf] BLOB_READ_WRITE_TOKEN not set');
    return res.status(500).json({ error: 'Storage not configured' });
  }

  const name = sanitiseFilename(filename);
  // Unique path per upload so re-uploading the same name doesn't clash, while
  // still grouping by client. addRandomSuffix also guards against collisions.
  const pathname = `quote-pdf/${clientFolder(clientEmail)}/${Date.now()}-${name}`;

  try {
    const { put } = await import('@vercel/blob');
    const blob = await put(pathname, buf, {
      access: 'public',
      contentType: 'application/pdf',
      token,
      addRandomSuffix: true,
    });
    return res.status(200).json({ url: blob.url, name, size: buf.length });
  } catch (err) {
    console.error('[upload-pdf] blob put failed:', err?.message);
    return res.status(500).json({ error: 'Upload failed' });
  }
}
