/**
 * Travelgenix Widget Suite — Quote PDF (public endpoint)
 *
 * Generates a print-ready A4 PDF of a Quick Quote, and optionally emails it.
 * Sits alongside api/booking-pdf.js and shares its stack (ESM, puppeteer-core +
 * @sparticuz/chromium via ../generate-pdf.js, setCors from ./_auth.js).
 *
 * Endpoint:
 *   POST /api/quote-pdf
 *
 * Body, either:
 *   A) { action, quoteDocument: {...}, quoteId?, key? }   ← page-data mode (LIVE)
 *      The button on the Quick Quote viewer sends the clean, cost-scrubbed
 *      quoteDocument the page already loaded. No Travelify call needed.
 *   B) { action, quoteId, key }                           ← server-fetch mode
 *      No doc supplied; the server fetches the quote itself from Travelify
 *      (fallback / future auto-email-to-client flow with no browser involved).
 *
 * action:
 *   - "download" (default): returns application/pdf for the browser to save.
 *   - "email":              generates the PDF and emails it (SendGrid) to the
 *                           quote's lead email, returns { ok: true }.
 *
 * Security (travelgenix-security):
 *   - Method check (POST only), setCors() like the other widget endpoints
 *   - Input validation (doc shape OR id+key; action enum)
 *   - Cost scrubbing server-side (never trust the client) — nett/member/cost
 *     fields stripped before the renderer sees the doc
 *   - Rate limited per IP
 *   - Generic error responses, detailed logs server-side only
 *   - Buffer coercion on the PDF (see generate-pdf.js)
 *
 * Vercel function config (vercel.json): memory 1024, maxDuration 30
 * Vercel deps (package.json): @sparticuz/chromium, puppeteer-core, @sendgrid/mail
 *
 * Env vars:
 *   Email:    SENDGRID_API_KEY, SENDGRID_FROM_EMAIL (verified sender),
 *             SENDGRID_FROM_NAME_FALLBACK (optional, default "Travelgenix").
 *             QUOTE_PDF_FROM_EMAIL / QUOTE_PDF_FROM_NAME override if set.
 *   Travelify: none needed for the demo — App 250 demo credentials are used
 *             directly (mirrors booking-pdf.js). Real clients will resolve via
 *             Airtable (lookupClientCredentials*) when that path is added.
 */

import { setCors } from './_auth.js';
import { generateQuotePdf, pdfFilename } from '../generate-pdf.js';

const TRAVELIFY_API_BASE = process.env.QUOTE_API_BASE || 'https://api.travelify.io';

// ----- Rate limiting (mirrors api/booking-pdf.js) -----
const rateLimitStore = new Map();
const RL_WINDOW_MS = 15 * 60 * 1000;

function rateLimit(key, max) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore.entries()) if (v.resetAt < now) rateLimitStore.delete(k);
  }
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return { ok: true };
  }
  if (entry.count >= max) return { ok: false, retryAfterMs: entry.resetAt - now };
  entry.count++;
  return { ok: true };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ----- Cost scrubbing (defence in depth) -----
// The button scrubs client-side too, but we never trust the client. Strip any
// cost/nett/member fields from the doc before the renderer ever sees it.
const COST_FIELDS = ['nettPrice', 'memberPrice', 'originalPrice', 'costPrice',
  'costCurrency', 'inResortFees', 'priceBeforeChange'];

function scrubCosts(value) {
  if (Array.isArray(value)) return value.map(scrubCosts);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (COST_FIELDS.includes(k)) continue;
      out[k] = scrubCosts(value[k]);
    }
    return out;
  }
  return value;
}

// ----- Shape check + validation -----
// Accept EITHER the official hotlist shape ({ data:{ items:[{product}] } } or
// the unwrapped { items:[{product}] }) OR the legacy flat quoteDocument
// ({ setup, items:[...] }). The renderer's normaliseQuote handles both.
function looksLikeQuoteDoc(o) {
  if (!o || typeof o !== 'object') return false;
  // Unwrap a { success, data } envelope.
  const d = (o.data && typeof o.data === 'object') ? o.data : o;
  // quoteDocument shape: data.quoteDocument.items[] (curated/flat).
  if (d.quoteDocument && Array.isArray(d.quoteDocument.items) &&
      d.quoteDocument.items.length > 0) return true;
  if (!Array.isArray(d.items) || d.items.length === 0) return false;
  const first = d.items[0];
  // Raw shape: item has a product object.
  if (first && first.product && typeof first.product === 'object') return true;
  // Legacy flat shape: item has accommodationName + a setup block on the doc.
  if (first && first.accommodationName !== undefined &&
      d.setup && typeof d.setup === 'object') return true;
  return false;
}

function validate(body) {
  const errors = [];
  const action = (body && body.action) || 'download';
  if (!['download', 'email'].includes(action)) errors.push('action');

  const hasDoc = body && looksLikeQuoteDoc(body.quoteDocument);

  const quoteId = body && body.quoteId;
  const key = body && body.key;
  const idOk = /^\d{1,12}$/.test(String(quoteId));
  const keyOk = !!key && typeof key === 'string' && key.length >= 8 &&
    key.length <= 64 && /^[A-Za-z0-9-]+$/.test(key);

  if (!hasDoc) {
    if (!idOk) errors.push('quoteId');
    if (!keyOk) errors.push('key');
    if (body && body.quoteDocument !== undefined && !hasDoc) errors.push('quoteDocument');
  }

  return {
    ok: errors.length === 0,
    errors,
    action,
    hasDoc,
    quoteDocument: hasDoc ? scrubCosts(body.quoteDocument) : null,
    quoteId: idOk ? String(quoteId) : null,
    key: keyOk ? key : null,
  };
}

// ----- Demo credentials (mirrors booking-pdf.js / retrieve-order.js) -----
// traveldemo.site runs on the Travelgenix demo Travelify account (App 250).
// The "key" below is the PUBLIC demo key already hardcoded in booking-pdf.js —
// it is NOT a client secret. When we extend this to real clients, replace the
// demo branch in fetchQuoteDocument() with a lookupClientCredentialsByEmail /
// lookupClientCredentialsByAppId call exactly like booking-pdf does.
const DEMO_APP_ID = '250';
const DEMO_PUBLIC_KEY = 'A41D180E-CBFE-4E30-A47D-FAAB424A650D';

// ----- Server-fetch (Travelify hotlist) -----
// Fetches the quote from Travelify so the server (not the browser) holds the
// data. Auth mirrors booking-pdf.js: Token {appId}:{apiKey} + the Origin header
// (Travelify returns a misleading 401 without Origin). Demo-only for now —
// always App 250. Real-client credential resolution is a later addition.
async function fetchQuoteDocument(quoteId, key) {
  const appId = DEMO_APP_ID;
  const apiKey = DEMO_PUBLIC_KEY;

  // Official endpoint shape (confirmed by Travelify doc, May 2026):
  //   GET /account/hotlist/{id}/{key}?isViewPage=true
  //   Authorization: Token {appId}:{apiKey}    (e.g. Token 250:<key>)
  const url = `${TRAVELIFY_API_BASE}/account/hotlist/${encodeURIComponent(quoteId)}/${encodeURIComponent(key)}?isViewPage=true`;

  const r = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Token ${appId}:${apiKey}`,
      'Origin': 'https://www.travelgenix.io',
      'Accept': 'application/json',
      'User-Agent': 'Travelgenix-QuotePDF/1.0',
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!r.ok) {
    console.error('[quote-pdf] hotlist fetch failed', r.status);
    throw new Error(`Quote API ${r.status}`);
  }

  const j = await r.json();
  if (!j || j.success === false || !j.data) throw new Error('Quote not found');

  // The official response has NO curated quoteDocument node — it returns the
  // raw hotlist in `data` (items[].product.units[].rates[]). The renderer's
  // normaliseQuote() flattens this to the lead-in room per item and reads only
  // sell-side fields. We hand back `data` and let normalisation + the
  // server-side scrub do the rest.
  return j.data;
}

// ----- Email send (SendGrid) -----
// Sends the quote PDF as an attachment to the quote's lead email. The "from"
// address must be a verified sender/domain in SendGrid.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function emailQuotePdf(doc, pdfBuffer) {
  // Recipient + names: official shape carries customerEmail/customerFirstname at
  // the data root; legacy flat shape carries them under setup. Support both.
  const d = (doc && doc.data && doc.data.items) ? doc.data : doc;
  const setup = (d && d.setup) || {};
  const to = setup.leadEmail || (d && d.customerEmail);
  if (!to) throw new Error('No customer email on quote');

  // Reuse the repo's existing SendGrid env vars (already set in Vercel):
  //   SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, SENDGRID_FROM_NAME_FALLBACK.
  // QUOTE_PDF_* names are accepted too as an override if ever set.
  const fromEmail = process.env.QUOTE_PDF_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL;
  const fromName = process.env.QUOTE_PDF_FROM_NAME || process.env.SENDGRID_FROM_NAME_FALLBACK || 'Travelgenix';
  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey || !fromEmail) {
    return { to, bytes: pdfBuffer.length, sent: false, note: 'SendGrid not configured' };
  }

  const sg = (await import('@sendgrid/mail')).default;
  sg.setApiKey(apiKey);

  const title = setup.quoteTitle || (d && d.name) || 'your travel quote';
  const lead = setup.leadName ||
    [d && d.customerFirstname, d && d.customerSurname].filter(Boolean).join(' ').trim() ||
    'there';
  const filename = pdfFilename(d);

  await sg.send({
    to,
    from: { email: fromEmail, name: fromName },
    subject: `Your quote: ${title}`,
    text: `Hi ${lead},\n\nPlease find your quote "${title}" attached as a PDF.\n\nKind regards,\n${fromName}`,
    html: `<p>Hi ${escapeHtml(lead)},</p>` +
          `<p>Please find your quote &ldquo;${escapeHtml(title)}&rdquo; attached as a PDF.</p>` +
          `<p>Kind regards,<br>${escapeHtml(fromName)}</p>`,
    attachments: [{
      content: pdfBuffer.toString('base64'),
      filename,
      type: 'application/pdf',
      disposition: 'attachment',
    }],
  });

  return { to, bytes: pdfBuffer.length, sent: true };
}

// ----- Handler -----
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  const limit = rateLimit(`quotepdf:ip:${ip}`, 20);
  if (!limit.ok) {
    return res.status(429).json({ error: 'too_many_attempts', retryAfterMs: limit.retryAfterMs });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const v = validate(body);
  if (!v.ok) {
    return res.status(400).json({ error: 'Invalid request', fields: v.errors });
  }

  try {
    // Page-data mode uses the scrubbed doc the browser sent. Server-fetch mode
    // pulls it from Travelify and scrubs it here.
    const doc = v.hasDoc
      ? v.quoteDocument
      : scrubCosts(await fetchQuoteDocument(v.quoteId, v.key));

    const pdf = await generateQuotePdf(doc);

    if (v.action === 'email') {
      const result = await emailQuotePdf(doc, pdf);
      return res.status(200).json({ ok: true, emailed: result });
    }

    // download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename(doc)}"`);
    res.status(200);
    return res.end(pdf);
  } catch (err) {
    console.error('[quote-pdf] error:', err?.message, err?.stack?.slice(0, 300));
    return res.status(500).json({ error: 'server_error' });
  }
}

// Exposed for tests.
export { validate, fetchQuoteDocument };
