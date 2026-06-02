/**
 * /api/doc-redirect — referrer-laundering redirect for booking-email document links.
 *
 * Why this exists:
 *   Supplier documents (Travelify-hosted) are linked from the booking
 *   confirmation email. Clicking a raw Travelify URL straight from a mail
 *   provider works for PDFs but FAILS for DOC/DOCX — Travelify's host rejects
 *   the request when the referrer chain comes from a mail client. Routing the
 *   click through this endpoint means the browser navigates to our origin
 *   first, then we 302 to Travelify with OUR origin as the referrer — the same
 *   path the widget itself uses, which Travelify accepts.
 *
 * Security:
 *   - The target URL travels inside an AES-256-GCM token we issued
 *     (see _crypto.js), so it cannot be forged or tampered without the key.
 *   - Even with a valid token we re-validate the decrypted URL (HTTPS + no
 *     private/loopback/link-local host) before redirecting — defence in depth
 *     against open-redirect / SSRF, even on our own bad data.
 *   - An expiry is baked into the token (90 days at send time); expired links
 *     are refused.
 *   - Public endpoint → per-IP rate limited.
 *
 * Request:  GET /api/doc-redirect?t=<url-encoded encrypted token>
 * Success:  302 → the document URL (Referrer-Policy: origin)
 * Failure:  400 (bad/invalid token or unsafe URL), 410 (expired), 429 (rate),
 *           405 (wrong method) — each a tiny human-readable HTML page, since
 *           this is a top-level browser navigation, not a fetch.
 */

import { rateLimit, getClientIp } from './_lib/travelify.js';
import { decrypt } from './_crypto.js';

// Mirror of the email template's isSafeDocUrl — HTTPS only, no private hosts.
function isSafeDocUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '0.0.0.0') return false;
    if (host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^127\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    if (host === '::1' || host === '[::1]') return false;
    if (/^\[?fc[0-9a-f]{2}:/i.test(host) || /^\[?fd[0-9a-f]{2}:/i.test(host)) return false;
    if (/^\[?fe80:/i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function page(res, status, heading, detail) {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title>
<style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px 36px;max-width:420px;margin:24px;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{color:#475569;margin:0}</style></head>
<body><div class="card"><h1>${heading}</h1><p>${detail}</p></div></body></html>`);
}

function getToken(req) {
  if (req.query && typeof req.query.t === 'string') return req.query.t;
  try {
    const u = new URL(req.url, 'https://placeholder.local');
    return u.searchParams.get('t') || '';
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return page(res, 405, 'Method not allowed', 'This link can only be opened directly.');
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`docr:ip:${ip}`, 60); // generous — a customer may open several docs
  if (!limit.ok) {
    res.setHeader('Retry-After', Math.ceil((limit.retryAfterMs || 60000) / 1000));
    return page(res, 429, 'Too many requests', 'Please wait a few minutes and try the link again.');
  }

  const token = getToken(req);
  if (!token) {
    return page(res, 400, 'Invalid link', 'This document link is missing or malformed.');
  }

  let url, exp;
  try {
    const payload = JSON.parse(decrypt(token));
    url = payload.url;
    exp = payload.exp;
  } catch {
    // Tampered token, wrong key, or garbage — never reveal which.
    return page(res, 400, 'Invalid link', 'This document link is invalid or could not be read.');
  }

  if (typeof exp === 'number' && Number.isFinite(exp) && Math.floor(Date.now() / 1000) > exp) {
    return page(res, 410, 'Link expired', 'This document link has expired. Please look your booking up again to get a fresh link, or contact us.');
  }

  if (typeof url !== 'string' || !isSafeDocUrl(url)) {
    return page(res, 400, 'Invalid link', 'This document link points somewhere we can\'t open.');
  }

  // Send our origin (not the full URL) as the referrer to the document host,
  // so Travelify sees the request as coming from us and serves the file.
  res.setHeader('Referrer-Policy', 'origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', url);
  return res.status(302).end();
}
