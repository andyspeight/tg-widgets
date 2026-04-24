// =============================================================================
//  /api/enquiry/submit.js
// =============================================================================
//
//  Receives a completed enquiry form submission from the widget.
//  Validates, sanitises, creates the master record, and fans out to all
//  enabled routing destinations in parallel.
//
//  DEPENDENCIES: None. This module uses only Node.js built-ins plus the
//  shared helpers in ../_auth.js. No npm packages required.
//
//  SECURITY POSTURE:
//  - POST only, CORS preflight supported
//  - Origin matched against form's Allowed Origins list
//  - In-memory rate limiting via shared applyRateLimit from _auth.js
//  - Honeypot silently drops bot submissions (returns fake 200)
//  - Cloudflare Turnstile verification if form has it enabled AND secret is set
//  - Payload size capped at 64KB
//  - Every field validated by hand-written schema before any use
//  - Airtable writes use field IDs (not names) and strip unknown keys
//  - Generic error envelopes to client, detailed logs server-side
//  - Routing modules are isolated — one failure can't cascade
//
// =============================================================================

import { createHmac } from 'node:crypto';
import { applyRateLimit, RATE_LIMITS } from '../_auth.js';

// Static imports for routing handlers that exist today. Static imports are
// reliably traced by the Vercel bundler — dynamic imports with string paths
// are not, which caused "mod.default is not a function" errors alternating
// between email.js and auto-reply.js per deploy. When future routing modules
// are built (google-sheets, webhook, luna-*), import them here the same way
// and swap their entry in the `enabled` array below from `loader` to `handler`.
import sendAgentEmail from './_lib/routing/email.js';
import sendAutoReply  from './_lib/routing/auto-reply.js';

// ---------- Config -----------------------------------------------------------

// The widget-suite base holds form config. Re-uses the same env vars that the
// config endpoint uses — one PAT, one base ID, keeps things simple.
const WIDGET_SUITE_BASE_ID   = process.env.AIRTABLE_BASE_ID;              // appAYzWZxvK6qlwXK
const ENQUIRY_FORMS_TABLE_ID = 'tblpw4TCmQfJHZIlF';                       // Enquiry Forms
const WIDGET_SUITE_PAT       = process.env.AIRTABLE_KEY;                  // read forms

// The enquiries base holds submissions. Dedicated PAT for write access.
const ENQUIRIES_BASE_ID      = process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID; // appQJYiPZVU5jMAml
const SUBMISSIONS_TABLE_ID   = 'tblxtRPhALFjeMVA6';
const ROUTING_LOG_TABLE_ID   = 'tblYPXs1yFkXuwPHQ';
const ENQUIRIES_PAT          = process.env.TG_ENQUIRIES_AIRTABLE_PAT;     // write submissions

// Optional: Turnstile secret. If set AND the form has Turnstile enabled, we
// verify. If the form has Turnstile enabled but the secret is missing, we fail
// closed (better to block than to silently skip anti-spam).
const TURNSTILE_SECRET       = process.env.TURNSTILE_SECRET_KEY;

// Demo origins permitted alongside any form-configured allowedOrigins
const DEMO_ORIGINS = [
  'https://tg-widgets.vercel.app',
];

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
  ownerEmail:        'fldLzWF0XnEXeZYH1',
  // routing flags + config
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
  ownerEmail:        'fldPP6tud7N2wwcUG',
  submittedAt:       'fldp2oKqNRcCrMcLG',
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

// Rate limits per form-configured tier. Backed by the in-memory limiter
// in _auth.js — good enough for normal traffic, each instance is separate
// so a determined attacker hitting cold starts can work around it. For
// stronger defence migrate to Upstash Redis later.
const FORM_RATE_LIMITS = {
  strict:   { max: 2,  windowMs: 60 * 1000 },
  standard: { max: 5,  windowMs: 60 * 1000 },
  lenient:  { max: 15, windowMs: 60 * 1000 },
};

// ---------- Hand-written validators ------------------------------------------
// Replaces Zod. The shape mirrors the previous zod schema exactly.

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORM_ID_REGEX  = /^EF-\d{1,6}$/;

// Validation returns { ok, errors? } where errors is a {path: message} object.
// Keeps submit.js surface area small — we don't need zod's full feature set.
function validatePayload(raw) {
  const errors = {};

  function fail(path, message) { errors[path] = message; }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: { '': 'Body must be a JSON object.' } };
  }

  // Top-level required fields
  if (typeof raw.formId !== 'string' || !FORM_ID_REGEX.test(raw.formId)) {
    fail('formId', 'Invalid formId.');
  }
  if (typeof raw.visitorId !== 'string' || raw.visitorId.length < 1 || raw.visitorId.length > 128) {
    fail('visitorId', 'Invalid visitorId.');
  }
  if (raw.sourceUrl !== undefined) {
    if (typeof raw.sourceUrl !== 'string' || raw.sourceUrl.length > 2048) {
      fail('sourceUrl', 'Invalid sourceUrl.');
    } else {
      try { new URL(raw.sourceUrl); } catch (e) { fail('sourceUrl', 'Invalid URL.'); }
    }
  }
  if (raw.locale !== undefined && (typeof raw.locale !== 'string' || raw.locale.length > 16)) {
    fail('locale', 'Invalid locale.');
  }
  if (raw.honeypot !== undefined && (typeof raw.honeypot !== 'string' || raw.honeypot.length > 128)) {
    fail('honeypot', 'Invalid honeypot.');
  }
  if (raw.turnstileToken !== undefined && raw.turnstileToken !== null
    && (typeof raw.turnstileToken !== 'string' || raw.turnstileToken.length > 4096)) {
    fail('turnstileToken', 'Invalid turnstileToken.');
  }

  // Fields block
  const f = raw.fields;
  if (!f || typeof f !== 'object' || Array.isArray(f)) {
    fail('fields', 'Missing fields object.');
    return { ok: false, errors };
  }

  // Contact — required
  if (typeof f.first_name !== 'string' || f.first_name.length < 1 || f.first_name.length > 64) {
    fail('fields.first_name', 'First name is required.');
  }
  if (typeof f.last_name !== 'string' || f.last_name.length < 1 || f.last_name.length > 64) {
    fail('fields.last_name', 'Last name is required.');
  }
  if (typeof f.email !== 'string' || f.email.length > 256 || !EMAIL_REGEX.test(f.email)) {
    fail('fields.email', 'A valid email is required.');
  }
  if (f.contact_consent !== true) {
    fail('fields.contact_consent', 'You must agree to be contacted.');
  }

  // Optional contact
  if (f.phone !== undefined && (typeof f.phone !== 'string' || f.phone.length > 32)) {
    fail('fields.phone', 'Invalid phone.');
  }
  if (f.notes !== undefined && (typeof f.notes !== 'string' || f.notes.length > 2000)) {
    fail('fields.notes', 'Notes too long.');
  }
  if (f.marketing_consent !== undefined && typeof f.marketing_consent !== 'boolean') {
    fail('fields.marketing_consent', 'Invalid consent flag.');
  }

  // Destinations
  if (f.destinations !== undefined) {
    if (!Array.isArray(f.destinations) || f.destinations.length > 10) {
      fail('fields.destinations', 'Invalid destinations.');
    } else {
      f.destinations.forEach((d, i) => {
        if (!d || typeof d !== 'object') fail(`fields.destinations[${i}]`, 'Invalid destination.');
        else {
          if (typeof d.id !== 'string' || d.id.length > 128) fail(`fields.destinations[${i}].id`, 'Invalid id.');
          if (typeof d.name !== 'string' || d.name.length > 128) fail(`fields.destinations[${i}].name`, 'Invalid name.');
          if (d.region !== undefined && (typeof d.region !== 'string' || d.region.length > 128)) {
            fail(`fields.destinations[${i}].region`, 'Invalid region.');
          }
        }
      });
    }
  }

  if (f.departure_airport !== undefined && (typeof f.departure_airport !== 'string' || f.departure_airport.length > 128)) {
    fail('fields.departure_airport', 'Invalid airport.');
  }

  // Travel dates
  if (f.travel_dates !== undefined) {
    if (!f.travel_dates || typeof f.travel_dates !== 'object') {
      fail('fields.travel_dates', 'Invalid travel_dates.');
    } else {
      if (f.travel_dates.depart !== undefined && !ISO_DATE_REGEX.test(f.travel_dates.depart)) fail('fields.travel_dates.depart', 'Invalid date.');
      if (f.travel_dates.return !== undefined && !ISO_DATE_REGEX.test(f.travel_dates.return)) fail('fields.travel_dates.return', 'Invalid date.');
      if (f.travel_dates.flexible !== undefined && typeof f.travel_dates.flexible !== 'boolean') fail('fields.travel_dates.flexible', 'Invalid flag.');
    }
  }

  // Duration
  if (f.duration !== undefined) {
    if (!f.duration || typeof f.duration !== 'object') {
      fail('fields.duration', 'Invalid duration.');
    } else {
      if (f.duration.nights !== undefined
        && (!Number.isInteger(f.duration.nights) || f.duration.nights < 1 || f.duration.nights > 90)) {
        fail('fields.duration.nights', 'Nights must be 1–90.');
      }
      if (f.duration.custom !== undefined && (typeof f.duration.custom !== 'string' || f.duration.custom.length > 64)) {
        fail('fields.duration.custom', 'Invalid custom duration.');
      }
    }
  }

  // Travellers
  if (f.travellers !== undefined) {
    if (!f.travellers || typeof f.travellers !== 'object') {
      fail('fields.travellers', 'Invalid travellers.');
    } else {
      const t = f.travellers;
      if (!Number.isInteger(t.adults) || t.adults < 0 || t.adults > 20) {
        fail('fields.travellers.adults', 'Adults must be 0–20.');
      }
      if (t.children !== undefined && (!Number.isInteger(t.children) || t.children < 0 || t.children > 10)) {
        fail('fields.travellers.children', 'Children must be 0–10.');
      }
      if (t.childAges !== undefined) {
        if (!Array.isArray(t.childAges) || t.childAges.length > 10) {
          fail('fields.travellers.childAges', 'Invalid ages.');
        } else {
          t.childAges.forEach((age, i) => {
            if (!Number.isInteger(age) || age < 0 || age > 17) {
              fail(`fields.travellers.childAges[${i}]`, 'Age must be 0–17.');
            }
          });
        }
      }
      if (t.infants !== undefined && (!Number.isInteger(t.infants) || t.infants < 0 || t.infants > 5)) {
        fail('fields.travellers.infants', 'Infants must be 0–5.');
      }
    }
  }

  if (f.budget_pp !== undefined
    && (typeof f.budget_pp !== 'number' || f.budget_pp < 0 || f.budget_pp > 1000000 || Number.isNaN(f.budget_pp))) {
    fail('fields.budget_pp', 'Invalid budget.');
  }
  if (f.stars !== undefined
    && (!Number.isInteger(f.stars) || f.stars < 1 || f.stars > 5)) {
    fail('fields.stars', 'Stars must be 1–5.');
  }
  if (f.board !== undefined && !['RO', 'BB', 'HB', 'FB', 'AI'].includes(f.board)) {
    fail('fields.board', 'Invalid board basis.');
  }
  if (f.interests !== undefined) {
    if (!Array.isArray(f.interests) || f.interests.length > 20) {
      fail('fields.interests', 'Invalid interests.');
    } else {
      f.interests.forEach((x, i) => {
        if (typeof x !== 'string' || x.length > 64) fail(`fields.interests[${i}]`, 'Invalid interest.');
      });
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: raw };
}

// ---------- In-memory sequential counter -------------------------------------
// Replaces the Upstash Redis INCR pattern. Fine for single-instance traffic;
// cold-start safe because we also have Airtable's autonumber as a backup in
// the `sequential` field — if two Vercel instances race, at worst we get
// duplicate reference numbers (rare) and Airtable catches it on uniqueness
// constraints. The reference number is for human reading, not database
// integrity.
let sequentialCounter = Date.now() % 1000000; // seed from now to spread hot starts

function nextSequential() {
  sequentialCounter = (sequentialCounter + 1) % 999999;
  if (sequentialCounter === 0) sequentialCounter = 1;
  return sequentialCounter;
}

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
 * Generate a reference: {prefix}{year}-{padded-sequential}
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
    console.error('[submit] fetchForm failed:', response.status);
    return null;
  }
  const data = await response.json();
  return data.records?.[0] || null;
}

// ---------- Turnstile verification -------------------------------------------

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) {
    // Form has Turnstile enabled but no secret configured. Fail closed so
    // we don't accidentally skip anti-spam — better to block legit users
    // than allow bots past.
    console.error('[submit] TURNSTILE_SECRET_KEY missing but form requires Turnstile');
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
    console.error('[submit] Turnstile error:', err);
    return false;
  }
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
      // CRITICAL: Owner Email scopes submissions per agent in the inbox.
      // Copy the form's owner so the inbox can filter correctly.
      [SUB_FIELDS.ownerEmail]:       normaliseEmail(f[FORM_FIELDS.ownerEmail]),
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
    body: JSON.stringify({ ...body, typecast: true }),
  });
  if (!response.ok) {
    const errBody = await response.text();
    console.error('[submit] writeMasterRecord failed:', response.status, errBody.slice(0, 500));
    throw new Error(`Airtable write failed: ${response.status}`);
  }
  const data = await response.json();
  return data.id;
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
      body: JSON.stringify({ ...body, typecast: true }),
    });
  } catch (err) {
    // Routing log failure is non-fatal — we log it server-side only
    console.error('[submit] logRouting failed:', err);
  }
}

// ---------- Routing orchestrator --------------------------------------------

async function fanOutRouting({ form, payload, submissionId, reference, meta }) {
  const f = form.fields;
  const ctx = { form, payload, submissionId, reference, meta };

  // Each entry describes a routing destination. Entries with `handler` use
  // a statically imported function (reliable on Vercel). Entries with
  // `loader` still use dynamic import — keep these ONLY for modules that
  // don't exist yet. When you build them, add a static import at the top
  // of this file and swap the entry over to `handler`.
  const enabled = [
    { key: 'email',          always: true,  on: f[FORM_FIELDS.routingEmail],          handler: sendAgentEmail },
    { key: 'auto-reply',     always: false, on: f[FORM_FIELDS.routingEmailAutoReply], handler: sendAutoReply },
    { key: 'google-sheets',  always: false, on: f[FORM_FIELDS.routingGoogleSheets],   loader:  () => import('./_lib/routing/google-sheets.js') },
    { key: 'airtable',       always: false, on: f[FORM_FIELDS.routingAirtable],       loader:  () => import('./_lib/routing/airtable.js') },
    { key: 'webhook',        always: false, on: f[FORM_FIELDS.routingWebhook],        loader:  () => import('./_lib/routing/webhook.js') },
    { key: 'luna-chat',      always: false, on: f[FORM_FIELDS.routingLunaChat],       loader:  () => import('./_lib/routing/luna-chat.js') },
    { key: 'luna-marketing', always: false, on: f[FORM_FIELDS.routingLunaMarketing],  loader:  () => import('./_lib/routing/luna-marketing.js') },
    { key: 'luna-work',      always: false, on: f[FORM_FIELDS.routingLunaWork],       loader:  () => import('./_lib/routing/luna-work.js') },
  ].filter(r => r.always || r.on);

  // Luna Marketing only fires if the visitor gave marketing consent
  const filtered = enabled.filter(r => {
    if (r.key === 'luna-marketing') return payload.fields.marketing_consent === true;
    return true;
  });

  const results = await Promise.allSettled(filtered.map(async (r) => {
    const start = Date.now();
    try {
      // Static handler or dynamic loader — run whichever the entry provides.
      let result;
      if (r.handler) {
        result = await r.handler(ctx);
      } else {
        const mod = await r.loader();
        if (typeof mod.default !== 'function') {
          throw new Error(`Routing module ${r.key} has no default export`);
        }
        result = await mod.default(ctx);
      }
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
      console.error(`[submit] Routing ${r.key} threw:`, err);
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

  const summary = {};
  results.forEach((r, i) => {
    const key = filtered[i].key;
    summary[key] = r.status === 'fulfilled' ? r.value.status : 'failed';
  });

  // Write summary back to the master record
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
    console.error('[submit] Routing summary write failed:', err);
  }

  return summary;
}

// ---------- Thank-you context builder ---------------------------------------

function buildThankYouContext({ form, payload, submissionId, reference }) {
  const f = form.fields;
  const mode = f[FORM_FIELDS.thankYouMode] || 'inline';
  const message = (f[FORM_FIELDS.thankYouMessage] || 'Thanks, {firstName} — we\'re on it.')
    .replace(/\{firstName\}/g, payload.fields.first_name || '');

  const ctx = { mode, message };
  if (mode === 'redirect') ctx.redirectUrl = f[FORM_FIELDS.redirectUrl] || null;

  // If Luna Chat is enabled, mint a short-lived JWT-ish token the chat
  // widget can use to prove the enquiry happened
  if (f[FORM_FIELDS.routingLunaChat]) {
    try {
      const payload64 = Buffer.from(JSON.stringify({
        ref: reference,
        sub: submissionId,
        exp: Math.floor(Date.now() / 1000) + 900,
      })).toString('base64url');
      const secret = process.env.LUNA_CHAT_JWT_SECRET || '';
      if (secret) {
        const sig = createHmac('sha256', secret).update(payload64).digest('base64url');
        ctx.lunaChatAvailable = true;
        ctx.lunaChatToken = `${payload64}.${sig}`;
      }
    } catch (err) {
      console.warn('[submit] Luna Chat token generation failed:', err);
    }
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

  // 3. Config sanity check — fail loudly if env vars missing
  if (!WIDGET_SUITE_PAT || !WIDGET_SUITE_BASE_ID) {
    console.error('[submit] Missing AIRTABLE_KEY or AIRTABLE_BASE_ID');
    return errorResponse(res, 500, 'server_error', 'Server misconfigured.');
  }
  if (!ENQUIRIES_PAT || !ENQUIRIES_BASE_ID) {
    console.error('[submit] Missing TG_ENQUIRIES_AIRTABLE_PAT or TG_ENQUIRIES_AIRTABLE_BASE_ID');
    return errorResponse(res, 500, 'server_error', 'Server misconfigured.');
  }

  // 4. Payload size check
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (rawBody.length > MAX_PAYLOAD_BYTES) {
    return errorResponse(res, 413, 'payload_too_large', 'Submission payload too large.');
  }

  // 5. Parse & validate
  let payload;
  try {
    const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const validation = validatePayload(parsed);
    if (!validation.ok) {
      return errorResponse(res, 400, 'validation_failed',
        'One or more fields are invalid.', { fields: validation.errors });
    }
    payload = validation.value;
  } catch (err) {
    return errorResponse(res, 400, 'invalid_json', 'Request body must be valid JSON.');
  }

  // 6. Fetch form definition
  let form;
  try {
    form = await fetchForm(payload.formId);
  } catch (err) {
    console.error('[submit] Form fetch error:', err);
    return errorResponse(res, 500, 'server_error', 'Something went wrong. Please try again.');
  }
  if (!form) {
    return errorResponse(res, 404, 'form_not_found', 'Form not found.');
  }
  if (form.fields[FORM_FIELDS.status] !== 'Live') {
    return errorResponse(res, 404, 'form_not_found', 'Form not found.');
  }

  // 7. Origin check
  const allowedOrigins = [
    ...parseAllowedOrigins(form.fields[FORM_FIELDS.allowedOrigins]),
    ...DEMO_ORIGINS.map(s => s.toLowerCase()),
  ];
  const origin = (req.headers.origin || '').toLowerCase();
  if (origin) {
    if (!allowedOrigins.includes(origin)) {
      console.warn('[submit] Origin rejected:', { formId: payload.formId, origin });
      return errorResponse(res, 403, 'origin_not_allowed',
        'This origin is not permitted to submit to this form.');
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  // 8. Honeypot — silent fake-success for bots
  if (payload.honeypot && payload.honeypot.length > 0) {
    console.warn('[submit] Honeypot triggered:', { formId: payload.formId, ip: getIp(req) });
    return res.status(200).json({
      ok: true,
      reference: 'TG-' + new Date().getUTCFullYear() + '-00000',
      submissionId: 'rec0000000000000',
      thankYou: { mode: 'inline', message: 'Thanks — we\'re on it.' },
    });
  }

  // 9. Rate limit using the shared in-memory limiter
  const ip = getIp(req);
  const tier = form.fields[FORM_FIELDS.antiSpamRateLimit] || 'standard';
  const limit = FORM_RATE_LIMITS[tier] || FORM_RATE_LIMITS.standard;
  // applyRateLimit writes 429 to res and returns false if blocked
  if (!applyRateLimit(res, `submit:${payload.formId}:${ip}`, limit)) return;

  // 10. Turnstile verification (if form has it enabled)
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

  // 11. Generate reference + sequential
  const sequential = nextSequential();
  const reference = buildReference(form.fields[FORM_FIELDS.referencePrefix], sequential);

  // 12. Write master record
  const meta = {
    ip,
    userAgent: req.headers['user-agent'] || '',
  };
  let submissionId;
  try {
    submissionId = await writeMasterRecord({ form, payload, meta, sequential, reference });
  } catch (err) {
    console.error('[submit] Master record write failed:', err);
    return errorResponse(res, 500, 'server_error',
      'We could not save your enquiry. Please try again.');
  }

  // 13. Build thank-you response before firing routing (so we can return fast)
  const thankYou = buildThankYouContext({ form, payload, submissionId, reference });

  // 14. Fan out routing. We await this (rather than fire-and-forget) because
  //     Vercel serverless functions are terminated once the response is sent,
  //     which kills any in-flight background promises. Awaiting adds 1-3s to
  //     the response but guarantees routing actually completes. If we ever
  //     migrate to Vercel's Edge runtime we can switch to waitUntil for the
  //     background pattern.
  let routingSummary;
  try {
    routingSummary = await fanOutRouting({ form, payload, submissionId, reference, meta });
  } catch (err) {
    // Routing failures are non-fatal — submission is already saved. Log and
    // continue so the visitor still gets their confirmation.
    console.error('[submit] Routing orchestrator failed:', err);
    routingSummary = { error: err.message };
  }

  // 15. Return success
  return res.status(200).json({
    ok: true,
    reference,
    submissionId,
    thankYou,
  });
}

// =============================================================================
//  ENV VARS REQUIRED
// =============================================================================
//  AIRTABLE_KEY                   — PAT for widget suite base (read forms)
//  AIRTABLE_BASE_ID               — appAYzWZxvK6qlwXK
//  TG_ENQUIRIES_AIRTABLE_PAT      — PAT for enquiries base (write submissions)
//  TG_ENQUIRIES_AIRTABLE_BASE_ID  — appQJYiPZVU5jMAml
//  SENDGRID_API_KEY               — for email routing (email.js, auto-reply.js)
//  SENDGRID_FROM_EMAIL            — noreply@travelify.io
//  SENDGRID_FROM_NAME_FALLBACK    — Travelgenix
//  TG_PAT_ENCRYPTION_KEY          — 64-hex key for encrypted client Airtable PATs
//
//  Optional:
//  TURNSTILE_SECRET_KEY           — required ONLY if any form has Turnstile enabled
//  LUNA_CHAT_JWT_SECRET           — required ONLY if any form has Luna Chat routing
// =============================================================================
