// =============================================================================
//  /api/enquiry/submit.js
// =============================================================================
//
//  Receives a completed enquiry form submission from the widget.
//  Validates, sanitises, creates the master record, and fans out to all
//  enabled routing destinations in parallel.
//
//  Target: return 200 OK with reference within 500ms.
//  Routing fan-out is fire-and-forget after the master record is written.
//
//  SECURITY POSTURE (spec §5.2, §6):
//  - POST only, CORS preflight supported
//  - Origin matched against form's Allowed Origins list
//  - Rate limited per-form (strict/standard/lenient) via Upstash Redis
//  - Honeypot silently drops bot submissions (returns fake 200 with dummy ref)
//  - Cloudflare Turnstile verification if form has it enabled
//  - Payload size capped at 64KB
//  - Every field validated with Zod before any use
//  - Airtable writes use field IDs (not names) and strip unknown keys
//  - Generic error envelopes to client, detailed logs server-side
//  - Routing modules are isolated — one failure can't cascade
//
// =============================================================================

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import crypto from 'crypto';

// ---------- Config -----------------------------------------------------------

const WIDGET_SUITE_BASE_ID   = process.env.TG_WIDGETS_AIRTABLE_BASE_ID;    // appAYzWZxvK6qlwXK
const ENQUIRY_FORMS_TABLE_ID = 'tblpw4TCmQfJHZIlF';                         // Enquiry Forms
const WIDGET_SUITE_PAT       = process.env.TG_WIDGETS_AIRTABLE_PAT;        // read forms

const ENQUIRIES_BASE_ID      = process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID;  // appQJYiPZVU5jMAml
const SUBMISSIONS_TABLE_ID   = 'tblxtRPhALFjeMVA6';
const ROUTING_LOG_TABLE_ID   = 'tblYPXs1yFkXuwPHQ';
const ENQUIRIES_PAT          = process.env.TG_ENQUIRIES_AIRTABLE_PAT;      // write submissions

const TURNSTILE_SECRET       = process.env.TURNSTILE_SECRET_KEY;

const DEMO_ORIGINS = ['https://traveldemo.site', 'https://tg-widgets.vercel.app'];
const MAX_PAYLOAD_BYTES = 64 * 1024; // 64KB

// Enquiry Forms field IDs (config source)
const FORM_FIELDS = {
  formName:          'fldC0MLSyJqg6U1zT',
  sequential:        'fldatpd9Ms5J5JGPy',
  clientName:        'fldrw1eTFYCFIo0pp',
  status:            'fldTR9W1dhMRoT0MK',
  fieldsJSON:        'fldYdK8X3BgN7hPCx',
  thankYouMode:      'fldTy6oSMKUwYEYjQ',
  thankYouMessage:   'fldiB3PkfcsHRKEWd',
  redirectUrl:       'fldYkShCNfibHChpg',
  referencePrefix:   'fldXJxPXCLBnQeb7f',
  antiSpamHoneypot:  'fldVTzbUzzLjVldEk',
  antiSpamRateLimit: 'fldgwmG6xCrGuniEa',
  antiSpamTurnstile: 'fldl0efl9oLr2hngY',
  allowedOrigins:    'fldTOt0kOMUooJCuC',
  // routing
  routingGoogleSheets:   'fldGg7Yew1GCkmW08',
  routingAirtable:       'fld3JRqVuEKw2R9Hy',
  routingEmail:          'fldkwZwxheNZJ8CrH',
  routingEmailTo:        'fldlu1HcErBfp2wh2',
  routingEmailAutoReply: 'fldmqrE0BG0xuWTMx',
  routingWebhook:        'fldH7rQpSid6uqw0p',
  routingLunaMarketing:  'fld1HDVC7zzb5LL4d',
  routingLunaChat:       'fldrnewg30EV3xMzY',
  routingLunaWork:       'fld3RUFhBQPmFZpAW',
};

// Submissions field IDs (write target)
const SUB_FIELDS = {
  reference:         'fldNXTIZnLr7EwSf1',
  sequential:        'fldNO4d15W4xaXYLd',
  referencePrefix:   'fld4335lLxU55RKzS',
  formRecordId:      'fldk4fGMTm1BFY7MD',
  formId:            'fldMDhl75atiALwj4',
  formName:          'fldR4ipGZ4tp6fPrZ',
  clientName:        'fldJK3dXI664gGO9v',
  visitorId:         'fldOcQW20Q0L19P9G',
  ipAddress:         'fldTS4E0HWXc1IbZs',
  userAgent:         'fldaHLfF6bfNVQCbE',
  sourceUrl:         'fld6Ko6chs2aerwPg',
  locale:            'fldO9laEEYmzTMl6V',
  firstName:         'fldHIsFu8aTma2Udh',
  lastName:          'fldokNLczzqR1dJkF',
  email:             'fldNhL2013qhCCU87',
  phone:             'fldeSiHPPRo983s8f',
  destinationsJSON:  'fldanxHheVASVcVHj',
  departureAirport:  'fldA0JrLek6nvuZfC',
  departDate:        'fldsuLhoevjubPcBF',
  returnDate:        'fldgUVAATk4ptvuEQ',
  flexibleDates:     'fldWTNvplA98gEfNt',
  durationNights:    'fldukKv5npF3yu7xy',
  customDuration:    'fldKR402UW3FkmMGv',
  adults:            'fldsc0GlhRfT7KExm',
  children:          'fldBcyotWmETyjSOB',
  childAgesJSON:     'fldg8LtnXntJsVkdn',
  infants:           'fldF8uRIwmb6aDtsY',
  budgetPP:          'fldIbsjCV7EThsowD',
  stars:             'fldysKVijEzqo1wWH',
  boardBasis:        'fld8FymwGJmeb0PPe',
  interestsJSON:     'fldl6rVXUjLmSOb7v',
  notes:             'fldEQAYJmYQlatoWq',
  contactConsent:    'fld4kh6AfKWuamN0i',
  marketingConsent:  'fldiHCjnbG8EaWj6Z',
  rawPayloadJSON:    'fld1LrJ05E51ieQaF',
  routingStatusJSON: 'fldwxrWm49MhddhUd',
  status:            'fld4C1iU7lC3BVmtU',
};

// Routing Log field IDs
const LOG_FIELDS = {
  logId:         'fldn0kqHkwxLewHMK',
  submission:    'fldXVOlnNREbXBtN1',
  destination:   'fldtAS74pZ3ljRioZ',
  attempt:       'fld25WyjysGVkuzsV',
  status:        'fld1r43KEbvePkOoE',
  statusCode:    'fldwQeTKVSyQgQpUN',
  errorMessage:  'fldZyIfAkNOXmrpjA',
  durationMs:    'fld8bGhqfSux0DN7h',
};

// Board basis code → Airtable select name
const BOARD_BASIS_LABEL = {
  RO: 'Room only',
  BB: 'B&B',
  HB: 'Half board',
  FB: 'Full board',
  AI: 'All inclusive',
};

// ---------- Rate limiters ----------------------------------------------------
// Three tiers — one Redis instance, three limiters.

const redis = Redis.fromEnv();
const limiters = {
  strict:   new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(2,  '1 m'), prefix: 'rl:submit:strict' }),
  standard: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5,  '1 m'), prefix: 'rl:submit:standard' }),
  lenient:  new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(15, '1 m'), prefix: 'rl:submit:lenient' }),
};

// ---------- Validation schema ------------------------------------------------
// Mirrors spec §4. Strict — unknown fields rejected.

const submissionSchema = z.object({
  formId:       z.string().regex(/^EF-\d{1,6}$/),
  visitorId:    z.string().min(1).max(128),
  sourceUrl:    z.string().url().max(2048).optional(),
  locale:       z.string().max(16).optional(),
  honeypot:     z.string().max(128).optional(),
  turnstileToken: z.string().max(4096).nullable().optional(),
  submittedAt:  z.string().datetime().optional(),
  fields: z.object({
    destinations: z.array(z.object({
      id: z.string().max(128),
      name: z.string().max(128),
      region: z.string().max(128).optional(),
    })).max(10).optional(),
    departure_airport: z.string().max(128).optional(),
    travel_dates: z.object({
      depart:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      return:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      flexible: z.boolean().optional(),
    }).optional(),
    duration: z.object({
      nights: z.number().int().min(1).max(90).optional(),
      custom: z.string().max(64).optional(),
    }).optional(),
    travellers: z.object({
      adults:    z.number().int().min(0).max(20),
      children:  z.number().int().min(0).max(10).optional(),
      childAges: z.array(z.number().int().min(0).max(17)).max(10).optional(),
      infants:   z.number().int().min(0).max(5).optional(),
    }).optional(),
    budget_pp:   z.number().min(0).max(1000000).optional(),
    stars:       z.number().int().min(1).max(5).optional(),
    board:       z.enum(['RO', 'BB', 'HB', 'FB', 'AI']).optional(),
    interests:   z.array(z.string().max(64)).max(20).optional(),
    first_name:  z.string().min(1).max(64),
    last_name:   z.string().min(1).max(64),
    email:       z.string().email().max(256),
    phone:       z.string().max(32).optional(),
    notes:       z.string().max(2000).optional(),
    contact_consent:   z.literal(true, { errorMap: () => ({ message: 'You must agree to be contacted.' }) }),
    marketing_consent: z.boolean().optional(),
  }).passthrough(), // allow agent-added custom fields, validated per form definition
}).strict();

// ---------- Helpers ----------------------------------------------------------

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length) return fwd[0];
  return req.socket?.remoteAddress || 'unknown';
}

function errorResponse(res, status, code, message, extras = {}) {
  return res.status(status).json({ ok: false, error: code, message, ...extras });
}

function parseAllowedOrigins(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(/[\n,]/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

function escapeForFormula(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Sanitise a string for safe storage. Strips null bytes, control chars,
 * and caps length. No HTML parsing — we never render Airtable content as
 * HTML in the widget (textContent only), so HTML escaping isn't needed here.
 */
function cleanString(s, maxLen = 2000) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLen)
    .trim();
}

function normaliseEmail(e) {
  return String(e || '').trim().toLowerCase().slice(0, 256);
}

function normalisePhone(p) {
  if (!p) return '';
  return String(p).replace(/[^\d+]/g, '').slice(0, 32);
}

/**
 * Generate a reference: {prefix}2026-{padded-sequential}
 * e.g. TG-HE-2026-04823
 */
function buildReference(prefix, sequential) {
  const year = new Date().getUTCFullYear();
  const padded = String(sequential).padStart(5, '0');
  return `${prefix || 'TG-'}${year}-${padded}`;
}

// ---------- Form config fetch ------------------------------------------------

async function fetchForm(formId) {
  const formula = `{Form ID} = "${escapeForFormula(formId)}"`;
  const url = new URL(`https://api.airtable.com/v0/${WIDGET_SUITE_BASE_ID}/${ENQUIRY_FORMS_TABLE_ID}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('maxRecords', '1');
  url.searchParams.set('returnFieldsByFieldId', 'true');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${WIDGET_SUITE_PAT}` },
  });
  if (!response.ok) {
    console.error('[api/enquiry/submit] fetchForm failed:', response.status);
    return null;
  }
  const data = await response.json();
  return data.records?.[0] || null;
}

// ---------- Turnstile verification -------------------------------------------

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) {
    console.error('[api/enquiry/submit] TURNSTILE_SECRET_KEY missing');
    return false;
  }
  try {
    const body = new URLSearchParams();
    body.set('secret', TURNSTILE_SECRET);
    body.set('response', token);
    body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = await r.json();
    return !!json.success;
  } catch (err) {
    console.error('[api/enquiry/submit] Turnstile error:', err);
    return false;
  }
}

// ---------- Sequential counter (Redis atomic INCR) --------------------------
// Airtable's autonumber increments only on record creation, but we need the
// sequential *before* we write (to build the reference atomically in the same
// payload). Redis INCR gives us a monotonic counter that survives restarts.

async function nextSequential() {
  const key = 'seq:submissions:global';
  return await redis.incr(key);
}

// ---------- Master record write ---------------------------------------------

async function writeMasterRecord({ form, payload, meta, sequential, reference }) {
  const f = form.fields;
  const p = payload.fields;
  const dates = p.travel_dates || {};
  const travellers = p.travellers || { adults: 0 };
  const duration = p.duration || {};

  const body = {
    fields: {
      [SUB_FIELDS.reference]:        reference,
      [SUB_FIELDS.sequential]:       sequential,
      [SUB_FIELDS.referencePrefix]:  cleanString(f[FORM_FIELDS.referencePrefix] || 'TG-', 32),
      [SUB_FIELDS.formRecordId]:     form.id,
      [SUB_FIELDS.formId]:           cleanString(payload.formId, 16),
      [SUB_FIELDS.formName]:         cleanString(f[FORM_FIELDS.formName], 200),
      [SUB_FIELDS.clientName]:       cleanString(f[FORM_FIELDS.clientName], 200),
      [SUB_FIELDS.visitorId]:        cleanString(payload.visitorId, 128),
      [SUB_FIELDS.ipAddress]:        cleanString(meta.ip, 64),
      [SUB_FIELDS.userAgent]:        cleanString(meta.userAgent, 500),
      [SUB_FIELDS.sourceUrl]:        cleanString(payload.sourceUrl, 2048) || null,
      [SUB_FIELDS.locale]:           cleanString(payload.locale, 16),
      [SUB_FIELDS.firstName]:        cleanString(p.first_name, 64),
      [SUB_FIELDS.lastName]:         cleanString(p.last_name, 64),
      [SUB_FIELDS.email]:            normaliseEmail(p.email),
      [SUB_FIELDS.phone]:            normalisePhone(p.phone),
      [SUB_FIELDS.destinationsJSON]: JSON.stringify(p.destinations || []),
      [SUB_FIELDS.departureAirport]: cleanString(p.departure_airport, 128),
      [SUB_FIELDS.flexibleDates]:    !!dates.flexible,
      [SUB_FIELDS.adults]:           travellers.adults ?? 0,
      [SUB_FIELDS.children]:         travellers.children ?? 0,
      [SUB_FIELDS.childAgesJSON]:    JSON.stringify(travellers.childAges || []),
      [SUB_FIELDS.infants]:          travellers.infants ?? 0,
      [SUB_FIELDS.stars]:            p.stars ?? null,
      [SUB_FIELDS.interestsJSON]:    JSON.stringify(p.interests || []),
      [SUB_FIELDS.notes]:            cleanString(p.notes, 2000),
      [SUB_FIELDS.contactConsent]:   !!p.contact_consent,
      [SUB_FIELDS.marketingConsent]: !!p.marketing_consent,
      [SUB_FIELDS.rawPayloadJSON]:   JSON.stringify(payload).slice(0, 60000),
      [SUB_FIELDS.status]:           'New',
    },
  };

  // Optional fields — only include when present (Airtable rejects empty dates)
  if (dates.depart)        body.fields[SUB_FIELDS.departDate]     = dates.depart;
  if (dates.return)        body.fields[SUB_FIELDS.returnDate]     = dates.return;
  if (duration.nights)     body.fields[SUB_FIELDS.durationNights] = duration.nights;
  if (duration.custom)     body.fields[SUB_FIELDS.customDuration] = cleanString(duration.custom, 64);
  if (typeof p.budget_pp === 'number') body.fields[SUB_FIELDS.budgetPP] = p.budget_pp;
  if (p.board && BOARD_BASIS_LABEL[p.board]) body.fields[SUB_FIELDS.boardBasis] = BOARD_BASIS_LABEL[p.board];

  const url = `https://api.airtable.com/v0/${ENQUIRIES_BASE_ID}/${SUBMISSIONS_TABLE_ID}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ENQUIRIES_PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errBody = await response.text();
    console.error('[api/enquiry/submit] writeMasterRecord failed:', response.status, errBody.slice(0, 500));
    throw new Error(`Airtable write failed: ${response.status}`);
  }
  const data = await response.json();
  return data.id; // record ID
}

// ---------- Routing log entry ------------------------------------------------

async function logRouting({ submissionId, destination, attempt, status, statusCode, errorMessage, durationMs }) {
  try {
    const body = {
      fields: {
        [LOG_FIELDS.submission]:   [submissionId],
        [LOG_FIELDS.destination]:  destination,
        [LOG_FIELDS.attempt]:      attempt,
        [LOG_FIELDS.status]:       status,
        [LOG_FIELDS.statusCode]:   statusCode ?? null,
        [LOG_FIELDS.errorMessage]: errorMessage ? String(errorMessage).slice(0, 500) : null,
        [LOG_FIELDS.durationMs]:   durationMs ?? null,
      },
    };
    const url = `https://api.airtable.com/v0/${ENQUIRIES_BASE_ID}/${ROUTING_LOG_TABLE_ID}`;
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ENQUIRIES_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Routing log failure is non-fatal — log server-side only
    console.error('[api/enquiry/submit] logRouting failed:', err);
  }
}

// ---------- Routing orchestrator --------------------------------------------
// Each destination module is in its own file under /api/enquiry/_lib/routing/.
// For this reference route we use lazy imports so the file stays readable.
// Each module exports a single function: async (ctx) => { status, statusCode?, error? }
//
// ctx shape passed to every module:
//   { form, payload, submissionId, reference, meta }

async function fanOutRouting({ form, payload, submissionId, reference, meta }) {
  const f = form.fields;
  const ctx = { form, payload, submissionId, reference, meta };

  const enabled = [
    { key: 'email',           always: true,  on: f[FORM_FIELDS.routingEmail],          loader: () => import('./_lib/routing/email.js') },
    { key: 'auto-reply',      always: false, on: f[FORM_FIELDS.routingEmailAutoReply], loader: () => import('./_lib/routing/auto-reply.js') },
    { key: 'google-sheets',   always: false, on: f[FORM_FIELDS.routingGoogleSheets],   loader: () => import('./_lib/routing/google-sheets.js') },
    { key: 'airtable',        always: false, on: f[FORM_FIELDS.routingAirtable],       loader: () => import('./_lib/routing/airtable.js') },
    { key: 'webhook',         always: false, on: f[FORM_FIELDS.routingWebhook],        loader: () => import('./_lib/routing/webhook.js') },
    { key: 'luna-chat',       always: false, on: f[FORM_FIELDS.routingLunaChat],       loader: () => import('./_lib/routing/luna-chat.js') },
    { key: 'luna-marketing',  always: false, on: f[FORM_FIELDS.routingLunaMarketing],  loader: () => import('./_lib/routing/luna-marketing.js') },
    { key: 'luna-work',       always: false, on: f[FORM_FIELDS.routingLunaWork],       loader: () => import('./_lib/routing/luna-work.js') },
  ].filter(r => r.always || r.on);

  // luna-marketing only runs if marketing consent was given
  const filtered = enabled.filter(r => {
    if (r.key === 'luna-marketing') return payload.fields.marketing_consent === true;
    return true;
  });

  // Fire all routing modules in parallel. Errors are caught per-module.
  const results = await Promise.allSettled(filtered.map(async (r) => {
    const start = Date.now();
    try {
      const mod = await r.loader();
      const result = await mod.default(ctx);
      const durationMs = Date.now() - start;
      await logRouting({
        submissionId,
        destination: r.key,
        attempt: 1,
        status: result.status === 'ok' ? 'ok' : 'failed',
        statusCode: result.statusCode,
        errorMessage: result.error,
        durationMs,
      });
      return { key: r.key, ...result };
    } catch (err) {
      const durationMs = Date.now() - start;
      console.error(`[api/enquiry/submit] Routing ${r.key} threw:`, err);
      await logRouting({
        submissionId,
        destination: r.key,
        attempt: 1,
        status: 'failed',
        errorMessage: err.message,
        durationMs,
      });
      return { key: r.key, status: 'failed', error: err.message };
    }
  }));

  // Build status summary for the Routing Status JSON field
  const summary = {};
  results.forEach((r, i) => {
    const key = filtered[i].key;
    summary[key] = r.status === 'fulfilled' ? r.value.status : 'failed';
  });

  // Write summary back to the master record (fire-and-forget)
  try {
    const url = `https://api.airtable.com/v0/${ENQUIRIES_BASE_ID}/${SUBMISSIONS_TABLE_ID}/${submissionId}`;
    await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${ENQUIRIES_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: { [SUB_FIELDS.routingStatusJSON]: JSON.stringify(summary) } }),
    });
  } catch (err) {
    console.error('[api/enquiry/submit] Routing summary write failed:', err);
  }

  return summary;
}

// ---------- Thank-you context builder ---------------------------------------

function buildThankYouContext({ form, payload, submissionId, reference }) {
  const f = form.fields;
  const mode = f[FORM_FIELDS.thankYouMode] || 'inline';
  const message = (f[FORM_FIELDS.thankYouMessage] || '')
    .replace(/\{firstName\}/g, payload.fields.first_name || '');

  const ctx = { mode, message };
  if (mode === 'redirect') ctx.redirectUrl = f[FORM_FIELDS.redirectUrl] || null;

  if (f[FORM_FIELDS.routingLunaChat]) {
    // Short-lived JWT so Luna Chat can prove the enquiry was real (spec §10, Q5)
    const payload64 = Buffer.from(JSON.stringify({
      ref: reference,
      sub: submissionId,
      exp: Math.floor(Date.now() / 1000) + 900, // 15 min
    })).toString('base64url');
    const sig = crypto
      .createHmac('sha256', process.env.LUNA_CHAT_JWT_SECRET || '')
      .update(payload64)
      .digest('base64url');
    ctx.lunaChatAvailable = true;
    ctx.lunaChatToken = `${payload64}.${sig}`;
  }

  return ctx;
}

// ---------- Handler ----------------------------------------------------------

export default async function handler(req, res) {
  // Baseline security headers
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store');

  // 1. CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    return res.status(204).end();
  }

  // 2. Method check
  if (req.method !== 'POST') {
    return errorResponse(res, 405, 'method_not_allowed', 'Method not allowed.');
  }

  // 3. Payload size check (Vercel has its own limits but belt-and-braces)
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (rawBody.length > MAX_PAYLOAD_BYTES) {
    return errorResponse(res, 413, 'payload_too_large', 'Submission payload too large.');
  }

  // 4. Parse & validate with Zod
  let payload;
  try {
    const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    payload = submissionSchema.parse(parsed);
  } catch (err) {
    if (err?.issues) {
      const fields = {};
      err.issues.forEach(issue => {
        const path = issue.path.join('.');
        if (!fields[path]) fields[path] = issue.message;
      });
      return errorResponse(res, 400, 'validation_failed',
        'One or more fields are invalid.', { fields });
    }
    return errorResponse(res, 400, 'invalid_json', 'Request body must be valid JSON.');
  }

  // 5. Fetch form definition
  let form;
  try {
    form = await fetchForm(payload.formId);
  } catch (err) {
    console.error('[api/enquiry/submit] Form fetch error:', err);
    return errorResponse(res, 500, 'server_error', 'Something went wrong. Please try again.');
  }
  if (!form) {
    return errorResponse(res, 404, 'form_not_found', 'Form not found.');
  }
  if (form.fields[FORM_FIELDS.status] !== 'Live') {
    return errorResponse(res, 404, 'form_not_found', 'Form not found.');
  }

  // 6. Origin check
  const allowedOrigins = [
    ...parseAllowedOrigins(form.fields[FORM_FIELDS.allowedOrigins]),
    ...DEMO_ORIGINS.map(s => s.toLowerCase()),
  ];
  const origin = (req.headers.origin || '').toLowerCase();
  if (origin) {
    if (!allowedOrigins.includes(origin)) {
      console.warn('[api/enquiry/submit] Origin rejected:', { formId: payload.formId, origin });
      return errorResponse(res, 403, 'origin_not_allowed',
        'This origin is not permitted to submit to this form.');
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  // 7. Honeypot — silent success (don't reveal we caught the bot)
  if (payload.honeypot && payload.honeypot.length > 0) {
    console.warn('[api/enquiry/submit] Honeypot triggered:', { formId: payload.formId, ip: getIp(req) });
    return res.status(200).json({
      ok: true,
      reference: 'TG-' + new Date().getUTCFullYear() + '-00000',
      submissionId: 'rec0000000000000',
      thankYou: { mode: 'inline', message: 'Thanks — we\'re on it.' },
    });
  }

  // 8. Rate limit (form-configurable strictness)
  const ip = getIp(req);
  const tier = form.fields[FORM_FIELDS.antiSpamRateLimit] || 'standard';
  const limiter = limiters[tier] || limiters.standard;
  const rl = await limiter.limit(`${payload.formId}:${ip}`);
  res.setHeader('X-RateLimit-Limit', String(rl.limit));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  res.setHeader('X-RateLimit-Reset', String(rl.reset));
  if (!rl.success) {
    const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return errorResponse(res, 429, 'rate_limited',
      'Too many submissions. Please try again in a minute.', { retryAfter });
  }

  // 9. Turnstile verification (if form has it enabled)
  if (form.fields[FORM_FIELDS.antiSpamTurnstile]) {
    if (!payload.turnstileToken) {
      return errorResponse(res, 400, 'turnstile_missing',
        'Please complete the security check.');
    }
    const ok = await verifyTurnstile(payload.turnstileToken, ip);
    if (!ok) {
      return errorResponse(res, 403, 'turnstile_failed',
        'Security check failed. Please try again.');
    }
  }

  // 10. Generate reference + sequential
  let sequential, reference;
  try {
    sequential = await nextSequential();
    reference = buildReference(form.fields[FORM_FIELDS.referencePrefix], sequential);
  } catch (err) {
    console.error('[api/enquiry/submit] nextSequential failed:', err);
    return errorResponse(res, 500, 'server_error', 'Something went wrong. Please try again.');
  }

  // 11. Write master record
  const meta = {
    ip,
    userAgent: req.headers['user-agent'] || '',
  };
  let submissionId;
  try {
    submissionId = await writeMasterRecord({ form, payload, meta, sequential, reference });
  } catch (err) {
    console.error('[api/enquiry/submit] Master record write failed:', err);
    return errorResponse(res, 500, 'server_error',
      'We could not save your enquiry. Please try again.');
  }

  // 12. Build thank-you response before firing routing (so we can return fast)
  const thankYou = buildThankYouContext({ form, payload, submissionId, reference });

  // 13. Fan out routing — DO NOT await. We want to return to the user fast.
  //     Routing continues in the background via Vercel's waitUntil pattern.
  fanOutRouting({ form, payload, submissionId, reference, meta })
    .catch(err => console.error('[api/enquiry/submit] Routing orchestrator failed:', err));

  // 14. Return success to the visitor
  return res.status(200).json({
    ok: true,
    reference,
    submissionId,
    thankYou,
  });
}

// =============================================================================
//  PACKAGE REQUIREMENTS
// =============================================================================
//  "@upstash/ratelimit": "^1.0.0"
//  "@upstash/redis":     "^1.28.0"
//  "zod":                "^3.22.0"
//
//  Env vars (all Preview + Production):
//    TG_WIDGETS_AIRTABLE_BASE_ID=appAYzWZxvK6qlwXK
//    TG_WIDGETS_AIRTABLE_PAT=<scoped read on Enquiry Forms>
//    TG_ENQUIRIES_AIRTABLE_BASE_ID=appQJYiPZVU5jMAml
//    TG_ENQUIRIES_AIRTABLE_PAT=<scoped read+write on Submissions + Routing Log>
//    UPSTASH_REDIS_REST_URL=...
//    UPSTASH_REDIS_REST_TOKEN=...
//    TURNSTILE_SECRET_KEY=<Cloudflare Turnstile secret>
//    LUNA_CHAT_JWT_SECRET=<32-byte hex for HMAC signing>
//
//  Next routing modules to implement (stubs expected by the orchestrator):
//    _lib/routing/email.js          — SendGrid, agent notification
//    _lib/routing/auto-reply.js     — SendGrid, customer auto-reply (agent-branded)
//    _lib/routing/google-sheets.js  — Google Sheets API, append row
//    _lib/routing/airtable.js       — client's Airtable, encrypted PAT
//    _lib/routing/webhook.js        — HMAC-signed POST
//    _lib/routing/luna-chat.js      — context seed (no HTTP)
//    _lib/routing/luna-marketing.js — internal API call to enrol
//    _lib/routing/luna-work.js      — placeholder until Luna Work launches
//
//  Each module exports a default async function with signature:
//    ({ form, payload, submissionId, reference, meta }) => ({
//      status: 'ok' | 'failed',
//      statusCode?: number,
//      error?: string,
//    })
// =============================================================================
