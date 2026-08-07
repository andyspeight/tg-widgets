// =============================================================================
//  /api/trip-enquiry.js
// =============================================================================
//
//  Receives enquiry submissions from the Group Trips tour page (widget-trips-page).
//  Public endpoint — no auth (the tour page runs on a public client site).
//
//  A traveller asking about a group trip is a LEAD, not a booking. It carries
//  no money and never touches Supabase — it flows through the same unified lead
//  router every other widget uses (Submissions record + configured fan-out).
//  Bookings and deposits are a separate path (GT-5), on Supabase + Stripe.
//
//  Pipeline (mirrors popup-lead.js):
//    1. Validate envelope (size, JSON, honeypot)
//    2. Rate limit by IP
//    3. Resolve the public WidgetID (tgw_) -> Airtable record id + client + trip
//    4. Build a canonical lead (party size -> travel.adults; message + trip
//       title ride in custom). Prices and trip identity come from the saved
//       config server-side, never from the browser.
//    5. dispatchLead() writes Submissions and fans out to destinations
//    6. Deterministic 200 to the widget
//
// =============================================================================

import { isValidEmail, sanitiseForFormula } from './_auth.js';
import { dispatchLead } from './_lib/routing/router.js';
import { evaluatePublicRateLimit } from './_lib/rate-limit-public.js';
import { logWidgetEvent } from './_lib/telemetry.js';

const WIDGETS_BASE_ID = process.env.AIRTABLE_BASE_ID;
const WIDGETS_PAT = process.env.AIRTABLE_KEY;
const WIDGETS_TABLE_ID = 'tblVAThVqAjqtria2';

const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_NAME_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 2000;

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

// Free-text message keeps newlines (control chars other than \n\r stripped).
function sanitiseMultiline(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, max || 2000);
}

function splitName(full) {
  const t = sanitiseString(full, MAX_NAME_LENGTH);
  if (!t) return { first: '', last: '' };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// Resolve the tour-page widget record from its public WidgetID (tgw_...).
// Returns { recordId, clientName, clientEmail, tripTitle, tripLocation } or null.
//
// The canonical lead is keyed on the Airtable RECORD id (buildCanonicalLead
// enforces isRecId(source.widgetId)), so we must resolve tgw_ -> rec here — a
// filterByFormula lookup on {WidgetID}, never a direct record GET. We also read
// the saved Config JSON so the trip title/location attached to the lead come
// from the server, not from anything the browser could forge. Cached per cold
// start. Mirrors the popup-lead / newsletter-submit resolver.
const widgetCache = new Map();
async function resolveWidget(widgetId) {
  if (!widgetId || !WIDGETS_BASE_ID || !WIDGETS_PAT) return null;
  if (widgetCache.has(widgetId)) return widgetCache.get(widgetId);

  try {
    const safeId = sanitiseForFormula(widgetId);
    const formula = encodeURIComponent(`{WidgetID} = '${safeId}'`);
    const url = `https://api.airtable.com/v0/${WIDGETS_BASE_ID}/${WIDGETS_TABLE_ID}?filterByFormula=${formula}&maxRecords=1`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${WIDGETS_PAT}` } });
    if (!resp.ok) {
      // Don't cache transient Airtable failures (429/5xx) as "not found".
      return null;
    }
    const data = await resp.json();
    const record = data.records && data.records[0];
    if (!record) {
      widgetCache.set(widgetId, null);
      return null;
    }
    const fields = record.fields || {};

    // Trip title/location from the saved config, server-side.
    let tripTitle = '';
    let tripLocation = '';
    try {
      const cfg = JSON.parse(fields['Config'] || '{}');
      const trip = (cfg && typeof cfg.trip === 'object') ? cfg.trip : {};
      if (typeof trip.title === 'string') tripTitle = trip.title.slice(0, 200);
      if (typeof trip.location === 'string') tripLocation = trip.location.slice(0, 120);
    } catch { /* config unparseable — leave blank, the lead still stands */ }

    const widget = {
      recordId: record.id,
      clientName: fields['ClientName'] || fields['Client Name'] || fields['Client'] || '',
      clientEmail: fields['ClientEmail'] || fields['Client Email'] || fields['Email'] || '',
      tripTitle,
      tripLocation,
    };
    widgetCache.set(widgetId, widget);
    return widget;
  } catch (err) {
    console.error('[trip-enquiry] Widget lookup failed:', err.message);
    return null;
  }
}

// ── Handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const startedAt = Date.now();
  const ip = getClientIp(req);

  let logWidgetId = '';
  let logAccount = null;

  async function done(status, jsonBody) {
    res.status(status).json(jsonBody);
    await logWidgetEvent(req, {
      event: 'trip-enquiry',
      widgetId: logWidgetId,
      widgetType: 'Group Trips',
      accountName: logAccount,
      status,
      latencyMs: Date.now() - startedAt,
    });
  }

  // Rate limit — cross-instance (Redis), fail-open. Per-IP: the abuse vector.
  const rl = await evaluatePublicRateLimit(req, res, { event: 'trip-enquiry' });
  if (!rl.allowed) {
    return done(429, { error: `Too many requests. Retry in ${rl.retryAfter}s.` });
  }

  // Parse payload
  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_PAYLOAD_BYTES) { res.status(413).json({ error: 'Payload too large' }); return; }
    try { body = JSON.parse(body); } catch { res.status(400).json({ error: 'Invalid JSON' }); return; }
  }
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Invalid request' }); return; }

  // Honeypot — silent success (bots fill hidden fields)
  if (body.website || body.url_field || body.fax) { res.status(200).json({ ok: true }); return; }

  const widgetId = sanitiseString(body.widgetId || '', 50);
  logWidgetId = widgetId;
  const email = sanitiseString(body.email || '', 254);
  const rawName = sanitiseString(body.name || '', MAX_NAME_LENGTH);
  const phone = sanitiseString(body.phone || '', 30);
  const message = sanitiseMultiline(body.message || '', MAX_MESSAGE_LENGTH);
  const partySize = Math.max(1, Math.min(20, parseInt(body.partySize, 10) || 1));
  const sourceUrl = sanitiseString(body.sourceUrl || '', 1000);
  const referrer = sanitiseString(body.referrer || '', 500);

  if (!isValidEmail(email)) return done(400, { error: 'Invalid email' });
  if (!widgetId || !/^tgw_[A-Za-z0-9_]+$/.test(widgetId)) return done(400, { error: 'Invalid widget ID' });

  // Resolve tgw_ -> record id (+ client + trip). Fail loudly: without the record
  // id the lead cannot be stored or routed, so a false success would lose it.
  const widget = await resolveWidget(widgetId);
  if (!widget || !widget.recordId) return done(404, { error: 'Trip not found' });

  const widgetRecordId = widget.recordId;
  const clientEmail = widget.clientEmail || 'unknown@travelgenix.io';
  const clientName = widget.clientName || '';
  logAccount = clientName || clientEmail || null;

  const { first, last } = splitName(rawName);
  const partialLead = {
    source: {
      widget: 'trips',
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
    travel: {
      // Party size is the meaningful travel signal for a group trip.
      adults: partySize,
      // Trip location (server-side) gives the inbox a destination to show.
      destinations: widget.tripLocation ? [widget.tripLocation] : [],
    },
    consent: {
      // Submitting an enquiry is consent to be contacted about it.
      contact: true,
      marketing: !!body.marketingConsent,
      capturedAt: new Date().toISOString(),
      capturedIp: ip,
    },
    custom: {
      tripTitle: widget.tripTitle || '',
      partySize,
      message,
    },
    tags: ['group-trips', 'enquiry'],
  };

  try {
    const result = await dispatchLead(partialLead);
    if (!result.ok) return done(result.statusCode || 400, { error: result.error });
    return done(200, {
      ok: true,
      leadId: result.leadId,
      delivered: result.completed.length,
      failed: result.failed.length,
    });
  } catch (err) {
    console.error('[trip-enquiry] dispatchLead crashed:', err);
    return done(500, { error: 'Enquiry failed. Please try again.' });
  }
}
