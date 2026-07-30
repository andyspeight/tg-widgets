// =============================================================================
//  /api/form-submit.js
// =============================================================================
//
//  Receives submissions from the general-purpose Form widget (widget-form.js) —
//  the Typeform-style conversational form. Public endpoint: the form runs on a
//  public client page, so there is no auth, and every input is treated as
//  hostile until sanitised.
//
//  This endpoint is DELIBERATELY THIN. It does not own any delivery logic: it
//  shapes the answers into a canonical lead and hands them to dispatchLead(),
//  which writes the master Submissions record and fans out to whatever
//  destinations the client configured (Google Sheets, email, auto-reply,
//  webhook, Mailchimp, Brevo, MailerLite, Klaviyo, Constant Contact). Modelled
//  on api/popup-lead.js and api/newsletter-submit.js.
//
//  WHY NOT the enquiry pipeline: api/enquiry/submit.js is travel-locked — its
//  validator, its Airtable column map and its email/sheet templates all assume
//  destinations, airports, travellers and board basis. A general form has
//  arbitrary questions, so it uses the generic router instead.
//
//  ANSWER SHAPE. The widget posts its questions and answers together, so the
//  server never has to know the form's design in advance:
//    {
//      widgetId: 'tgw_...',
//      answers: [
//        { id, label, type, value, mapTo? },   // value: string | number | bool | string[]
//        ...
//      ],
//      sourceUrl, referrer, visitorId
//    }
//  `mapTo` lets a question feed a canonical contact field (email / firstName /
//  lastName / fullName / phone / marketingConsent). EVERY answer — mapped or not
//  — is also carried in lead.custom, keyed by its question label, so the client
//  sees the full set of answers in their sheet/email exactly as asked.
//
//  EMAIL IS REQUIRED. buildCanonicalLead enforces a valid contact.email, so a
//  form must contain an email question. That is checked here first with a clear
//  message, rather than letting the canonical validator reject it generically.
//
//  IDs: the canonical lead is keyed on the Airtable RECORD id (rec...), never
//  the public widget id (tgw_...). Passing the public id makes buildCanonicalLead
//  throw and the lead is lost — the bug that silently dropped every popup lead
//  until 30 Jul 2026. resolveWidget() does that conversion and this endpoint
//  refuses to continue without it.
//
// =============================================================================

import { isValidEmail, sanitiseForFormula } from './_auth.js';
import { dispatchLead } from './_lib/routing/router.js';
import { evaluatePublicRateLimit } from './_lib/rate-limit-public.js';
import { logWidgetEvent } from './_lib/telemetry.js';

const WIDGETS_BASE_ID = process.env.AIRTABLE_BASE_ID;
const WIDGETS_PAT = process.env.AIRTABLE_KEY;
const WIDGETS_TABLE_ID = 'tblVAThVqAjqtria2';

const MAX_PAYLOAD_BYTES = 128 * 1024;   // a long form with long text answers
const MAX_ANSWERS = 60;                 // above the canonical 50-key custom cap
const MAX_LABEL = 80;                   // custom keys are clamped to 80 anyway
const MAX_VALUE = 1000;                 // matches MAX_CUSTOM_VALUE
const MAX_NAME_LENGTH = 80;

// Canonical contact fields a question may feed via `mapTo`.
const MAPPABLE = new Set(['email', 'firstName', 'lastName', 'fullName', 'phone', 'marketingConsent']);

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

/**
 * Flatten one answer's value to the string/number/boolean the canonical lead
 * and every destination can render. Multi-select arrays become a readable
 * comma-joined list rather than raw JSON, because these land in a spreadsheet
 * cell and an email a human reads.
 */
export function flattenAnswerValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((v) => (typeof v === 'string' ? sanitiseString(v, 200) : String(v ?? '')))
      .filter(Boolean)
      .join(', ')
      .slice(0, MAX_VALUE);
  }
  if (typeof value === 'object') return JSON.stringify(value).slice(0, MAX_VALUE);
  return sanitiseString(String(value), MAX_VALUE);
}

/**
 * Turn the widget's answers array into { custom, mapped }.
 *
 * `custom` is keyed by the QUESTION LABEL so the client's sheet/email reads the
 * way they wrote the form. Labels are not guaranteed unique (a builder can ask
 * "Other?" twice), so a duplicate key gets its question id appended rather than
 * silently overwriting an earlier answer — losing an answer is worse than an
 * ugly key. Falls back to the question id when a label is missing entirely.
 *
 * Exported for tests: this mapping is the whole contract between the form's
 * design and what the client receives.
 */
export function mapAnswers(answers) {
  const custom = {};
  const mapped = {};
  if (!Array.isArray(answers)) return { custom, mapped };

  const used = new Set();
  for (const raw of answers.slice(0, MAX_ANSWERS)) {
    if (!raw || typeof raw !== 'object') continue;

    const id = sanitiseString(raw.id, 40);
    const label = sanitiseString(raw.label, MAX_LABEL);
    const value = flattenAnswerValue(raw.value);

    // A skipped optional question carries no answer. Keep it out of the payload
    // entirely rather than shipping empty columns to the client's sheet.
    if (value === '' || value === null) continue;

    // Canonical contact mapping — only the whitelisted targets, so a crafted
    // payload can't write arbitrary keys into the lead's contact block.
    const mapTo = sanitiseString(raw.mapTo, 20);
    if (mapTo && MAPPABLE.has(mapTo) && mapped[mapTo] === undefined) {
      mapped[mapTo] = value;
    }

    let key = label || id;
    if (!key) continue;
    if (used.has(key)) key = `${key} (${id || used.size + 1})`.slice(0, MAX_LABEL);
    used.add(key);
    custom[key] = value;
  }
  return { custom, mapped };
}

// Resolve the public WidgetID (tgw_...) to the Airtable record id (rec...).
// Cached per cold start. A transient Airtable failure is NOT cached as
// "not found", or one blip would poison this instance for its whole life.
const widgetCache = new Map();
async function resolveWidget(widgetId) {
  if (!widgetId || !WIDGETS_BASE_ID || !WIDGETS_PAT) return null;
  if (widgetCache.has(widgetId)) return widgetCache.get(widgetId);

  try {
    const safeId = sanitiseForFormula(widgetId);
    const formula = encodeURIComponent(`{WidgetID} = '${safeId}'`);
    const url = `https://api.airtable.com/v0/${WIDGETS_BASE_ID}/${WIDGETS_TABLE_ID}?filterByFormula=${formula}&maxRecords=1`;
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
      clientName: fields['ClientName'] || fields['Client Name'] || fields['Client'] || '',
      clientEmail: fields['ClientEmail'] || fields['Client Email'] || fields['Email'] || '',
    };
    widgetCache.set(widgetId, widget);
    return widget;
  } catch (err) {
    console.error('[form-submit] Widget lookup failed:', err.message);
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

  let logWidgetId = '';
  let logAccount = null;

  // Respond first, then log telemetry once the bytes are flushed, so the
  // visitor never waits on our analytics.
  async function done(status, jsonBody) {
    res.status(status).json(jsonBody);
    await logWidgetEvent(req, {
      event: 'form-submit',
      widgetId: logWidgetId,
      widgetType: 'Form',
      accountName: logAccount,
      status,
      latencyMs: Date.now() - startedAt,
    });
  }

  // Rate limit per IP (cross-instance, fail-open) — the abuse vector for any
  // public lead endpoint.
  const rl = await evaluatePublicRateLimit(req, res, { event: 'form-submit' });
  if (!rl.allowed) {
    return done(429, { error: `Too many requests. Retry in ${rl.retryAfter}s.` });
  }

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

  // Honeypot — answer 200 so a bot believes it succeeded, but drop it.
  if (body.website || body.url_field || body.fax) {
    res.status(200).json({ ok: true });
    return;
  }

  const widgetId = sanitiseString(body.widgetId || '', 50);
  logWidgetId = widgetId;
  if (!widgetId || !/^tgw_[A-Za-z0-9_]+$/.test(widgetId)) {
    return done(400, { error: 'Invalid widget ID' });
  }

  const { custom, mapped } = mapAnswers(body.answers);
  if (!Object.keys(custom).length) {
    return done(400, { error: 'No answers submitted' });
  }

  // A canonical lead cannot exist without an email, so say so plainly here
  // rather than letting the generic validator reject it downstream.
  const email = sanitiseString(mapped.email || '', 254);
  if (!isValidEmail(email)) {
    return done(400, { error: 'A valid email answer is required' });
  }

  // Resolve to the RECORD id. Refuse to continue without it: the lead could
  // neither be stored nor routed, so reporting success would drop it silently.
  const widget = await resolveWidget(widgetId);
  if (!widget || !widget.recordId) {
    return done(404, { error: 'Form not found' });
  }
  logAccount = widget.clientName || widget.clientEmail || null;

  // Name: an explicit first/last mapping wins; otherwise split a full-name answer.
  let firstName = sanitiseString(mapped.firstName || '', MAX_NAME_LENGTH);
  let lastName = sanitiseString(mapped.lastName || '', MAX_NAME_LENGTH);
  const fullName = sanitiseString(mapped.fullName || '', MAX_NAME_LENGTH * 2);
  if (!firstName && !lastName && fullName) {
    const split = splitName(fullName);
    firstName = split.first;
    lastName = split.last;
  }

  const partialLead = {
    source: {
      widget: 'form',
      widgetId: widget.recordId,
      clientName: widget.clientName || '',
      clientEmail: widget.clientEmail || 'unknown@travelgenix.io',
      sourceUrl: sanitiseString(body.sourceUrl || '', 1000),
      referrer: sanitiseString(body.referrer || '', 500),
      ipAddress: ip,
      userAgent: sanitiseString(req.headers['user-agent'] || '', 500),
      visitorId: sanitiseString(body.visitorId || '', 100),
    },
    contact: {
      email,
      firstName,
      lastName,
      fullName,
      phone: sanitiseString(mapped.phone || '', 30),
    },
    consent: {
      // Submitting the form is the contact consent. Marketing consent is only
      // ever true when a question explicitly asked for it (mapTo:
      // 'marketingConsent'), never implied — it has legal weight.
      contact: true,
      marketing: mapped.marketingConsent === 'Yes' || mapped.marketingConsent === true,
      capturedAt: new Date().toISOString(),
      capturedIp: ip,
    },
    custom,
    tags: ['form'],
  };

  try {
    const result = await dispatchLead(partialLead);
    if (!result.ok) {
      return done(result.statusCode || 400, { error: result.error });
    }
    return done(200, {
      ok: true,
      leadId: result.leadId,
      delivered: result.completed.length,
      failed: result.failed.length,
    });
  } catch (err) {
    console.error('[form-submit] dispatchLead crashed:', err);
    return done(500, { error: 'Submission failed. Please try again.' });
  }
}
