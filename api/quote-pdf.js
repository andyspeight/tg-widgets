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
 *     Page-data mode is fine here — the PDF is returned only to the caller.
 *   - "email":              generates the PDF and emails it (SendGrid) to the
 *                           quote's lead email, returns { ok: true }. Email ALWAYS
 *                           resolves the quote server-side by id+key (the per-quote
 *                           secret from the viewer URL); it never takes the
 *                           recipient from a browser-supplied quoteDocument. See
 *                           emailAllowed() and the brand-impersonation note below.
 *
 * Security (travelgenix-security):
 *   - Method check (POST only), setCors() like the other widget endpoints
 *   - Input validation (doc shape OR id+key; action enum)
 *   - Email is send-by-reference only: the recipient + brand come from the
 *     server-fetched quote, never from the browser. Without this, a caller could
 *     pass any client's public widgetId (for that client's branding) plus an
 *     attacker-authored doc with an arbitrary recipient, and the platform would
 *     email a client-branded PDF to anyone. emailAllowed() enforces the id+key.
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

import { setCors, sanitiseForFormula, lookupClientCredentialsByEmail, lookupClientCredentialsByRecordId } from './_auth.js';
import { generateQuotePdf, pdfFilename, fetchAttachmentBuffers } from '../generate-pdf.js';

const TRAVELIFY_API_BASE = process.env.QUOTE_API_BASE || 'https://api.travelify.io';

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';

// A widget can opt into the demo Travelify account by passing this sentinel
// instead of a real widgetId (mirrors booking-pdf.js / retrieve-order.js).
const DEMO_WIDGET_SENTINEL = 'demo';

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
    // Optional: which widget this came from. Resolves client credentials +
    // branding. Absent or 'demo' → demo App 250 + default branding.
    widgetId: (body && typeof body.widgetId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(body.widgetId))
      ? body.widgetId : null,
  };
}

// Email may only ever send a server-held quote, resolved by id+key (the
// per-quote secret from the viewer URL). A caller can NEVER email a
// browser-supplied doc, because the recipient and brand would then be
// attacker-chosen. This one predicate is the brand-impersonation guard; the
// download action is deliberately not subject to it (it returns the PDF only to
// the caller). Kept pure and exported so it is unit-tested directly.
function emailAllowed(v) {
  return !!(v && v.quoteId && v.key);
}

// ----- Demo credentials (mirrors booking-pdf.js / retrieve-order.js) -----
// traveldemo.site runs on the Travelgenix demo Travelify account (App 250).
// The "key" below is the PUBLIC demo key already hardcoded in booking-pdf.js —
// it is NOT a client secret. Real clients resolve their own credentials from
// the Clients table via lookupClientCredentialsByEmail, exactly like booking-pdf.
const DEMO_APP_ID = '250';
const DEMO_PUBLIC_KEY = 'A41D180E-CBFE-4E30-A47D-FAAB424A650D';

function airtableHeaders() {
  const key = process.env.AIRTABLE_KEY;
  if (!key) throw new Error('AIRTABLE_KEY env var missing');
  return { 'Authorization': `Bearer ${key}` };
}

// Look up the widget record by its public WidgetID. Returns the record (with
// ClientEmail + Config) or null. Mirrors booking-pdf.findWidgetById.
async function findWidgetById(widgetId) {
  const safe = sanitiseForFormula(widgetId);
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${WIDGETS_TABLE}`);
  url.searchParams.set('filterByFormula', `{WidgetID}='${safe}'`);
  url.searchParams.set('maxRecords', '1');
  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) throw new Error(`Widget lookup failed: ${res.status}`);
  const data = await res.json();
  return data.records?.[0] || null;
}

// Build the branding opts the renderer consumes from a widget's saved Config.
// Only whitelisted fields are read; everything is bounded and validated inside
// resolveBrand() in the renderer, so malformed config degrades to defaults.
function buildRenderOpts(config) {
  const c = (config && typeof config === 'object') ? config : {};
  const colors = (c.colors && typeof c.colors === 'object') ? c.colors : {};
  // Attachments: only accept well-formed entries with an https URL. Cap the
  // count so a malformed config can't trigger dozens of fetches.
  const attachments = Array.isArray(c.attachments)
    ? c.attachments
        .filter(a => a && typeof a.url === 'string' && /^https:\/\//.test(a.url))
        .slice(0, 10)
        .map(a => ({ url: a.url, name: (a.name && String(a.name).slice(0, 120)) || 'document.pdf' }))
    : [];
  return {
    brand: {
      name: c.brandName,
      tagline: c.tagline,
      logoUrl: c.logoUrl,
      supportEmail: c.supportEmail,
      supportPhone: c.supportPhone,
      colors: {
        // New 6-colour model the editor saves (topBar, hero, accent, labels,
        // titles, text). These must be forwarded verbatim: the editor preview
        // themes from them, and resolveBrand() in the renderer reads these exact
        // keys. Forwarding only the legacy keys below silently dropped five of
        // the six, so the PDF/email fell back to the default navy while the
        // editor preview showed the client's colours.
        topBar: colors.topBar,
        hero: colors.hero,
        accent: colors.accent,
        labels: colors.labels,
        titles: colors.titles,
        text: colors.text,
        // Legacy keys kept so pre-6-colour saved configs still map through
        // resolveBrand()'s back-compat fallback.
        primary: colors.primary,
        primaryDark: colors.primaryDark,
        accentDark: colors.accentDark,
      },
    },
    attachments,
  };
}

// Resolve the Travelify credentials AND branding opts for a request. Demo
// sentinel (or no widgetId) → App 250 + default branding. Real widgetId →
// look up the widget, resolve the client's creds, build branding from config.
async function resolveContext(widgetId) {
  if (!widgetId || widgetId === DEMO_WIDGET_SENTINEL) {
    return { appId: DEMO_APP_ID, apiKey: DEMO_PUBLIC_KEY, opts: undefined };
  }

  const widget = await findWidgetById(widgetId);
  if (!widget) throw new Error('widget_not_found');

  // Resolve the OWNING CLIENT's Travelify credentials.
  //
  // Primary path: the widget records the Airtable record ID of the client that
  // owns it (ClientRecordId), captured at save time from the authenticated
  // session. We resolve credentials directly from that client — unambiguous,
  // and correct even when the widget was created by a staff member who belongs
  // to several client accounts.
  //
  // Fallback path: legacy widgets created before ClientRecordId existed only
  // carry ClientEmail. We keep the old email-based resolution for those so they
  // don't break. New widgets always have ClientRecordId, so the fallback fades
  // out naturally over time.
  const ownerRecordId = (widget.fields?.ClientRecordId || '').trim();
  const clientEmail = (widget.fields?.ClientEmail || '').toLowerCase().trim();

  let creds = null;
  try {
    if (ownerRecordId) {
      creds = await lookupClientCredentialsByRecordId(ownerRecordId);
    }
    // Fallback for legacy widgets with no owning-client ID recorded.
    if (!creds && clientEmail) {
      creds = await lookupClientCredentialsByEmail(clientEmail);
    }
  } catch (err) {
    console.error('[quote-pdf] credential lookup failed for',
      ownerRecordId || clientEmail, '—', err.message);
    throw new Error('credential_lookup_failed');
  }

  if (!ownerRecordId && !clientEmail) throw new Error('widget_no_client');
  if (!creds) {
    console.warn(`[quote-pdf] No Travelify credentials resolved for widgetId=${widgetId} ` +
      `(ownerRecordId=${ownerRecordId || 'none'}, clientEmail=${clientEmail || 'none'})`);
    throw new Error('no_client_credentials');
  }

  let config = {};
  try { config = JSON.parse(widget.fields?.Config || '{}'); } catch { config = {}; }

  return { appId: creds.appId, apiKey: creds.apiKey, opts: buildRenderOpts(config) };
}

// ----- Server-fetch (Travelify hotlist) -----
// Fetches the quote from Travelify so the server (not the browser) holds the
// data. Auth mirrors booking-pdf.js: Token {appId}:{apiKey} + the Origin header
// (Travelify returns a misleading 401 without Origin). The URL path key is the
// per-quote key from the viewer URL; the header key is the APP key.
async function fetchQuoteDocument(quoteId, key, appId, apiKey) {
  appId = appId || DEMO_APP_ID;
  apiKey = apiKey || DEMO_PUBLIC_KEY;

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

// The customer-facing quote email goes out under the CLIENT's company name (the
// widget's configured brandName), so the recipient sees their own travel agent
// rather than the Travelgenix platform — the same stance the appointment emails
// take with companyOf(). The verified sender ADDRESS never changes (SendGrid
// requires it); only the display name does. Fall back to the env sender name,
// then the generic default, when a widget carries no brand name (e.g. the demo).
function quoteFromName(opts) {
  const brandName = opts && opts.brand && opts.brand.name && String(opts.brand.name).trim();
  return brandName || process.env.QUOTE_PDF_FROM_NAME || process.env.SENDGRID_FROM_NAME_FALLBACK || 'Travelgenix';
}

async function emailQuotePdf(doc, pdfBuffer, extraAttachments, opts) {
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
  const fromName = quoteFromName(opts);
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

  // The main attachment is the merged quote (quote + any T&Cs). Then add each
  // attachment again as a SEPARATE file so the customer has standalone copies.
  // De-duplicate the filename if a T&C happens to share the quote's name.
  const attachments = [{
    content: pdfBuffer.toString('base64'),
    filename,
    type: 'application/pdf',
    disposition: 'attachment',
  }];
  const extras = Array.isArray(extraAttachments) ? extraAttachments : [];
  const used = new Set([filename.toLowerCase()]);
  for (const att of extras) {
    if (!att || !att.buffer) continue;
    let fn = (att.name && String(att.name)) || 'document.pdf';
    if (!/\.pdf$/i.test(fn)) fn += '.pdf';
    // avoid an identical filename to the merged quote
    if (used.has(fn.toLowerCase())) fn = fn.replace(/\.pdf$/i, '') + '-copy.pdf';
    used.add(fn.toLowerCase());
    attachments.push({
      content: att.buffer.toString('base64'),
      filename: fn,
      type: 'application/pdf',
      disposition: 'attachment',
    });
  }

  await sg.send({
    to,
    from: { email: fromEmail, name: fromName },
    subject: `Your quote: ${title}`,
    text: `Hi ${lead},\n\nPlease find your quote "${title}" attached as a PDF.\n\nKind regards,\n${fromName}`,
    html: `<p>Hi ${escapeHtml(lead)},</p>` +
          `<p>Please find your quote &ldquo;${escapeHtml(title)}&rdquo; attached as a PDF.</p>` +
          `<p>Kind regards,<br>${escapeHtml(fromName)}</p>`,
    attachments,
  });

  return { to, bytes: pdfBuffer.length, sent: true, extraAttachments: extras.length };
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
    // Resolve client credentials + branding from the widget (demo → App 250 +
    // defaults). For page-data mode we still resolve branding so the rendered
    // doc carries the client's logo/colours.
    let ctx;
    try {
      ctx = await resolveContext(v.widgetId);
    } catch (err) {
      const code = err?.message || 'context_error';
      // Don't leak which part failed; the editor surfaces creds status separately.
      const status = code === 'widget_not_found' ? 404 : 400;
      return res.status(status).json({ error: code });
    }

    // EMAIL: send-by-reference only. Resolve the quote server-side from id+key
    // and email its own recipient/content — never a browser-supplied doc. This
    // closes the brand-impersonation vector. The live widget already sends id+key
    // on a normal viewer page (and the demo seeds one), so real sends are
    // unaffected; only a doc-without-reference "email" (the attack shape) is
    // refused.
    if (v.action === 'email') {
      if (!emailAllowed(v)) {
        return res.status(400).json({ error: 'email_requires_quote_ref' });
      }
      const emailDoc = scrubCosts(await fetchQuoteDocument(v.quoteId, v.key, ctx.appId, ctx.apiKey));
      const emailPdf = await generateQuotePdf(emailDoc, ctx.opts);
      // The merged PDF already contains the attachments; also send each one as a
      // SEPARATE attachment so the customer gets standalone copies too.
      const extraAttachments = await fetchAttachmentBuffers(ctx.opts && ctx.opts.attachments);
      const result = await emailQuotePdf(emailDoc, emailPdf, extraAttachments, ctx.opts);
      return res.status(200).json({ ok: true, emailed: result });
    }

    // DOWNLOAD: page-data mode uses the scrubbed doc the browser sent; otherwise
    // the server fetches it. Safe either way — the PDF goes only to the caller.
    const doc = v.hasDoc
      ? v.quoteDocument
      : scrubCosts(await fetchQuoteDocument(v.quoteId, v.key, ctx.appId, ctx.apiKey));
    const pdf = await generateQuotePdf(doc, ctx.opts);

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
export { validate, fetchQuoteDocument, quoteFromName, emailAllowed };
