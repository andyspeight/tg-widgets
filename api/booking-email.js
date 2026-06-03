/**
 * Travelgenix Widget Suite — Booking Email (public endpoint)
 *
 * Sends a branded confirmation email with the booking PDF attached.
 *
 * Architecture:
 *   - Calls /api/retrieve-order over HTTP to get the JSON order data.
 *     This is the same endpoint the widget uses, so the email body is
 *     guaranteed to show the same data the customer just looked at.
 *   - Calls /api/booking-pdf over HTTP to get the PDF binary.
 *     This is the same endpoint the Preview/Download buttons use, so the
 *     attached PDF is byte-identical to what the customer sees in Preview.
 *   - Reads agency branding fields directly from the widget Airtable record.
 *   - Sends via SendGrid with PDF base64-attached.
 *
 * NO trim logic, NO Travelify lookup, NO Puppeteer here. This endpoint is
 * a thin orchestrator over two endpoints that already handle their domain
 * properly. Single source of truth for each concern.
 *
 * Endpoint:
 *   POST /api/booking-email
 *   Body: {
 *     widgetId, emailAddress, departDate, orderRef,
 *     toEmail, ccEmails: [], message
 *   }
 *
 * Response:
 *   200 → { ok: true, messageId, sentTo, ccCount }
 *   400 → { error: 'invalid_recipients' | 'recipient_mismatch' | 'invalid_message' }
 *   404 → { error: 'not_found' }
 *   429 → { error: 'too_many_attempts' }
 *   5xx → { error: 'server_error' | 'send_failed' | 'pdf_failed' | 'lookup_failed' }
 */

import { setCors, sanitiseForFormula } from './_auth.js';
import { renderBookingEmail } from './_lib/booking-email-template.js';
import { sendViaSendGrid, buildFromField, isValidEmail } from './_lib/sendgrid.js';

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';

const DEMO_WIDGET_SENTINEL = 'DEMO_WIDGET_ID';

const MAX_CC = 3;
const MAX_MESSAGE_LENGTH = 1000;

// ----- Rate limit (in-memory, per-warm-instance) -----

const rateLimitStore = new Map();
function rateLimit(key, max, windowMs = 60_000) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (rateLimitStore.get(key) || []).filter(t => t > cutoff);
  if (hits.length >= max) {
    return { ok: false, retryAfterMs: hits[0] + windowMs - now };
  }
  hits.push(now);
  rateLimitStore.set(key, hits);
  return { ok: true };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  if (Array.isArray(xff)) return xff[0];
  return req.socket?.remoteAddress || 'unknown';
}

// ----- Validators -----

function validateEmail(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  if (!isValidEmail(trimmed)) return null;
  return trimmed;
}

function validateDate(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return trimmed;
}

function validateOrderRef(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!/^[A-Za-z0-9_-]{3,50}$/.test(trimmed)) return null;
  return trimmed;
}

function validateWidgetId(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(trimmed)) return null;
  return trimmed;
}

function validateMessage(s) {
  if (s == null || s === '') return '';
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) return null;
  return trimmed;
}

// ----- Airtable helpers -----

function airtableHeaders() {
  return {
    'Authorization': `Bearer ${process.env.AIRTABLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function findWidgetById(widgetId) {
  const safe = sanitiseForFormula(widgetId);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${WIDGETS_TABLE}?filterByFormula=${encodeURIComponent(`{WidgetID} = "${safe}"`)}&maxRecords=1`;
  const res = await fetch(url, { headers: airtableHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.records?.[0] || null;
}

// ----- Internal API helpers -----

function buildInternalUrl(req, path) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0];
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0];
  if (!host) return null;
  return `${proto}://${host}${path}`;
}

function internalHeaders(realIp) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.TG_INTERNAL_KEY) {
    headers['X-TG-Internal-Key'] = process.env.TG_INTERNAL_KEY;
    headers['X-TG-Real-IP'] = realIp;
  }
  return headers;
}

// ----- Response helpers -----

function notFound(res) { return res.status(404).json({ error: 'not_found' }); }
function badRequest(res, code) { return res.status(400).json({ error: code }); }

// ----- Main handler -----

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  const ipLimit = rateLimit(`email:ip:${ip}`, 3);
  if (!ipLimit.ok) {
    return res.status(429).json({ error: 'too_many_attempts', retryAfterMs: ipLimit.retryAfterMs });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return notFound(res);
  }

  const widgetId = validateWidgetId(body.widgetId);
  const emailAddress = validateEmail(body.emailAddress);
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);

  if (!widgetId || !emailAddress || !departDate || !orderRef) return notFound(res);

  const toEmail = validateEmail(body.toEmail);
  if (!toEmail) return badRequest(res, 'invalid_recipients');

  const ccEmails = [];
  if (Array.isArray(body.ccEmails)) {
    const seen = new Set([toEmail]);
    for (const candidate of body.ccEmails) {
      const valid = validateEmail(candidate);
      if (!valid) continue;
      if (seen.has(valid)) continue;
      seen.add(valid);
      ccEmails.push(valid);
      if (ccEmails.length >= MAX_CC) break;
    }
  }

  const message = validateMessage(body.message);
  if (message === null) return badRequest(res, 'invalid_message');

  const widgetLimit = rateLimit(`email:ipw:${ip}:${widgetId}`, 10);
  if (!widgetLimit.ok) {
    return res.status(429).json({ error: 'too_many_attempts', retryAfterMs: widgetLimit.retryAfterMs });
  }

  try {
    // ----- 1. Get the order JSON via /api/retrieve-order -----
    // Same endpoint the widget calls for initial booking lookup. The order
    // object returned matches what the customer sees on screen.
    const retrieveUrl = buildInternalUrl(req, '/api/retrieve-order');
    if (!retrieveUrl) {
      console.error('Email: missing host header for retrieve-order');
      return res.status(500).json({ error: 'server_error' });
    }

    const retrieveRes = await fetch(retrieveUrl, {
      method: 'POST',
      headers: internalHeaders(ip),
      body: JSON.stringify({ widgetId, emailAddress, departDate, orderRef }),
      signal: AbortSignal.timeout(15000),
    });

    if (!retrieveRes.ok) {
      if (retrieveRes.status === 404) return notFound(res);
      console.error(`Email: retrieve-order returned ${retrieveRes.status} for widget ${widgetId} ref ${orderRef}`);
      return res.status(502).json({ error: 'lookup_failed' });
    }

    const retrieveData = await retrieveRes.json();
    const order = retrieveData?.order;
    if (!order || !order.id) return notFound(res);

    // ----- 2. Anti-abuse: customer email must be in recipients -----
    // This rule stops the widget being weaponised as a phishing pipeline:
    // without it, an attacker who knew one valid booking's lookup details
    // could send branded, signed emails containing a real PDF to ANY victim,
    // with a custom 'message' body of their choice. Forcing the booking
    // holder to be a recipient means an attacker can only send to the
    // legitimate customer, who would recognise their own booking.
    //
    // Exception: the demo widget (DEMO_WIDGET_SENTINEL) bypasses this check
    // so Andy can test arbitrary send flows from /demo-mybooking. The demo
    // widget is on a Travelgenix-owned page only — it is never embedded on
    // real client sites — so there's no client-reputation exposure. Rate
    // limits still apply to prevent abuse from anyone who finds the demo.
    const customerEmail = (order.customerEmail || emailAddress || '').toLowerCase().trim();
    const allRecipients = new Set([toEmail, ...ccEmails]);
    const bypassRecipientCheck = widgetId === DEMO_WIDGET_SENTINEL;
    if (!bypassRecipientCheck && customerEmail && !allRecipients.has(customerEmail)) {
      return badRequest(res, 'recipient_mismatch');
    }

    // ----- 3. Pull branding from the widget Airtable record -----
    let brandConfig = { name: 'Travelgenix Demo', logoUrl: '', footerLine: '' };
    let replyToAddress = null;
    let supportEmail = null;
    let supportPhone = null;
    let widgetSettings = {};

    if (widgetId !== DEMO_WIDGET_SENTINEL) {
      const widget = await findWidgetById(widgetId);
      if (widget) {
        const fields = widget.fields || {};

        // Brand config (colours, support, brand name) lives in `Config` — the
        // field the editor saves and the live widget reads. `Settings` is a
        // legacy field the widget never writes, so reading it left emails on
        // Travelgenix defaults. Fall back to Settings for old records.
        const s = fields.Config || fields.Settings;
        if (s) {
          if (typeof s === 'object') widgetSettings = s;
          else { try { widgetSettings = JSON.parse(s); } catch { widgetSettings = {}; } }
        }

        const fromName = (fields.FromName || '').toString().trim();
        const fromEmail = (fields.FromEmail || '').toString().trim().toLowerCase();
        const logoUrl = (fields.LogoUrl || '').toString().trim();
        const emailFooter = (fields.EmailFooter || '').toString().trim();
        const clientName = (fields.ClientName || '').toString().trim();

        brandConfig.name = fromName
          || widgetSettings?.brand?.name
          || clientName
          || 'Travel Team';

        if (fromEmail && isValidEmail(fromEmail)) {
          replyToAddress = fromEmail;
        } else {
          const fallback = (fields.ClientEmail || '').toString().trim().toLowerCase();
          if (fallback && isValidEmail(fallback)) replyToAddress = fallback;
        }

        // Only HTTPS logos — embedding HTTP URLs would render as broken images
        // in many mail clients due to mixed-content blocking.
        brandConfig.logoUrl = (logoUrl && /^https:\/\//i.test(logoUrl)) ? logoUrl : '';
        brandConfig.footerLine = emailFooter;

        supportEmail = widgetSettings?.support?.email || replyToAddress || null;
        supportPhone = widgetSettings?.support?.phone || null;
      }
    }

    // ----- 4. Get the PDF binary via /api/booking-pdf -----
    const pdfUrl = buildInternalUrl(req, '/api/booking-pdf');
    if (!pdfUrl) {
      console.error('Email: missing host header for booking-pdf');
      return res.status(500).json({ error: 'server_error' });
    }

    const pdfRes = await fetch(pdfUrl, {
      method: 'POST',
      headers: internalHeaders(ip),
      body: JSON.stringify({ widgetId, emailAddress, departDate, orderRef }),
      signal: AbortSignal.timeout(28000),
    });

    if (!pdfRes.ok) {
      console.error(`Email: booking-pdf returned ${pdfRes.status} for widget ${widgetId} ref ${orderRef}`);
      if (pdfRes.status === 404) return notFound(res);
      return res.status(502).json({ error: 'pdf_failed' });
    }

    const pdfArrayBuffer = await pdfRes.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfArrayBuffer);
    if (!pdfBuffer.length) {
      console.error('Email: booking-pdf returned empty body');
      return res.status(502).json({ error: 'pdf_failed' });
    }
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfFilename = `booking-${orderRef.replace(/[^A-Z0-9_-]/gi, '')}.pdf`;

    // ----- 4b. Fetch supplier documents to attach -----
    // Supplier documents (vouchers, tickets, etc.) come from the order JSON
    // as URLs pointing at Travelify-hosted files. We fetch each in parallel
    // with a 5s timeout, base64-encode and attach to the email up to
    // SendGrid's 30MB total attachment ceiling. Any document that's too
    // large, times out or fails to fetch is still listed as a link in the
    // email body (the template handles that), so nothing is ever lost.
    //
    // Budget figures:
    //   - SendGrid hard limit: 30MB total attachment size (base64 expanded)
    //   - PDF size is variable but typically 200-800KB → call it 1MB headroom
    //   - We allow up to 25MB of supplier documents (base64-expanded)
    //     to leave room for the booking PDF and the email body itself.
    const MAX_DOC_ATTACH_BYTES_B64 = 25 * 1024 * 1024;
    const DOC_FETCH_TIMEOUT_MS = 5000;
    const MAX_DOCS_TO_ATTACH = 10;

    const docList = Array.isArray(order.documents) ? order.documents : [];

    // SSRF defence-in-depth. The URL list comes from Travelify via our
    // retrieve-order endpoint, so a malicious URL would already require
    // upstream compromise — but reject anything pointing at private,
    // loopback or link-local hosts before we fetch it. Belt-and-braces.
    const isSafeUrl = (raw) => {
      try {
        const u = new URL(raw);
        if (u.protocol !== 'https:') return false;
        const host = u.hostname.toLowerCase();
        if (host === 'localhost' || host === '0.0.0.0') return false;
        if (host.endsWith('.local') || host.endsWith('.internal')) return false;
        // Block IPv4 private ranges and loopback. Doesn't fire on hostnames.
        if (/^127\./.test(host)) return false;
        if (/^10\./.test(host)) return false;
        if (/^192\.168\./.test(host)) return false;
        if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
        if (/^169\.254\./.test(host)) return false; // link-local / metadata
        // IPv6 loopback / link-local / unique-local
        if (host === '::1' || host === '[::1]') return false;
        if (/^\[?fc[0-9a-f]{2}:/i.test(host) || /^\[?fd[0-9a-f]{2}:/i.test(host)) return false;
        if (/^\[?fe80:/i.test(host)) return false;
        return true;
      } catch {
        return false;
      }
    };

    const safeDocs = docList
      .filter(d => d && typeof d.url === 'string' && isSafeUrl(d.url))
      .slice(0, MAX_DOCS_TO_ATTACH);

    const docAttachments = [];
    let cumulativeBase64Bytes = 0;

    // Fetch all documents in parallel. Each fetch has its own timeout so a
    // slow supplier doesn't block the whole email. We collect results then
    // decide which to attach based on the cumulative size budget (in
    // document-list order, so the customer-visible ordering is preserved).
    const docResults = await Promise.allSettled(
      safeDocs.map(async (d) => {
        const r = await fetch(d.url, { signal: AbortSignal.timeout(DOC_FETCH_TIMEOUT_MS) });
        if (!r.ok) throw new Error(`http_${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        return { doc: d, buffer: buf };
      })
    );

    for (let i = 0; i < docResults.length; i++) {
      const result = docResults[i];
      const d = safeDocs[i];
      if (result.status !== 'fulfilled') {
        console.warn(`Email: doc fetch failed for ${widgetId}/${orderRef}: ${d.name || d.url} (${result.reason?.message || 'unknown'})`);
        continue;
      }
      const { buffer } = result.value;
      const b64 = buffer.toString('base64');
      if (cumulativeBase64Bytes + b64.length > MAX_DOC_ATTACH_BYTES_B64) {
        console.warn(`Email: doc skipped (budget) for ${widgetId}/${orderRef}: ${d.name || d.url}`);
        continue;
      }
      cumulativeBase64Bytes += b64.length;
      // Build a safe filename. Prefer the supplier-provided name with an
      // extension hint; otherwise fall back to doc-N.<ext>. Strip anything
      // weird so SendGrid doesn't reject the attachment.
      const rawName = (d.name || `document-${i + 1}`).toString();
      const ext = (d.ext || '').toString().replace(/[^a-z0-9]/gi, '').toLowerCase();
      const baseName = rawName.replace(/[^A-Za-z0-9._\- ]/g, '_').slice(0, 80);
      const hasExt = /\.[a-z0-9]{2,5}$/i.test(baseName);
      const filename = hasExt ? baseName : (ext ? `${baseName}.${ext}` : baseName);
      // Best-effort MIME type. SendGrid is permissive — application/octet-stream
      // works for anything it doesn't recognise.
      const mime = (d.mime || d.contentType || '').toString().toLowerCase()
        || (ext === 'pdf' ? 'application/pdf'
          : ext === 'png' ? 'image/png'
          : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : 'application/octet-stream');
      docAttachments.push({
        filename,
        content: b64,
        type: mime,
        disposition: 'attachment',
      });
    }

    // ----- 5. Render the email body -----
    // orderRef is passed through so the template can fall back to the
    // customer-typed reference when no Accommodation/Flights/AirportExtras
    // bookingReference exists. Without this, the template fabricates a
    // "TG{numeric-id}" string that the customer has never seen.
    const { subject, html, text } = renderBookingEmail({
      order,
      message,
      brand: brandConfig,
      colors: widgetSettings?.colors || {},
      supportEmail,
      supportPhone,
      orderRef,
      // Origin for wrapping document links through /api/doc-redirect, which
      // launders the referrer so Travelify serves DOC/DOCX (not just PDFs).
      baseUrl: buildInternalUrl(req, ''),
    });

    // ----- 6. Send via SendGrid -----
    const sendResult = await sendViaSendGrid({
      from: buildFromField(brandConfig.name),
      to: toEmail,
      cc: ccEmails.length > 0 ? ccEmails : undefined,
      replyTo: replyToAddress || undefined,
      subject,
      html,
      text,
      headers: {
        'X-TG-Widget-Id': widgetId,
        'X-TG-Order-Ref': orderRef,
      },
      categoryTag: 'booking-confirmation',
      attachments: [
        {
          filename: pdfFilename,
          content: pdfBase64,
          type: 'application/pdf',
          disposition: 'attachment',
        },
        ...docAttachments,
      ],
    });

    if (sendResult.status !== 'sent') {
      console.error(`Email send failed for widget ${widgetId} ref ${orderRef}: ${sendResult.error}`);
      return res.status(502).json({ error: 'send_failed' });
    }

    return res.status(200).json({
      ok: true,
      messageId: sendResult.sgMessageId || null,
      sentTo: toEmail,
      ccCount: ccEmails.length,
    });

  } catch (err) {
    console.error('Booking email error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
}
