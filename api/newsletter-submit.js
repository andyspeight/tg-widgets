// =============================================================================
//  /api/newsletter-submit.js
// =============================================================================
//
//  Receives newsletter signups from the Newsletter Signup widget.
//  Public endpoint — no auth required.
//
//  Pipeline:
//    1. Validate envelope (size, JSON, honeypot)
//    2. Rate limit by IP
//    3. Look up the widget record to resolve client identity
//    4. Build a canonical newsletter lead
//    5. Hand to dispatchLead() — which writes the master Submissions record,
//       fans out to all configured ESP destinations (Mailchimp, Brevo,
//       MailerLite, Klaviyo, Constant Contact, plus webhook/sheets/email)
//       and logs each dispatch attempt
//    6. Return success / errors to the widget
//
//  Note on consent: Newsletter signups have an explicit consent checkbox in
//  the widget. The user's tick is treated as marketing opt-in (the whole
//  point — they're saying "yes, email me marketing"). If the checkbox was
//  hidden in the widget config, we treat submission as implicit consent.
//
// =============================================================================

import { applyRateLimit, isValidEmail } from './_auth.js';
import { dispatchLead } from './_lib/routing/router.js';

const WIDGETS_BASE_ID = process.env.AIRTABLE_BASE_ID;
const WIDGETS_PAT = process.env.AIRTABLE_KEY;
const WIDGETS_TABLE_ID = 'tblVAThVqAjqtria2';

const MAX_PAYLOAD_BYTES = 16 * 1024;   // smaller than popup — newsletter is just email + maybe name
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

// Look up the newsletter widget record for client identity.
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
    const fields = data.fields || {};
    const widget = {
      recordId: data.id,
      clientName: fields['Client Name'] || fields['Client'] || '',
      clientEmail: fields['Client Email'] || fields['Email'] || '',
      widgetType: fields['Widget Type'] || '',
    };
    widgetCache.set(widgetId, widget);
    return widget;
  } catch (err) {
    console.error('[newsletter-submit] Widget lookup failed:', err.message);
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

  // Rate limit by IP — newsletter is lower-risk than enquiry but bots love
  // signup forms, so we still want a sensible per-IP cap.
  const ip = getClientIp(req);
  if (!applyRateLimit(res, `newsletter-submit:${ip}`, { max: 30, windowMs: 15 * 60 * 1000 })) {
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
      res.status(400).json({ error: 'Invalid request' });
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
  const firstName = sanitiseString(body.firstName || '', MAX_NAME_LENGTH);
  const lastName = sanitiseString(body.lastName || '', MAX_NAME_LENGTH);
  const sourceUrl = sanitiseString(body.sourceUrl || '', 1000);
  const referrer = sanitiseString(body.referrer || '', 500);
  const tags = Array.isArray(body.tags)
    ? body.tags.slice(0, 10).map(t => sanitiseString(t, 50)).filter(Boolean)
    : [];
  const consentTicked = body.consent !== false; // default true (some layouts ship without a checkbox)

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (!widgetId || !/^rec[A-Za-z0-9]{14}$/.test(widgetId)) {
    res.status(400).json({ error: 'Invalid widget ID' });
    return;
  }

  // Resolve the widget for client identity
  const widget = await resolveWidget(widgetId);
  const clientEmail = widget?.clientEmail || 'unknown@travelgenix.io';
  const clientName = widget?.clientName || '';

  // Build the canonical lead
  const partialLead = {
    source: {
      widget: 'newsletter',
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
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(' '),
    },
    consent: {
      // Submitting the form is implicit contact consent
      contact: true,
      // The whole purpose of a newsletter signup is marketing opt-in.
      // A ticked checkbox (or absent checkbox in the widget config) confirms it.
      marketing: consentTicked,
      capturedAt: new Date().toISOString(),
      capturedIp: ip,
    },
    custom: body.custom && typeof body.custom === 'object' ? body.custom : {},
    tags: ['newsletter', ...tags],
  };

  try {
    const result = await dispatchLead(partialLead);
    if (!result.ok) {
      res.status(result.statusCode || 400).json({ error: result.error });
      return;
    }
    res.status(200).json({
      ok: true,
      leadId: result.leadId,
      delivered: result.completed.length,
      failed: result.failed.length,
    });
  } catch (err) {
    console.error('[newsletter-submit] dispatchLead crashed:', err);
    res.status(500).json({ error: 'Sorry, something went wrong. Please try again.' });
  }
}
