// =============================================================================
//  /api/enquiry/_lib/routing/luna-work.js
// =============================================================================
//
//  Sends the submission to the agent's Luna Work CRM as a qualified enquiry.
//
//  Luna Work is the Travelgenix travel CRM (https://crm.travelify.io). Its
//  ingest endpoint — POST /api/widget/lead — has no login (a widget can't hold
//  one), so it authenticates PER AGENCY:
//
//    X-Travelgenix-Key        the agency's public lead_ingest_key (wlk_…). Names
//                             which agency the lead belongs to. Held on the form.
//    X-Travelgenix-Signature  t={unix},v1={hex-hmac} — HMAC-SHA256 over
//                             `${timestamp}.${rawBody}` with the agency's
//                             lead_ingest_secret. Proves the body and blocks
//                             replays (CRM enforces a 5-minute window).
//
//  This is the SAME signature scheme routing/webhook.js uses, so the CRM
//  verifies exactly what we send. The difference is the payload: a generic
//  webhook forwards the raw submission, whereas Luna Work speaks the CRM's
//  enquiry contract, so here we MAP the widget fields onto that contract. The
//  CRM then scores the lead, puts it on its response clock, dedupes it against
//  existing customers and drops it on the timeline — identical to an enquiry an
//  agent typed in by hand.
//
//  Per-form config (Enquiry Forms table):
//    Luna Work Ingest Key     fldG6LfpJb5sA1HkV  (required)
//    Luna Work Ingest Secret  fldNmeld83IwtYlxT  (required)
//    Luna Work Endpoint       fldxdR9nVUqCfzCbg  (optional; defaults to the
//                             hosted CRM, override only for white-label)
//
//  TIMEOUT: 10 seconds, matching the webhook module — the CRM acks fast, and a
//  slow endpoint must not block the rest of the routing fan-out.
//
// =============================================================================

import crypto from 'crypto';

// Form field IDs we read.
const F = {
  ingestKey:    'fldG6LfpJb5sA1HkV',
  ingestSecret: 'fldNmeld83IwtYlxT',
  endpoint:     'fldxdR9nVUqCfzCbg',
  formName:     'fldC0MLSyJqg6U1zT',
  clientName:   'fldrw1eTFYCFIo0pp',
};

const DEFAULT_ENDPOINT = process.env.LUNA_WORK_INGEST_URL || 'https://crm.travelify.io/api/widget/lead';
const TIMEOUT_MS = 10_000;
const USER_AGENT = 'Travelgenix-Widgets/1.0 (luna-work)';
const KEY_RE = /^wlk_[a-z0-9]{8,64}$/i;

// Board basis code → the CRM's free-text board field.
const BOARD_LABEL = {
  RO: 'Room only',
  BB: 'B&B',
  HB: 'Half board',
  FB: 'Full board',
  AI: 'All inclusive',
};

// ---------- Validation ------------------------------------------------------

// The endpoint is configurable, so guard it like the webhook target does:
// HTTPS only, and never an internal/local host (defence in depth against SSRF).
function isValidEndpoint(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^10\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false; // link-local / cloud metadata
    return true;
  } catch {
    return false;
  }
}

// ---------- Field mapping ---------------------------------------------------

/**
 * Map the widget submission onto the CRM's enquiry contract
 * (see travelgenix-crm lib/enquiries/create.ts normaliseEnquiryFields).
 * The CRM clamps and drops anything it doesn't recognise, so this stays
 * forgiving: send what we have, let the CRM be the single source of truth on
 * shape. Anything the contract has no home for is folded into the notes so it
 * still reaches the agent.
 */
function buildLeadBody({ form, payload, reference }) {
  const p = payload.fields || {};
  const dates = p.travel_dates || {};
  const travellers = p.travellers || {};
  const duration = p.duration || {};

  const contactName = [p.first_name, p.last_name]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(' ');

  const destination = Array.isArray(p.destinations)
    ? p.destinations.map((d) => (d && typeof d.name === 'string' ? d.name : '')).filter(Boolean).join(', ')
    : null;

  const departureAirport = Array.isArray(p.departure_airport)
    ? p.departure_airport.filter((a) => typeof a === 'string' && a).join(', ')
    : typeof p.departure_airport === 'string'
      ? p.departure_airport
      : null;

  const childAges = Array.isArray(travellers.childAges) ? travellers.childAges.filter((n) => Number.isFinite(n)) : [];

  // The visitor's own words are the enquiry's original wording (drives the CRM
  // display and any later AI read). Structured extras the contract can't hold —
  // return date, infants, star preference, flights, a custom duration — go on
  // the note so nothing the visitor told us is silently dropped.
  const extras = [];
  if (dates.return) extras.push(`Return date: ${dates.return}`);
  if (Number.isFinite(travellers.infants) && travellers.infants > 0) extras.push(`Infants: ${travellers.infants}`);
  if (Number.isFinite(p.stars)) extras.push(`Preferred rating: ${p.stars} star`);
  if (typeof p.flights_included === 'boolean') extras.push(`Flights ${p.flights_included ? 'included' : 'not included'}`);
  if (!duration.nights && duration.custom) extras.push(`Duration: ${duration.custom}`);
  const source = [form.fields[F.clientName], reference].filter(Boolean).join(' · ');
  if (source) extras.push(`Website enquiry (${source})`);

  const body = {
    // The CRM pins source to "website" itself; sending it is belt and braces.
    source: 'website',
    contact_name: contactName,
    contact_email: typeof p.email === 'string' ? p.email : null,
    contact_phone: typeof p.phone === 'string' ? p.phone : null,
    destination: destination || null,
    depart_date: typeof dates.depart === 'string' ? dates.depart : null,
    date_flexibility: dates.flexible === true ? 'flexible' : dates.depart ? 'fixed' : null,
    duration_nights: Number.isFinite(duration.nights) ? duration.nights : null,
    departure_airport: departureAirport,
    adults: Number.isFinite(travellers.adults) ? travellers.adults : null,
    children: Number.isFinite(travellers.children) ? travellers.children : null,
    child_ages: childAges.length ? childAges.join(', ') : null,
    // The widget collects budget per person; tell the CRM so it scores on the
    // right basis rather than reading it as a total.
    budget: Number.isFinite(p.budget_pp) && p.budget_pp > 0 ? p.budget_pp : null,
    budget_basis: Number.isFinite(p.budget_pp) && p.budget_pp > 0 ? 'per_person' : null,
    board_basis: p.board && BOARD_LABEL[p.board] ? BOARD_LABEL[p.board] : null,
    must_haves: Array.isArray(p.interests) ? p.interests.filter((x) => typeof x === 'string' && x) : [],
    original_wording: typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim() : null,
    notes: extras.length ? extras.join('\n') : null,
  };

  // Marketing consent → the CRM's consent block, recorded on the enquiry.
  // The widget's contact_consent is the required permission-to-reply; the
  // separate marketing_consent is the one that grants ongoing marketing.
  if (p.marketing_consent === true) {
    body.consent = {
      marketing_email: true,
      wording: 'Agreed to receive marketing via the website enquiry form.',
      given_at: new Date().toISOString(),
    };
  }

  return body;
}

// ---------- Signature -------------------------------------------------------

function signBody(rawBody, secret) {
  const t = Math.floor(Date.now() / 1000);
  const hmac = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${hmac}`;
}

// ---------- Public interface ------------------------------------------------

export default async function sendToLunaWork(ctx) {
  const { form, payload, reference } = ctx;

  const key = (form.fields[F.ingestKey] || '').trim();
  const secret = (form.fields[F.ingestSecret] || '').trim();
  const endpoint = (form.fields[F.endpoint] || '').trim() || DEFAULT_ENDPOINT;

  if (!key) {
    return { status: 'failed', error: 'No Luna Work ingest key configured on the form' };
  }
  if (!KEY_RE.test(key)) {
    return { status: 'failed', error: 'Luna Work ingest key is malformed (expected wlk_…)' };
  }
  if (!secret) {
    return { status: 'failed', error: 'Luna Work ingest secret missing — configure it on the form' };
  }
  if (!isValidEndpoint(endpoint)) {
    return { status: 'failed', error: 'Luna Work endpoint invalid or points to a blocked host' };
  }

  // Build and serialise exactly once — the CRM verifies the signature against
  // these same bytes, so we must not re-stringify after signing.
  const rawBody = JSON.stringify(buildLeadBody({ form, payload, reference }));
  const signature = signBody(rawBody, secret);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-Travelgenix-Key': key,
        'X-Travelgenix-Signature': signature,
      },
      body: rawBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[routing/luna-work] Non-2xx:', response.status, errText.slice(0, 300));
      return {
        status: 'failed',
        statusCode: response.status,
        error: `Luna Work returned ${response.status}`,
      };
    }

    return { status: 'ok', statusCode: response.status };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { status: 'failed', error: 'Luna Work timeout after 10 seconds' };
    }
    console.error('[routing/luna-work] Fetch error:', err);
    return { status: 'failed', error: err.message };
  }
}

// Test surface — the pure mapping and validation, drivable without a network.
export const _test = { buildLeadBody, isValidEndpoint, signBody };
