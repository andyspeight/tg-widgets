// =============================================================================
//  /api/popup-lead.js
// =============================================================================
//
//  Receives email-capture submissions from the Popup widget.
//  Public endpoint — no auth required (popup runs on a public client page).
//
//  Pipeline:
//    1. Validate request envelope (size, JSON, honeypot)
//    2. Rate limit by IP
//    3. Look up the popup widget record to resolve client identity
//    4. Build a canonical lead from the popup payload
//    5. Hand to dispatchLead() which:
//         - writes the master Submissions record
//         - fans out to all configured destinations
//         - logs every dispatch attempt
//    6. Return success / errors to the widget
//
// =============================================================================

import { isValidEmail, sanitiseForFormula } from './_auth.js';
import { dispatchLead } from './_lib/routing/router.js';
import { evaluatePublicRateLimit } from './_lib/rate-limit-public.js';
import { logWidgetEvent } from './_lib/telemetry.js';

const ENQUIRIES_BASE_ID = process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID;
const ENQUIRIES_PAT = process.env.TG_ENQUIRIES_AIRTABLE_PAT;

const WIDGETS_BASE_ID = process.env.AIRTABLE_BASE_ID;
const WIDGETS_PAT = process.env.AIRTABLE_KEY;
const WIDGETS_TABLE_ID = 'tblVAThVqAjqtria2';

const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_NAME_LENGTH = 80;

// ── Helpers ─────────────────────────────────────────────────────────────

function setCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function sanitiseString(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max || 500);
}

function splitName(full) {
  const t = sanitiseString(full, MAX_NAME_LENGTH);
  if (!t) return { first: '', last: '' };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// Resolve the popup widget record from its public WidgetID (tgw_...).
// Returns { recordId (rec...), clientName, clientEmail } or null.
// The widget posts its public WidgetID, but routing + the canonical lead are
// keyed on the Airtable record ID, so we must resolve one to the other here.
// This must be a filterByFormula lookup on {WidgetID}, NOT a direct record GET —
// widgetId is the public tgw_... value, not the Airtable record ID. Mirrors the
// working newsletter-submit resolver. Cached per cold start.
const widgetCache = new Map();
async function resolveWidget(widgetId) {
  if (!widgetId || !WIDGETS_BASE_ID || !WIDGETS_PAT) return null;
  if (widgetCache.has(widgetId)) return widgetCache.get(widgetId);

  try {
    const safeId = sanitiseForFormula(widgetId);
    const formula = encodeURIComponent(`{WidgetID} = '${safeId}'`);
    const url = `https://api.airtable.com/v0/${WIDGETS_BASE_ID}/${WIDGETS_TABLE_ID}?filterByFormula=${formula}&maxRecords=1`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${WIDGETS_PAT}` },
    });
    if (!resp.ok) {
      // Don't cache transient Airtable failures as "not found" — a 429/5xx here
      // must not poison the cache for the rest of this instance's life.
      return null;
    }
    const data = await resp.json();
    const record = data.records && data.records[0];
    if (!record) {
      widgetCache.set(widgetId, null);
      return null;
    }
    const fields = record.fields || {};
    const widget = {
      recordId: record.id,
      clientName: fields['ClientName'] || fields['Client Name'] || fields['Client'] || '',
      clientEmail: fields['ClientEmail'] || fields['Client Email'] || fields['Email'] || '',
    };
    widgetCache.set(widgetId, widget);
    return widget;
  } catch (err) {
    console.error('[popup-lead] Widget lookup failed:', err.message);
    return null;
  }
}

// ── Handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const startedAt = Date.now();
  const ip = getClientIp(req);

  // Attribution is resolved further down (widget lookup); captured here so the
  // telemetry closure can read the final values.
  let logWidgetId = '';
  let logAccount = null;

  // Send the response, then log telemetry after the bytes are flushed.
  async function done(status, jsonBody) {
    res.status(status).json(jsonBody);
    await logWidgetEvent(req, {
      event: 'popup-lead',
      widgetId: logWidgetId,
      widgetType: 'Popup',
      accountName: logAccount,
      status,
      latencyMs: Date.now() - startedAt,
    });
  }

  // Rate limit — cross-instance (Redis), fail-open. widgetId isn't parsed yet,
  // so this first pass is per-IP; that's the abuse vector for a lead endpoint.
  const rl = await evaluatePublicRateLimit(req, res, { event: 'popup-lead' });
  if (!rl.allowed) {
    return done(429, { error: `Too many requests. Retry in ${rl.retryAfter}s.` });
  }

  // Parse payload
  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_PAYLOAD_BYTES) {
      res.status(413).json({ error: 'Payload too large' });
      return;
    }
    try { body = JSON.parse(body); } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  // Honeypot — silent drop
  if (body.website || body.url_field || body.fax) {
    res.status(200).json({ ok: true });
    return;
  }

  const widgetId = sanitiseString(body.widgetId || '', 50);
  logWidgetId = widgetId;
  const email = sanitiseString(body.email || '', 254);
  const rawName = sanitiseString(body.name || '', MAX_NAME_LENGTH);
  const phone = sanitiseString(body.phone || '', 30);
  const sourceUrl = sanitiseString(body.sourceUrl || '', 1000);
  const referrer = sanitiseString(body.referrer || '', 500);
  const tags = Array.isArray(body.tags)
    ? body.tags.slice(0, 10).map(t => sanitiseString(t, 50)).filter(Boolean)
    : [];

  if (!isValidEmail(email)) {
    return done(400, { error: 'Invalid email' });
  }
  if (!widgetId || !/^tgw_[A-Za-z0-9_]+$/.test(widgetId)) {
    return done(400, { error: 'Invalid widget ID' });
  }

  // Resolve the public WidgetID (tgw_...) to the Airtable record ID (rec...).
  // Everything downstream — the canonical lead's source.widgetId and the
  // routing-config lookup — is keyed on the RECORD id, not the public id:
  // buildCanonicalLead enforces isRecId(source.widgetId) and throws otherwise.
  //
  // This endpoint used to resolve the record and then pass the public tgw_ id
  // anyway, so EVERY popup lead failed validation with "Invalid or missing
  // source.widgetId", returned 400 and was lost — it never reached Submissions
  // or any destination. Mirrors the newsletter-submit resolver, which was
  // already correct. (30 Jul 2026.)
  const widget = await resolveWidget(widgetId);
  if (!widget || !widget.recordId) {
    // Fail loudly rather than proceed: without the record id the lead cannot be
    // stored or routed, so reporting success would silently drop it.
    return done(404, { error: 'Widget not found' });
  }
  const widgetRecordId = widget.recordId;
  const clientEmail = widget.clientEmail || 'unknown@travelgenix.io';
  const clientName = widget.clientName || '';
  logAccount = clientName || clientEmail || null;

  // Build the popup → canonical lead
  const { first, last } = splitName(rawName);
  const partialLead = {
    source: {
      widget: 'popup',
      widgetId: widgetRecordId,
      clientName,
      clientEmail,
      sourceUrl,
      referrer,
      ipAddress: ip,
      userAgent: sanitiseString(req.headers['user-agent'] || '', 500),
      visitorId: sanitiseString(body.visitorId || '', 100),
    },
    contact: {
      email,
      firstName: first,
      lastName: last,
      phone,
      fullName: rawName,
    },
    consent: {
      // Popup email-capture is opt-in by submitting; treat as both.
      // If a future popup template adds an explicit checkbox we'll wire it.
      contact: true,
      marketing: !!body.marketingConsent,
      capturedAt: new Date().toISOString(),
      capturedIp: ip,
    },
    custom: body.custom && typeof body.custom === 'object' ? body.custom : {},
    tags: ['popup', ...tags],
  };

  try {
    const result = await dispatchLead(partialLead);
    if (!result.ok) {
      return done(result.statusCode || 400, { error: result.error });
    }
    // Success — return minimal info
    return done(200, {
      ok: true,
      leadId: result.leadId,
      delivered: result.completed.length,
      failed: result.failed.length,
    });
  } catch (err) {
    console.error('[popup-lead] dispatchLead crashed:', err);
    return done(500, { error: 'Submission failed. Please try again.' });
  }
}
