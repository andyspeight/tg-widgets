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

import { applyRateLimit, isValidEmail } from './_auth.js';
import { dispatchLead } from './_lib/routing/router.js';

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

// Look up the popup widget record to resolve client identity.
// Cached per cold start.
const widgetCache = new Map();
async function resolveWidget(widgetId) {
  if (!widgetId || !WIDGETS_BASE_ID || !WIDGETS_PAT) return null;
  if (widgetCache.has(widgetId)) return widgetCache.get(widgetId);

  try {
    const url = `https://api.airtable.com/v0/${WIDGETS_BASE_ID}/${WIDGETS_TABLE_ID}/${widgetId}`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${WIDGETS_PAT}` },
    });
    if (!resp.ok) {
      widgetCache.set(widgetId, null);
      return null;
    }
    const data = await resp.json();
    // Field IDs we care about — these match the existing widget schema.
    // We don't have field IDs for client name/email here; we'll use whatever
    // the editor stamped in. Best-effort lookup.
    const fields = data.fields || {};
    const widget = {
      recordId: data.id,
      // Try common field name patterns
      clientName: fields['Client Name'] || fields['Client'] || '',
      clientEmail: fields['Client Email'] || fields['Email'] || '',
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

  // Rate limit by IP
  const ip = getClientIp(req);
  if (!applyRateLimit(res, `popup-lead:${ip}`, { max: 20, windowMs: 15 * 60 * 1000 })) {
    return;
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
  const email = sanitiseString(body.email || '', 254);
  const rawName = sanitiseString(body.name || '', MAX_NAME_LENGTH);
  const phone = sanitiseString(body.phone || '', 30);
  const sourceUrl = sanitiseString(body.sourceUrl || '', 1000);
  const referrer = sanitiseString(body.referrer || '', 500);
  const tags = Array.isArray(body.tags)
    ? body.tags.slice(0, 10).map(t => sanitiseString(t, 50)).filter(Boolean)
    : [];

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Invalid email' });
    return;
  }
  if (!widgetId || !/^rec[A-Za-z0-9]{14}$/.test(widgetId)) {
    res.status(400).json({ error: 'Invalid widget ID' });
    return;
  }

  // Resolve the widget for client identity
  const widget = await resolveWidget(widgetId);
  // Even if widget lookup fails we proceed — the canonical schema tolerates
  // a missing clientName, but we need a clientEmail to satisfy validation.
  // Fall back to a placeholder so the lead still lands in Submissions.
  const clientEmail = widget?.clientEmail || 'unknown@travelgenix.io';
  const clientName = widget?.clientName || '';

  // Build the popup → canonical lead
  const { first, last } = splitName(rawName);
  const partialLead = {
    source: {
      widget: 'popup',
      widgetId,
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
      res.status(result.statusCode || 400).json({ error: result.error });
      return;
    }
    // Success — return minimal info
    res.status(200).json({
      ok: true,
      leadId: result.leadId,
      delivered: result.completed.length,
      failed: result.failed.length,
    });
  } catch (err) {
    console.error('[popup-lead] dispatchLead crashed:', err);
    res.status(500).json({ error: 'Submission failed. Please try again.' });
  }
}
