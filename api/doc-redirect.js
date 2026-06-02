/**
 * /api/doc-redirect — authenticated download proxy for booking-email document links.
 *
 * Why this exists (corrected):
 *   Supplier documents are hosted on static.travelify.io and served with NO
 *   Content-Disposition header. Browsers render a PDF inline (so a PDF link
 *   "just works"), but they have no inline viewer for .docx/.doc — and with no
 *   attachment header a target="_blank" click opens a blank tab that can't
 *   render and closes, which looks like "the page just refreshed". The
 *   document host serves every type fine regardless of referrer (verified), so
 *   the original "referrer laundering" idea was a red herring.
 *
 *   The fix is to stream the file back through our own origin WITH a proper
 *   Content-Disposition so the browser downloads it cleanly. A 302 can't do
 *   this (the final response is Travelify's, headers and all), and the HTML
 *   `download` attribute is ignored cross-origin — so we proxy the bytes.
 *
 * Security:
 *   - The target URL + filename travel inside an AES-256-GCM token we issued
 *     (see _crypto.js): it can't be forged or tampered without the key, so this
 *     is not an open proxy.
 *   - Even with a valid token we re-validate: HTTPS only, no private/loopback
 *     hosts, and the host must be *.travelify.io — so it can never be used to
 *     fetch anything other than a Travelify document.
 *   - An expiry is baked into the token (90 days at send time).
 *   - Public endpoint → per-IP rate limited.
 *
 * Request:  GET /api/doc-redirect?t=<url-encoded encrypted token>
 * Success:  200 with the file bytes (PDF inline; everything else attachment)
 * Failure:  400 / 410 / 429 / 405 / 502 — a tiny human-readable HTML page,
 *           since this is a top-level browser navigation, not a fetch.
 */

import { rateLimit, getClientIp, TRAVELIFY_ORIGIN } from './_lib/travelify.js';
import { decrypt } from './_crypto.js';

const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 25 * 1024 * 1024; // hard ceiling — supplier docs are small

// HTTPS + no private hosts, AND must be a Travelify document host.
function isSafeDocUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (!(host === 'travelify.io' || host.endsWith('.travelify.io'))) return false;
    if (host === 'localhost' || host === '0.0.0.0') return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) || /^169\.254\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function extFromUrl(raw) {
  try {
    const p = new URL(raw).pathname;
    const m = p.match(/\.([a-z0-9]{1,8})$/i);
    return m ? m[1].toLowerCase() : '';
  } catch { return ''; }
}

const TYPE_BY_EXT = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};

// Build a safe download filename: human name (if any) + correct extension,
// stripped of anything that could break the Content-Disposition header.
function buildFilename(name, ext) {
  let base = (typeof name === 'string' && name.trim()) ? name.trim() : 'document';
  base = base.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return ext ? `${base}.${ext}` : base;
}

function page(res, status, heading, detail) {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title>
<style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px 36px;max-width:440px;margin:24px;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{color:#475569;margin:0}</style></head>
<body><div class="card"><h1>${heading}</h1><p>${detail}</p></div></body></html>`);
}

function getToken(req) {
  if (req.query && typeof req.query.t === 'string') return req.query.t;
  try { return new URL(req.url, 'https://x.local').searchParams.get('t') || ''; }
  catch { return ''; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return page(res, 405, 'Method not allowed', 'This link can only be opened directly.');
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`docr:ip:${ip}`, 60);
  if (!limit.ok) {
    res.setHeader('Retry-After', Math.ceil((limit.retryAfterMs || 60000) / 1000));
    return page(res, 429, 'Too many requests', 'Please wait a few minutes and try the link again.');
  }

  const token = getToken(req);
  if (!token) return page(res, 400, 'Invalid link', 'This document link is missing or malformed.');

  let url, name, exp;
  try {
    const payload = JSON.parse(decrypt(token));
    url = payload.url; name = payload.name; exp = payload.exp;
  } catch {
    return page(res, 400, 'Invalid link', 'This document link is invalid or could not be read.');
  }

  if (typeof exp === 'number' && Number.isFinite(exp) && Math.floor(Date.now() / 1000) > exp) {
    return page(res, 410, 'Link expired', 'This document link has expired. Please look your booking up again for a fresh link.');
  }
  if (typeof url !== 'string' || !isSafeDocUrl(url)) {
    return page(res, 400, 'Invalid link', 'This document link points somewhere we can\'t open.');
  }

  // Fetch the document from Travelify server-side and stream it back.
  let upstream;
  try {
    upstream = await fetch(url, {
      headers: { 'Origin': TRAVELIFY_ORIGIN },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return page(res, 502, 'Document unavailable', 'We couldn\'t fetch this document right now. Please try again shortly.');
  }
  if (!upstream.ok) {
    return page(res, 502, 'Document unavailable', 'This document is no longer available. Please contact us if you need it.');
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return page(res, 502, 'Document too large', 'This document is too large to open here.');
  }

  const ext = extFromUrl(url);
  const contentType = upstream.headers.get('content-type') || TYPE_BY_EXT[ext] || 'application/octet-stream';
  const isPdf = /application\/pdf/i.test(contentType) || ext === 'pdf';
  const dispositionType = isPdf ? 'inline' : 'attachment';
  const filename = buildFilename(name, ext);

  res.status(200);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(buf);
}
