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
    const customerEmail = (order.customerEmail || emailAddress || '').toLowerCase().trim();
    const allRecipients = new Set([toEmail, ...ccEmails]);
    if (customerEmail && !allRecipients.has(customerEmail)) {
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

        const s = fields.Settings;
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

    // ----- 5. Render the email body -----
    const { subject, html, text } = renderBookingEmail({
      order,
      message,
      brand: brandConfig,
      colors: widgetSettings?.colors || {},
      supportEmail,
      supportPhone,
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
      attachments: [{
        filename: pdfFilename,
        content: pdfBase64,
        type: 'application/pdf',
        disposition: 'attachment',
      }],
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
