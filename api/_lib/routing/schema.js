// =============================================================================
//  /api/_lib/routing/schema.js
// =============================================================================
//
//  Canonical lead schema validators and widget → lead mappers.
//
//  Every widget's submission endpoint produces a lead in this shape before
//  passing it to the router. The router validates the shape on intake and
//  destination handlers map FROM this shape to their own payloads.
//
//  See /docs/LEAD_SCHEMA.md for the full schema and rationale.
//
// =============================================================================

import { randomBytes } from 'crypto';

// ── Constants ───────────────────────────────────────────────────────────

export const KNOWN_WIDGETS = [
  'popup',
  'enquiry-form',
  'quiz',
  'calculator',
  'booking-confirmation',
];

export const KNOWN_DESTINATIONS = [
  'google-sheets',
  'webhook',
  'email',
  'auto-reply',
  'airtable',
  'mailchimp',
  'brevo',
  'klaviyo',
  'activecampaign',
  'hubspot',
  'luna-marketing',
];

export const KNOWN_BOARD_BASIS = ['RO', 'BB', 'HB', 'FB', 'AI'];

const MAX_STR = 254;
const MAX_NAME = 80;
const MAX_PHONE = 30;
const MAX_TAGS = 20;
const MAX_TAG_LEN = 50;
const MAX_DESTINATIONS_PER_LEAD = 10;
const MAX_CUSTOM_KEYS = 50;
const MAX_CUSTOM_VALUE = 1000;
const MAX_CUSTOM_BYTES = 16 * 1024;

// ── Helpers ─────────────────────────────────────────────────────────────

function stripControl(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

function clampStr(s, max) {
  return stripControl(s).slice(0, max || MAX_STR);
}

function isEmail(s) {
  if (typeof s !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.length <= 254;
}

function isRecId(s) {
  return typeof s === 'string' && /^rec[A-Za-z0-9]{14}$/.test(s);
}

function clampDate(s) {
  // Accept ISO date or datetime; return as ISO string or empty
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  // If it looks like a plain date (YYYY-MM-DD), preserve that form
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return s.trim();
  return d.toISOString();
}

function clampNumber(n, min, max) {
  if (n === null || n === undefined || n === '') return null;
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  if (min !== undefined && num < min) return min;
  if (max !== undefined && num > max) return max;
  return num;
}

function clampArray(arr, maxLen, itemClamp) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, maxLen).map(itemClamp).filter(Boolean);
}

// ── Lead ID generation ──────────────────────────────────────────────────

export function generateLeadId() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const rand = randomBytes(4).toString('hex');
  return `lead_${yyyy}_${mm}_${dd}_${rand}`;
}

// ── Sanitisation ────────────────────────────────────────────────────────

/**
 * Take a partial lead object (probably from a widget) and return a fully
 * shaped, validated, sanitised canonical lead. Throws ValidationError on
 * critical failures (missing email, invalid widget type, etc).
 */
export function buildCanonicalLead(input) {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('Lead payload must be an object');
  }

  const source = input.source || {};
  const contact = input.contact || {};
  const travel = input.travel || {};
  const consent = input.consent || {};

  // ── Validate required ──
  if (!isEmail(contact.email)) {
    throw new ValidationError('Invalid or missing contact.email');
  }
  if (!KNOWN_WIDGETS.includes(source.widget)) {
    throw new ValidationError(`Unknown source.widget: ${source.widget}`);
  }
  if (!isRecId(source.widgetId)) {
    throw new ValidationError('Invalid or missing source.widgetId');
  }
  if (!isEmail(source.clientEmail)) {
    throw new ValidationError('Invalid or missing source.clientEmail');
  }

  // ── Build canonical contact ──
  const firstName = clampStr(contact.firstName, MAX_NAME);
  const lastName = clampStr(contact.lastName, MAX_NAME);
  let fullName = clampStr(contact.fullName, MAX_NAME * 2);
  if (!fullName && (firstName || lastName)) {
    fullName = [firstName, lastName].filter(Boolean).join(' ');
  }

  // ── Custom fields with byte cap ──
  let custom = {};
  if (input.custom && typeof input.custom === 'object' && !Array.isArray(input.custom)) {
    const entries = Object.entries(input.custom).slice(0, MAX_CUSTOM_KEYS);
    for (const [k, v] of entries) {
      const key = clampStr(k, 80);
      if (!key) continue;
      let val = v;
      if (typeof val === 'string') val = clampStr(val, MAX_CUSTOM_VALUE);
      else if (typeof val === 'number' || typeof val === 'boolean') val = val;
      else if (val == null) continue;
      else val = JSON.stringify(val).slice(0, MAX_CUSTOM_VALUE);
      custom[key] = val;
    }
    // Final byte cap
    const json = JSON.stringify(custom);
    if (json.length > MAX_CUSTOM_BYTES) {
      // Truncate by dropping keys until we fit
      const keys = Object.keys(custom);
      while (JSON.stringify(custom).length > MAX_CUSTOM_BYTES && keys.length) {
        delete custom[keys.pop()];
      }
    }
  }

  // ── Build canonical lead ──
  return {
    leadId: clampStr(input.leadId, 60) || generateLeadId(),
    receivedAt: input.receivedAt || new Date().toISOString(),

    source: {
      widget: source.widget,
      widgetId: source.widgetId,
      clientName: clampStr(source.clientName, 200),
      clientEmail: source.clientEmail.toLowerCase().trim(),
      sourceUrl: clampStr(source.sourceUrl, 1000),
      referrer: clampStr(source.referrer, 1000),
      ipAddress: clampStr(source.ipAddress, 60),
      userAgent: clampStr(source.userAgent, 500),
      visitorId: clampStr(source.visitorId, 100),
    },

    contact: {
      email: contact.email.toLowerCase().trim(),
      firstName,
      lastName,
      fullName,
      phone: clampStr(contact.phone, MAX_PHONE),
    },

    travel: {
      destinations: clampArray(travel.destinations, 10, v => clampStr(v, 80)),
      departureAirport: clampStr(travel.departureAirport, 10),
      departDate: clampDate(travel.departDate),
      returnDate: clampDate(travel.returnDate),
      flexibleDates: !!travel.flexibleDates,
      durationNights: clampNumber(travel.durationNights, 0, 365),
      customDuration: clampStr(travel.customDuration, 50),
      adults: clampNumber(travel.adults, 0, 50),
      children: clampNumber(travel.children, 0, 50),
      childAges: clampArray(travel.childAges, 20, v => clampNumber(v, 0, 17)).filter(v => v !== null),
      infants: clampNumber(travel.infants, 0, 20),
      budgetPP: clampNumber(travel.budgetPP, 0, 1000000),
      starRating: clampNumber(travel.starRating, 1, 5),
      boardBasis: KNOWN_BOARD_BASIS.includes(travel.boardBasis) ? travel.boardBasis : '',
      interests: clampArray(travel.interests, 20, v => clampStr(v, 50)),
    },

    consent: {
      contact: !!consent.contact,
      marketing: !!consent.marketing,
      capturedAt: consent.capturedAt || new Date().toISOString(),
      capturedIp: clampStr(consent.capturedIp || source.ipAddress, 60),
    },

    custom,

    tags: clampArray(input.tags, MAX_TAGS, v => clampStr(v, MAX_TAG_LEN)),

    routing: {
      requested: clampArray(
        (input.routing && input.routing.requested) || [],
        MAX_DESTINATIONS_PER_LEAD,
        v => (KNOWN_DESTINATIONS.includes(v) ? v : '')
      ),
      completed: [],
      failed: [],
      submissionRecordId: '',
    },
  };
}

// ── Custom error ────────────────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

// ── Convenience: redact a lead for logging ──────────────────────────────

export function redactLead(lead) {
  if (!lead) return lead;
  return {
    ...lead,
    contact: {
      ...lead.contact,
      email: lead.contact?.email ? lead.contact.email.replace(/^(.).*(@.*)$/, '$1***$2') : '',
      phone: lead.contact?.phone ? lead.contact.phone.slice(0, 3) + '****' : '',
    },
    source: { ...lead.source, ipAddress: lead.source?.ipAddress ? lead.source.ipAddress.slice(0, 6) + '...' : '' },
  };
}
