// =============================================================================
//  /api/inspirator-lead.js
// =============================================================================
//
//  Receives a shortlist enquiry from the Inspirator widget.
//  Public endpoint — no auth required (the widget runs on a public client page).
//
//  What makes this lead worth more than an email address: the visitor has just
//  told us, by swiping, which ten or fifteen destinations they liked and which
//  they rejected. The kept destinations map to travel.destinations and the tags
//  those destinations share map to travel.interests, so the agent opens a lead
//  that already says "beach, luxury, honeymoon — Santorini, Grace Bay, Positano"
//  rather than "someone filled in a form".
//
//  Pipeline (mirrors popup-lead.js, which is the proven shape):
//    1. Validate the envelope (size, JSON, honeypot)
//    2. Rate limit by IP
//    3. Resolve the public tgw_ id to the Airtable RECORD id and the client
//    4. Build a canonical lead
//    5. dispatchLead() writes Submissions and fans out to every destination
//    6. Return a minimal result
//
//  NOTE ON PRICING: this endpoint never touches Travelify and the widget never
//  shows a price. Offers are cache-only (30 Jul 2026) and a swipe deck cannot
//  make a live search. The shortlist goes to a human, who quotes it.
//
// =============================================================================

import { isValidEmail, sanitiseForFormula } from './_auth.js';
import { dispatchLead } from './_lib/routing/router.js';
import { evaluatePublicRateLimit } from './_lib/rate-limit-public.js';
import { logWidgetEvent } from './_lib/telemetry.js';
import { TAG_VOCAB } from './_lib/destination-cards.js';

const WIDGETS_BASE_ID = process.env.AIRTABLE_BASE_ID;
const WIDGETS_PAT = process.env.AIRTABLE_KEY;
const WIDGETS_TABLE_ID = 'tblVAThVqAjqtria2';

const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_NAME_LENGTH = 80;
// The canonical schema caps travel.destinations at 10 anyway; capping here too
// keeps the payload bounded before it ever reaches the validator.
const MAX_SHORTLIST = 10;
const MAX_INTERESTS = 12;

// ── Helpers ─────────────────────────────────────────────────────────────

function setCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function sanitiseString(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/<[^>]*>/g, '').trim().slice(0, max);
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * Resolve the public WidgetID (tgw_...) to the Airtable record ID (rec...).
 * buildCanonicalLead enforces isRecId(source.widgetId) and throws otherwise —
 * passing the public id through anyway is what silently lost every popup lead
 * until 30 Jul 2026. Cached per cold start; transient Airtable failures are
 * never cached as "not found".
 */
const widgetCache = new Map();
async function resolveWidget(widgetId) {
  if (!widgetId || !WIDGETS_BASE_ID || !WIDGETS_PAT) return null;
  if (widgetCache.has(widgetId)) return widgetCache.get(widgetId);

  try {
    const safeId = sanitiseForFormula(widgetId);
    const formula = encodeURIComponent(`{WidgetID} = '${safeId}'`);
    const url = `https://api.airtable.com/v0/${WIDGETS_BASE_ID}/${WIDGETS_TABLE_ID}`
      + `?filterByFormula=${formula}&maxRecords=1`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${WIDGETS_PAT}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const record = data.records && data.records[0];
    if (!record) {
      widgetCache.set(widgetId, null);
      return null;
    }
    const fields = record.fields || {};
    const widget = {
      recordId: record.id,
      clientName: fields.ClientName || fields['Client Name'] || fields.Client || '',
      clientEmail: fields.ClientEmail || fields['Client Email'] || fields.Email || '',
    };
    widgetCache.set(widgetId, widget);
    return widget;
  } catch (err) {
    console.error('[inspirator-lead] Widget lookup failed:', err.message);
    return null;
  }
}

// ── Handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const ip = getClientIp(req);
  let logWidgetId = '';
  let logAccount = null;

  function done(status, payload) {
    try {
      logWidgetEvent(req, {
        widgetType: 'Inspirator',
        widgetId: logWidgetId,
        account: logAccount,
        event: status === 200 ? 'lead' : 'error',
        status,
      });
    } catch { /* telemetry must never break the response */ }
    res.status(status).json(payload);
  }

  // Parse the envelope before anything expensive.
  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_PAYLOAD_BYTES) { res.status(413).json({ error: 'Payload too large' }); return; }
    try { body = JSON.parse(body); } catch { res.status(400).json({ error: 'Invalid JSON' }); return; }
  }
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Invalid request' }); return; }

  // Honeypot — a bot fills every field it finds. Answer 200 so it learns nothing.
  if (body.website || body.url_field || body.fax) { res.status(200).json({ ok: true }); return; }

  const widgetId = sanitiseString(body.widgetId || '', 50);
  logWidgetId = widgetId;

  if (!widgetId || !/^tgw_[A-Za-z0-9_]+$/.test(widgetId)) {
    return done(400, { error: 'Invalid widget ID' });
  }

  const rl = await evaluatePublicRateLimit(req, res, { event: 'inspirator-lead', widgetId });
  if (rl && rl.limited) return;

  const email = sanitiseString(body.email || '', 254);
  const rawName = sanitiseString(body.name || '', MAX_NAME_LENGTH);
  const phone = sanitiseString(body.phone || '', 30);
  const message = sanitiseString(body.message || '', 1000);
  const sourceUrl = sanitiseString(body.sourceUrl || '', 1000);
  const referrer = sanitiseString(body.referrer || '', 500);

  if (!isValidEmail(email)) return done(400, { error: 'Invalid email' });

  // The shortlist: destination NAMES the visitor kept. Names rather than record
  // ids because this lead is read by a human in an inbox or a spreadsheet, and
  // "recImleW2loMFZeJ5" tells them nothing.
  const shortlist = Array.isArray(body.shortlist)
    ? body.shortlist.slice(0, MAX_SHORTLIST).map(n => sanitiseString(n, 80)).filter(Boolean)
    : [];
  if (!shortlist.length) return done(400, { error: 'Shortlist is empty' });

  // Interests are only ever tags from the locked vocabulary. Anything else the
  // client sends is dropped rather than trusted, so a tampered payload cannot
  // write arbitrary strings into a lead that gets synced to a mailing list.
  const interests = Array.isArray(body.interests)
    ? body.interests.filter(t => typeof t === 'string' && TAG_VOCAB.has(t)).slice(0, MAX_INTERESTS)
    : [];

  const seen = Number.isFinite(body.seen) ? Math.max(0, Math.min(500, Math.floor(body.seen))) : 0;
  const passed = Number.isFinite(body.passed) ? Math.max(0, Math.min(500, Math.floor(body.passed))) : 0;

  const widget = await resolveWidget(widgetId);
  if (!widget || !widget.recordId) {
    // Fail loudly. Without the record id the lead cannot be stored or routed,
    // so reporting success would silently drop a real enquiry.
    return done(404, { error: 'Widget not found' });
  }
  const clientEmail = widget.clientEmail || 'unknown@travelgenix.io';
  const clientName = widget.clientName || '';
  logAccount = clientName || clientEmail || null;

  const { first, last } = splitName(rawName);
  const partialLead = {
    source: {
      widget: 'inspirator',
      widgetId: widget.recordId,
      clientName,
      clientEmail,
      sourceUrl,
      referrer,
      ipAddress: ip,
      userAgent: sanitiseString(req.headers['user-agent'] || '', 500),
      visitorId: sanitiseString(body.visitorId || '', 100),
    },
    contact: { email, firstName: first, lastName: last, fullName: rawName, phone },
    travel: {
      destinations: shortlist,
      interests,
    },
    consent: {
      // Sending a shortlist to the agent is an explicit request to be contacted
      // about it. Marketing stays opt-in and is only true if they ticked it.
      contact: true,
      marketing: !!body.marketingConsent,
      capturedAt: new Date().toISOString(),
      capturedIp: ip,
    },
    custom: {
      shortlist: shortlist.join(', '),
      travelType: sanitiseString(body.travelType || '', 120),
      cardsSeen: seen,
      cardsPassed: passed,
      ...(message ? { message } : {}),
    },
    tags: ['inspirator'],
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
    console.error('[inspirator-lead] dispatchLead crashed:', err);
    return done(500, { error: 'Submission failed. Please try again.' });
  }
}
