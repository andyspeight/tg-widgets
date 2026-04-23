// =============================================================================
//  /api/enquiry/config.js
// =============================================================================
//
//  Returns the public-safe form definition for the Enquiry Form widget.
//  The widget calls this on load to know what to render.
//
//  SECURITY POSTURE (see spec §5.1, §6):
//  - GET only
//  - Origin must match the form's Allowed Origins list
//  - Rate limited 60/min/IP (Upstash Redis)
//  - Returns PUBLIC fields only — no PATs, webhook secrets, email recipients
//  - Short edge cache (5 min) keyed on formId; invalidated on publish
//  - Generic error responses, detailed logs server-side
//
//  This file is the reference implementation for every other route.
//  Copy the security scaffolding (method check → origin check → rate limit →
//  handler → error envelope) verbatim into:
//    - /api/enquiry/submit.js
//    - /api/enquiry/draft.js
//    - /api/enquiry/reference.js
//    - /api/enquiry/retry-routing.js
//    - /api/enquiry/gdpr-delete.js
//
// =============================================================================

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ---------- Config -----------------------------------------------------------

const AIRTABLE_BASE_ID = process.env.TG_WIDGETS_AIRTABLE_BASE_ID; // appAYzWZxvK6qlwXK
const AIRTABLE_TABLE_ID = 'tblpw4TCmQfJHZIlF';                    // Enquiry Forms
const AIRTABLE_PAT = process.env.TG_WIDGETS_AIRTABLE_PAT;         // scoped read-only
const DEMO_ORIGINS = ['https://traveldemo.site', 'https://tg-widgets.vercel.app'];

// Airtable field IDs — locked at table creation 23 Apr 2026
const FIELDS = {
  formName:          'fldC0MLSyJqg6U1zT',
  sequential:        'fldatpd9Ms5J5JGPy',
  clientName:        'fldrw1eTFYCFIo0pp',
  status:            'fldTR9W1dhMRoT0MK',
  template:          'fldaM2kxvZDutozGT',
  layoutMode:        'fldCEfu1NVD9Ewp4O',
  fieldsJSON:        'fldYdK8X3BgN7hPCx',
  headerTitle:       'fldCflEWJo9YxxA8Y',
  headerSubtitle:    'fldRBu8uajKutfX60',
  submitButtonText:  'fldjrfgcfK7580bft',
  thankYouMode:      'fldTy6oSMKUwYEYjQ',
  thankYouMessage:   'fldiB3PkfcsHRKEWd',
  redirectUrl:       'fldYkShCNfibHChpg',
  referencePrefix:   'fldXJxPXCLBnQeb7f',
  buttonColour:      'fldxyawmdBzNiOb7g',
  accentColour:      'fldD113UMPvDR4zOL',
  theme:             'fldliFN8Q7koARRU5',
  antiSpamHoneypot:  'fldVTzbUzzLjVldEk',
  antiSpamRateLimit: 'fldgwmG6xCrGuniEa',
  antiSpamTurnstile: 'fldl0efl9oLr2hngY',
  allowedOrigins:    'fldTOt0kOMUooJCuC',
};

// ---------- Rate limiter -----------------------------------------------------

const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '1 m'),
  prefix: 'rl:enquiry:config',
});

// ---------- Helpers ----------------------------------------------------------

/**
 * Returns the caller IP. Vercel sets x-forwarded-for.
 */
function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length) return fwd[0];
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Sends a generic error response. Never leaks stack traces.
 */
function errorResponse(res, status, code, message, extras = {}) {
  return res.status(status).json({ ok: false, error: code, message, ...extras });
}

/**
 * Parses the Allowed Origins field. Newline-separated, trimmed, lowercased.
 */
function parseAllowedOrigins(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(/[\n,]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Escapes a string for safe use inside an Airtable filterByFormula string.
 * Prevents formula injection — see spec §6 and airtable-operations skill.
 */
function escapeForFormula(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Validates the formId shape. Prevents obvious malformed or injected input
 * from ever hitting Airtable.
 */
function isValidFormId(raw) {
  return typeof raw === 'string' && /^EF-\d{1,6}$/.test(raw);
}

/**
 * Fetches the form record from Airtable by Form ID.
 * Returns null if not found or if Airtable returns non-2xx.
 */
async function fetchForm(formId) {
  // Build a filterByFormula that matches the formula field {Form ID}
  const formula = `{Form ID} = "${escapeForFormula(formId)}"`;
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('maxRecords', '1');
  url.searchParams.set('returnFieldsByFieldId', 'true');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
  });

  if (!response.ok) {
    // Log detail server-side but don't leak it
    console.error('[api/enquiry/config] Airtable fetch failed:', response.status);
    return null;
  }

  const data = await response.json();
  return data.records?.[0] || null;
}

/**
 * Projects the Airtable record into the public-safe config payload.
 * CRITICAL: only public fields. No PATs, webhook secrets, email recipients.
 */
function projectPublicConfig(record) {
  const f = record.fields;
  let fields = [];
  try {
    fields = JSON.parse(f[FIELDS.fieldsJSON] || '[]');
  } catch (err) {
    console.error('[api/enquiry/config] Invalid Fields JSON for', record.id, err);
    fields = [];
  }

  return {
    id: record.id,                                  // record ID, opaque to client
    formId: f['Form ID'] || null,                   // if formula field was added
    name: f[FIELDS.formName] || '',
    status: f[FIELDS.status] || 'Draft',
    layoutMode: f[FIELDS.layoutMode] || 'single-page',
    header: {
      title: f[FIELDS.headerTitle] || '',
      subtitle: f[FIELDS.headerSubtitle] || '',
    },
    fields,
    submit: {
      text: f[FIELDS.submitButtonText] || 'Send my enquiry',
    },
    thankYou: {
      mode: f[FIELDS.thankYouMode] || 'inline',
      message: f[FIELDS.thankYouMessage] || '',
      redirectUrl: f[FIELDS.thankYouMode] === 'redirect' ? (f[FIELDS.redirectUrl] || null) : null,
    },
    branding: {
      buttonColour: f[FIELDS.buttonColour] || '#1B2B5B',
      accentColour: f[FIELDS.accentColour] || '#00B4D8',
      theme: f[FIELDS.theme] || 'light',
    },
    antiSpam: {
      honeypot: !!f[FIELDS.antiSpamHoneypot],
      turnstile: !!f[FIELDS.antiSpamTurnstile],
    },
  };
  // NOTE: no routing config exposed here.
  // That lives server-side only and is read during /submit.
}

// ---------- Handler ----------------------------------------------------------

export default async function handler(req, res) {
  // Default security headers — applied to every response
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=60');

  // 1. Method check
  if (req.method === 'OPTIONS') {
    // CORS preflight
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return errorResponse(res, 405, 'method_not_allowed', 'Method not allowed.');
  }

  // 2. Input validation — formId
  const formId = req.query.formId;
  if (!isValidFormId(formId)) {
    return errorResponse(res, 400, 'invalid_form_id', 'Invalid form identifier.');
  }

  // 3. Rate limit — by IP, before expensive work
  const ip = getIp(req);
  const { success, limit, remaining, reset } = await ratelimit.limit(`ip:${ip}`);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(reset));
  if (!success) {
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return errorResponse(res, 429, 'rate_limited',
      'Too many requests. Please try again shortly.', { retryAfter });
  }

  // 4. Fetch form record
  let record;
  try {
    record = await fetchForm(formId);
  } catch (err) {
    console.error('[api/enquiry/config] Unexpected fetch error:', err);
    return errorResponse(res, 500, 'server_error',
      'Something went wrong. Please try again.');
  }

  if (!record) {
    return errorResponse(res, 404, 'form_not_found', 'Form not found.');
  }

  // 5. Status gate — only Live forms are publicly visible
  const status = record.fields[FIELDS.status];
  if (status !== 'Live') {
    // Don't reveal whether it's draft or archived — same response
    return errorResponse(res, 404, 'form_not_found', 'Form not found.');
  }

  // 6. Origin check — must be in the form's Allowed Origins list (or demo origins)
  const allowedOrigins = [
    ...parseAllowedOrigins(record.fields[FIELDS.allowedOrigins]),
    ...DEMO_ORIGINS.map(s => s.toLowerCase()),
  ];
  const origin = (req.headers.origin || '').toLowerCase();

  if (origin) {
    if (!allowedOrigins.includes(origin)) {
      // Log but don't leak whether the form exists
      console.warn('[api/enquiry/config] Origin rejected:', {
        formId, origin, allowed: allowedOrigins.length,
      });
      return errorResponse(res, 403, 'origin_not_allowed',
        'This origin is not permitted to load this form.');
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  // If no Origin header (direct request from server-side fetch, curl, etc.)
  // we allow through — it's a GET of public-safe data.

  // 7. Project to public-safe payload and return
  try {
    const form = projectPublicConfig(record);
    return res.status(200).json({ ok: true, form });
  } catch (err) {
    console.error('[api/enquiry/config] Projection error:', err);
    return errorResponse(res, 500, 'server_error',
      'Something went wrong. Please try again.');
  }
}

// =============================================================================
//  PACKAGE REQUIREMENTS
// =============================================================================
//  Add to package.json:
//    "@upstash/ratelimit": "^1.0.0",
//    "@upstash/redis": "^1.28.0"
//
//  Add to Vercel env vars (all Preview + Production):
//    TG_WIDGETS_AIRTABLE_BASE_ID=appAYzWZxvK6qlwXK
//    TG_WIDGETS_AIRTABLE_PAT=<scoped read-only PAT, Enquiry Forms table only>
//    UPSTASH_REDIS_REST_URL=...
//    UPSTASH_REDIS_REST_TOKEN=...
//
//  None of these are NEXT_PUBLIC_*. Nothing here is safe to ship client-side.
// =============================================================================
