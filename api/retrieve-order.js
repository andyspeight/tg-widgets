/**
 * Travelgenix Widget Suite — Retrieve Order (public endpoint)
 *
 * Called by embedded My Booking widget. NO auth header — widgets embed on any
 * client site without auth. Security relies on:
 *   1. Rate limiting (per IP and per IP+widget)
 *   2. Generic error messages (no info leakage about which field was wrong)
 *   3. Server-side credential lookup (creds never touch browser)
 *   4. Sanitised response (raw Travelify JSON never returned)
 *
 * Flow:
 *   1. POST { widgetId, emailAddress, departDate, orderRef }
 *   2. Look up widget → ClientEmail
 *   3. Look up active Travelify integration for that client → AppId + encrypted key
 *   4. Decrypt key
 *   5. Call Travelify POST /account/order with Token AppId:Key auth
 *   6. Trim + sanitise response
 *   7. Return safe subset
 *
 * Endpoint:
 *   POST /api/retrieve-order
 *
 * Internal-call bypass (added Apr 2026):
 *   When called from /api/booking-email (server-to-server), the caller sends
 *   X-TG-Internal-Key (matching env var TG_INTERNAL_KEY) plus X-TG-Real-IP
 *   carrying the original user's IP. This lets us rate-limit against the real
 *   user instead of the shared Vercel egress IP, with a higher cap (30/min)
 *   to avoid platform-wide throttling when many users send emails. Public
 *   calls (widget → endpoint directly) keep the original 5/min cap.
 */

import { setCors, sanitiseForFormula } from './_auth.js';
import { decrypt } from './_crypto.js';

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';
const INTEGRATIONS_TABLE = 'tblpzQpwmcTvUeHcF';

// Widgets table fields
const WF = {
  WidgetID: 'fldXkwI3mmSrKeY9N', // typical widget id field — we'll lookup by formula on Name match if needed
  ClientEmail: 'fldppykJf1w4YvFNC',
  WidgetType: null, // resolved by name in formula
  Status: null,
};

// Integrations table fields
const IF = {
  IntegrationID:    'fldIZBDjX5lNJDf1S',
  ClientEmail:      'flditBgdp6egbk3Fb',
  Service:          'fld0TP0kypkfOOJF6',
  AppId:            'fldCXwCixuvqN2HMy',
  ApiKeyEncrypted:  'fldpb4JQRSuot0Gg2',
  Status:           'fldEVMrKnEpFaxORk',
  LastUsedAt:       'fldQgOjcM3sfKL7uB',
};

const TRAVELIFY_API = 'https://api.travelify.io/account/order';

// ----- Demo bypass -----
// When widgetId === DEMO_WIDGET_SENTINEL, skip the Airtable widget lookup and
// instead pull the demo Travelify integration directly from Airtable by record
// ID. The encrypted key is decrypted with the same TG_ENCRYPTION_KEY used by
// real client lookups. This is for the public /demo-mybooking.html standalone
// test page.
//
// SAFETY:
//   - Only triggers on the literal string 'DEMO_WIDGET_ID'. Real widgets use
//     the tgw_{ts}_{rand} format so there is no collision risk.
//   - The pinned record MUST be the Travelify demo App (currently 250) with
//     synthetic bookings only. Never repoint this at a real client's record.
//   - Validation, rate limiting, and response sanitisation still run.
//   - If the record is missing or decryption fails, the path fails closed (notFound).
const DEMO_WIDGET_SENTINEL = 'DEMO_WIDGET_ID';
const DEMO_INTEGRATION_RECORD_ID = 'rec6TnQI0Pz8PyrGs';

// ----- Rate limiting (in-memory, same pattern as _auth.js) -----

const rateLimitStore = new Map(); // key -> { count, resetAt }
const RL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function rateLimit(key, max) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // Cleanup expired entries periodically
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (v.resetAt < now) rateLimitStore.delete(k);
    }
  }

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return { ok: true, remaining: max - 1 };
  }
  if (entry.count >= max) {
    return { ok: false, remaining: 0, retryAfterMs: entry.resetAt - now };
  }
  entry.count++;
  return { ok: true, remaining: max - entry.count };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// ----- Validation -----

function validateEmail(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  // Reasonable email regex — not RFC-5322 perfect but blocks obvious junk
  if (v.length < 5 || v.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

function validateDate(s) {
  if (typeof s !== 'string') return null;
  // Strict yyyy-MM-dd
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  // Sanity bounds: 2020-01-01 to 2050-12-31
  const yr = parseInt(s.slice(0, 4), 10);
  if (yr < 2020 || yr > 2050) return null;
  return s;
}

function validateOrderRef(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toUpperCase();
  // Alphanumeric + dash + underscore, 3–40 chars
  if (!/^[A-Z0-9_\-]{3,40}$/.test(v)) return null;
  return v;
}

function validateWidgetId(s) {
  if (typeof s !== 'string') return null;
  // Widget IDs follow tgw_{ts}_{rand} pattern. Be permissive but bounded.
  if (!/^[a-zA-Z0-9_\-]{8,80}$/.test(s)) return null;
  return s;
}

// ----- Airtable helpers -----

function airtableHeaders() {
  const key = process.env.AIRTABLE_KEY;
  if (!key) throw new Error('AIRTABLE_KEY env var missing');
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function findWidgetById(widgetId) {
  const safe = sanitiseForFormula(widgetId);
  const formula = `{WidgetID}='${safe}'`;
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${WIDGETS_TABLE}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('maxRecords', '1');

  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) throw new Error(`Widget lookup failed: ${res.status}`);
  const data = await res.json();
  return data.records?.[0] || null;
}

async function findActiveTravelifyIntegration(clientEmail) {
  const safeEmail = sanitiseForFormula(clientEmail);
  const formula = `AND({${IF.ClientEmail}}='${safeEmail}',{${IF.Service}}='Travelify',{${IF.Status}}='Active')`;

  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${INTEGRATIONS_TABLE}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('maxRecords', '1');
  url.searchParams.set('returnFieldsByFieldId', 'true');

  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) throw new Error(`Integration lookup failed: ${res.status}`);
  const data = await res.json();
  return data.records?.[0] || null;
}

// Direct fetch by record ID — used only by the demo bypass.
async function getIntegrationById(recordId) {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${INTEGRATIONS_TABLE}/${recordId}`);
  url.searchParams.set('returnFieldsByFieldId', 'true');

  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Integration get-by-id failed: ${res.status}`);
  return await res.json();
}

async function touchLastUsed(recordId) {
  // Fire-and-forget; don't block response on this
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${INTEGRATIONS_TABLE}`;
  const body = JSON.stringify({
    records: [{ id: recordId, fields: { [IF.LastUsedAt]: new Date().toISOString() } }],
  });
  fetch(url, { method: 'PATCH', headers: airtableHeaders(), body }).catch(() => {});
}

// ----- Travelify response sanitisation -----

function safeStr(v, max = 500) {
  if (v == null) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function safeNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function sanitiseHotelDescription(text) {
  if (typeof text !== 'string') return null;
  // Strip HTML tags to be safe; widget will render as text
  return text.replace(/<[^>]*>/g, '').slice(0, 4000);
}

function sanitiseImageUrl(u) {
  if (typeof u !== 'string') return null;
  // Only allow https URLs
  if (!/^https:\/\/[^\s]+$/i.test(u)) return null;
  if (u.length > 500) return null;
  return u;
}

// ----- Per-product trim helpers -----
//
// Travelify orders contain heterogeneous items: Accommodation, Flights,
// AirportExtras (lounges, transfers, parking), plus future product types.
// Each branch below extracts only what the widget needs to render — never
// the raw supplier data, never internal IDs that aren't safe to expose.
// New product types fall through and are returned with just the common
// envelope (id/status/product/price/etc) so they don't break the widget.

function trimAccommodation(d) {
  return {
    name: safeStr(d.name, 200),
    propertyType: safeStr(d.propertyType, 60),
    rating: safeNum(d.rating),
    location: d.location ? {
      address1: safeStr(d.location.address1, 300),
      city: safeStr(d.location.city, 100),
      state: safeStr(d.location.state, 100),
      postalCode: safeStr(d.location.postalCode, 30),
      country: safeStr(d.location.country, 10),
      latitude: safeNum(d.location.latitude),
      longitude: safeNum(d.location.longitude),
    } : null,
    review: d.review ? {
      rating: safeNum(d.review.rating),
      reviews: safeNum(d.review.reviews),
      platform: safeStr(d.review.platform, 30),
    } : null,
    pricing: d.pricing ? {
      currency: safeStr(d.pricing.currency, 10),
      price: safeNum(d.pricing.price),
      memberPrice: safeNum(d.pricing.memberPrice),
      inResortFees: safeNum(d.pricing.inResortFees),
      isRefundable: !!d.pricing.isRefundable,
      refundability: safeStr(d.pricing.refundability, 30),
      // What the headline price is composed of (e.g. "Rate for Room £2073").
      // Surfaced to customers in the payment breakdown.
      breakdown: Array.isArray(d.pricing.breakdown)
        ? d.pricing.breakdown.slice(0, 10).map(b => ({
            type: safeStr(b.type, 30),
            name: safeStr(b.name, 100),
            description: safeStr(b.description, 200),
            unitPrice: safeNum(b.unitPrice),
            qty: safeNum(b.qty),
          }))
        : [],
      // Charges payable at the property (e.g. tourist tax, ecologic fee).
      // Customers MUST see these — they're additional cost, not bundled.
      payAtLocation: Array.isArray(d.pricing.payAtLocation)
        ? d.pricing.payAtLocation.slice(0, 10).map(b => ({
            type: safeStr(b.type, 30),
            name: safeStr(b.name, 100),
            description: safeStr(b.description, 200),
            unitPrice: safeNum(b.unitPrice),
            qty: safeNum(b.qty),
          }))
        : [],
      depositOptions: Array.isArray(d.pricing.depositOptions)
        ? d.pricing.depositOptions.slice(0, 5).map(opt => ({
            id: safeNum(opt.id),
            name: safeStr(opt.name, 60),
            amount: safeNum(opt.amount),
            dueDate: safeStr(opt.dueDate, 30),
            installments: safeNum(opt.installments),
            installmentsAmount: safeNum(opt.installmentsAmount),
            breakdown: Array.isArray(opt.breakdown)
              ? opt.breakdown.slice(0, 12).map(b => ({
                  num: safeNum(b.num),
                  amount: safeNum(b.amount),
                  dueDate: safeStr(b.dueDate, 30),
                }))
              : [],
          }))
        : [],
    } : null,
    descriptions: Array.isArray(d.descriptions)
      ? d.descriptions.slice(0, 30).map(desc => ({
          type: safeStr(desc.type, 40),
          title: safeStr(desc.title, 100),
          text: sanitiseHotelDescription(desc.text),
        })).filter(x => x.text)
      : [],
    amenities: Array.isArray(d.amenities)
      ? d.amenities.slice(0, 30).map(a => safeStr(a, 60)).filter(Boolean)
      : [],
    goodFor: Array.isArray(d.goodFor)
      ? d.goodFor.slice(0, 10).map(g => safeStr(g, 60)).filter(Boolean)
      : [],
    media: Array.isArray(d.media)
      ? d.media.slice(0, 12).map(m => ({
          type: safeStr(m.type, 40),
          url: sanitiseImageUrl(m.url),
          caption: safeStr(m.caption, 200),
        })).filter(m => m.url)
      : [],
    units: Array.isArray(d.units)
      ? d.units.slice(0, 5).map(u => ({
          name: safeStr(u.name, 200),
          roomType: safeStr(u.roomType, 60),
          checkin: safeStr(u.checkin, 30),
          nights: safeNum(u.nights),
          sleeps: safeStr(u.sleeps, 100),
          sleepsAdults: safeNum(u.sleepsAdults),
          sleepsChildren: safeNum(u.sleepsChildren),
          rates: Array.isArray(u.rates)
            ? u.rates.slice(0, 3).map(r => ({
                name: safeStr(r.name, 100),
                board: safeStr(r.board, 40),
                descriptions: Array.isArray(r.descriptions)
                  ? r.descriptions.slice(0, 6).map(rd => ({
                      type: safeStr(rd.type, 40),
                      title: safeStr(rd.title, 100),
                      text: sanitiseHotelDescription(rd.text),
                    })).filter(x => x.text)
                  : [],
              }))
            : [],
        }))
      : [],
    guests: Array.isArray(d.guests)
      ? d.guests.slice(0, 12).map(g => ({
          type: safeStr(g.type, 30),
          title: safeStr(g.title, 30),
          firstname: safeStr(g.firstname, 80),
          surname: safeStr(g.surname, 80),
        }))
      : [],
  };
}

function trimFlightSegment(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    origin: s.origin ? {
      iataCode: safeStr(s.origin.iataCode, 10),
      terminal: safeStr(s.origin.terminal, 20),
      name: safeStr(s.origin.name, 200),
      description: safeStr(s.origin.description, 300),
      country: safeStr(s.origin.country, 10),
    } : null,
    destination: s.destination ? {
      iataCode: safeStr(s.destination.iataCode, 10),
      terminal: safeStr(s.destination.terminal, 20),
      name: safeStr(s.destination.name, 200),
      description: safeStr(s.destination.description, 300),
      country: safeStr(s.destination.country, 10),
    } : null,
    depart: safeStr(s.depart, 30),
    arrive: safeStr(s.arrive, 30),
    duration: safeNum(s.duration),
    cabinClass: safeStr(s.cabinClass, 40),
    fareName: safeStr(s.fareName, 80),
    baggage: s.baggage ? {
      allowance: safeStr(s.baggage.allowance, 200),
      weight: safeStr(s.baggage.weight, 40),
    } : null,
    operatingCarrier: s.operatingCarrier ? {
      code: safeStr(s.operatingCarrier.code, 10),
      name: safeStr(s.operatingCarrier.name, 100),
    } : null,
    marketingCarrier: s.marketingCarrier ? {
      code: safeStr(s.marketingCarrier.code, 10),
      name: safeStr(s.marketingCarrier.name, 100),
    } : null,
    flightNo: safeStr(s.flightNo, 20),
    aircraft: safeStr(s.aircraft, 20),
    touchdowns: safeNum(s.touchdowns),
  };
}

function trimFlights(d) {
  return {
    fareType: safeStr(d.fareType, 40),
    openJaw: !!d.openJaw,
    seatsAvailable: safeNum(d.seatsAvailable),
    pricing: d.pricing ? {
      currency: safeStr(d.pricing.currency, 10),
      price: safeNum(d.pricing.price),
      memberPrice: safeNum(d.pricing.memberPrice),
      refundability: safeStr(d.pricing.refundability, 30),
    } : null,
    routes: Array.isArray(d.routes)
      ? d.routes.slice(0, 4).map(r => ({
          legID: safeNum(r.legID),
          direction: safeStr(r.direction, 30),
          duration: safeNum(r.duration),
          segments: Array.isArray(r.segments)
            ? r.segments.slice(0, 6).map(trimFlightSegment).filter(Boolean)
            : [],
        }))
      : [],
    fareInformation: Array.isArray(d.fareInformation)
      ? d.fareInformation.slice(0, 10).map(f => ({
          type: safeStr(f.type, 40),
          title: safeStr(f.title, 100),
          text: safeStr(f.text, 1000),
        })).filter(f => f.text)
      : [],
    travellers: Array.isArray(d.travellers)
      ? d.travellers.slice(0, 12).map(t => ({
          type: safeStr(t.type, 30),
          title: safeStr(t.title, 30),
          firstname: safeStr(t.firstname, 80),
          surname: safeStr(t.surname, 80),
        }))
      : [],
  };
}

function trimAirportExtras(d) {
  return {
    type: safeStr(d.type, 40),
    name: safeStr(d.name, 200),
    subTitle: safeStr(d.subTitle, 200),
    startDateTime: safeStr(d.startDateTime, 30),
    endDateTime: safeStr(d.endDateTime, 30),
    location: d.location ? {
      iataCode: safeStr(d.location.iataCode, 10),
      terminal: safeStr(d.location.terminal, 20),
      onAirport: !!d.location.onAirport,
      country: safeStr(d.location.country, 10),
    } : null,
    descriptions: Array.isArray(d.descriptions)
      ? d.descriptions.slice(0, 12).map(desc => ({
          type: safeStr(desc.type, 40),
          title: safeStr(desc.title, 100),
          text: sanitiseHotelDescription(desc.text),
        })).filter(x => x.text)
      : [],
    features: Array.isArray(d.features)
      ? d.features.slice(0, 20).map(f => safeStr(f, 60)).filter(Boolean)
      : [],
    media: Array.isArray(d.media)
      ? d.media.slice(0, 8).map(m => ({
          type: safeStr(m.type, 40),
          url: sanitiseImageUrl(m.url),
        })).filter(m => m.url)
      : [],
    pricing: d.pricing ? {
      currency: safeStr(d.pricing.currency, 10),
      price: safeNum(d.pricing.price),
      memberPrice: safeNum(d.pricing.memberPrice),
      refundability: safeStr(d.pricing.refundability, 30),
    } : null,
    travellers: Array.isArray(d.travellers)
      ? d.travellers.slice(0, 12).map(t => ({
          type: safeStr(t.type, 30),
          title: safeStr(t.title, 30),
          firstname: safeStr(t.firstname, 80),
          surname: safeStr(t.surname, 80),
        }))
      : [],
  };
}

function trimItem(item) {
  if (!item || typeof item !== 'object') return null;
  const out = {
    id: safeNum(item.id),
    status: safeStr(item.status, 30),
    product: safeStr(item.product, 30),
    bookingReference: safeStr(item.bookingReference, 100),
    price: safeNum(item.price),
    currency: safeStr(item.originalCurrency, 10),
    startDate: safeStr(item.startDate, 30),
    duration: safeNum(item.duration),
  };

  // Per-product extraction. Each branch is isolated so a malformed item
  // of one product doesn't break the others.
  if (item.product === 'Accommodation' && item.dataObject) {
    out.accommodation = trimAccommodation(item.dataObject);
  } else if (item.product === 'Flights' && item.dataObject) {
    out.flights = trimFlights(item.dataObject);
  } else if (item.product === 'AirportExtras' && item.dataObject) {
    out.airportExtras = trimAirportExtras(item.dataObject);
  }
  // Other product types (Insurance, CarRental, etc) fall through with the
  // common envelope only — widget will skip rendering them gracefully.

  return out;
}


function trimOrder(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const items = Array.isArray(raw.items)
    ? raw.items.slice(0, 8).map(trimItem).filter(Boolean)
    : [];

  // Compute a summary derived from the items. The widget uses these to
  // render the trip header, the countdown, and the totals row without
  // having to re-walk the items array on the front end.
  const summary = computeSummary(items);

  return {
    id: safeNum(raw.id),
    status: safeStr(raw.status, 30),
    customerTitle: safeStr(raw.customerTitle, 30),
    customerFirstname: safeStr(raw.customerFirstname, 80),
    customerSurname: safeStr(raw.customerSurname, 80),
    customerEmail: safeStr(raw.customerEmail, 254),
    specialRequests: safeStr(raw.specialRequests, 1000),
    currency: safeStr(raw.currency, 10),
    created: safeStr(raw.created, 30),
    items,
    summary,
    documents: Array.isArray(raw.documents)
      ? raw.documents.slice(0, 20).map(doc => ({
          name: safeStr(doc.name, 200),
          ext: safeStr(doc.ext, 10),
          size: safeNum(doc.size),
          url: sanitiseImageUrl(doc.url), // same https-only check works
          created: safeStr(doc.created, 30),
        })).filter(d => d.url)
      : [],
  };
}

// Aggregate per-item info into a single object the widget can read directly.
// All fields are nullable so the widget can render gracefully when an order
// has only some of the product types.
function computeSummary(items) {
  const summary = {
    totalPrice: 0,
    hasAccommodation: false,
    hasFlights: false,
    hasAirportExtras: false,
    accommodationItems: 0,
    flightItems: 0,
    airportExtrasItems: 0,
    earliestStart: null,
    latestEnd: null,
    travellers: [],
  };

  // Aggregate prices and product mix.
  for (const item of items) {
    if (typeof item.price === 'number') summary.totalPrice += item.price;

    if (item.product === 'Accommodation') {
      summary.hasAccommodation = true;
      summary.accommodationItems++;
    } else if (item.product === 'Flights') {
      summary.hasFlights = true;
      summary.flightItems++;
    } else if (item.product === 'AirportExtras') {
      summary.hasAirportExtras = true;
      summary.airportExtrasItems++;
    }

    // Track earliest start across ALL items. For trips with flights, the
    // outbound flight is typically earlier than hotel check-in (think a
    // night-flight + next-morning check-in scenario), so this is the date
    // the customer actually starts travelling.
    if (item.startDate) {
      const ts = Date.parse(item.startDate);
      if (Number.isFinite(ts)) {
        if (!summary.earliestStart || ts < Date.parse(summary.earliestStart)) {
          summary.earliestStart = item.startDate;
        }
      }
    }
  }

  // Round to 2dp to avoid floating-point noise in JSON.
  summary.totalPrice = Math.round(summary.totalPrice * 100) / 100;
  if (summary.totalPrice === 0) summary.totalPrice = null;

  // Aggregate unique travellers across all items. People appear in the
  // accommodation 'guests' array AND the flights 'travellers' AND the
  // extras 'travellers' — usually overlapping but not always (e.g. only
  // the lead guest is on a single-guest lounge booking).
  const seen = new Set();
  for (const item of items) {
    const list =
      item.accommodation?.guests ||
      item.flights?.travellers ||
      item.airportExtras?.travellers ||
      [];
    for (const t of list) {
      const key = `${(t.title || '').toLowerCase()}|${(t.firstname || '').toLowerCase()}|${(t.surname || '').toLowerCase()}`;
      if (!seen.has(key) && (t.firstname || t.surname)) {
        seen.add(key);
        summary.travellers.push(t);
      }
    }
  }

  return summary;
}

// ----- Generic error response (no info leak) -----

function notFound(res) {
  return res.status(404).json({
    error: 'not_found',
    message: "We couldn't find a confirmed booking with those details.",
  });
}

// ----- HTTP handler -----

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Internal-call detection. /api/booking-email calls this endpoint server-
  // to-server. Without bypass logic, every email send across the platform
  // would hit this rate limit against the Vercel egress IP — capping the
  // entire feature at 5 emails per 15 minutes. Internal calls get a higher
  // cap (30) and rate limit against the forwarded user IP.
  const isInternalCall = !!process.env.TG_INTERNAL_KEY
    && req.headers['x-tg-internal-key'] === process.env.TG_INTERNAL_KEY;

  const ip = isInternalCall && typeof req.headers['x-tg-real-ip'] === 'string'
    ? req.headers['x-tg-real-ip']
    : getClientIp(req);

  const ipLimit = rateLimit(`ro:ip:${ip}`, isInternalCall ? 30 : 5);
  if (!ipLimit.ok) {
    return res.status(429).json({
      error: 'too_many_attempts',
      message: 'Too many lookup attempts. Please wait 15 minutes and try again.',
      retryAfterMs: ipLimit.retryAfterMs,
    });
  }

  // Parse body
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return notFound(res);
  }

  // Validate inputs
  const widgetId = validateWidgetId(body.widgetId);
  const emailAddress = validateEmail(body.emailAddress);
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);

  if (!widgetId || !emailAddress || !departDate || !orderRef) {
    // Generic — don't tell the attacker which field was bad
    return notFound(res);
  }

  // Per-IP+widget rate limit
  const widgetLimit = rateLimit(`ro:ipw:${ip}:${widgetId}`, 30);
  if (!widgetLimit.ok) {
    return res.status(429).json({
      error: 'too_many_attempts',
      message: 'Too many lookup attempts for this booking widget. Please try again later.',
      retryAfterMs: widgetLimit.retryAfterMs,
    });
  }

  try {
    let appId;
    let apiKey;
    let integrationId = null; // for LastUsedAt update; null on demo path

    if (widgetId === DEMO_WIDGET_SENTINEL) {
      // ----- Demo path -----
      // Pull the pinned demo Travelify integration record directly. Encrypted
      // key is decrypted with the same TG_ENCRYPTION_KEY used for real clients.
      const integration = await getIntegrationById(DEMO_INTEGRATION_RECORD_ID);
      if (!integration) {
        console.warn('Demo integration record not found:', DEMO_INTEGRATION_RECORD_ID);
        return notFound(res);
      }

      const demoAppId = integration.fields?.[IF.AppId];
      const demoApiKeyEncrypted = integration.fields?.[IF.ApiKeyEncrypted];
      if (!demoAppId || !demoApiKeyEncrypted) {
        console.warn('Demo integration record missing AppId or encrypted key');
        return notFound(res);
      }

      try {
        apiKey = decrypt(demoApiKeyEncrypted);
      } catch (e) {
        console.error('Demo key decryption failed:', e.message);
        return notFound(res);
      }
      appId = demoAppId;
      // Don't set integrationId — we don't want to update LastUsedAt for the
      // demo record on every public test.

      // TEMP DEBUG: log what we're about to send to Travelify
      console.log('[DEMO DEBUG] About to call Travelify with:', {
        appId: String(appId),
        keyLength: typeof apiKey === 'string' ? apiKey.length : 0,
        keyPreview: typeof apiKey === 'string' ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : 'invalid',
        emailAddress,
        departDate,
        orderRef,
      });
    } else {
      // ----- Real client path -----
      // 1. Find widget → owning client
      const widget = await findWidgetById(widgetId);
      if (!widget) return notFound(res);

      const widgetType = widget.fields?.WidgetType;
      if (widgetType !== 'My Booking') return notFound(res);

      const widgetStatus = widget.fields?.Status;
      if (widgetStatus && widgetStatus !== 'Active' && widgetStatus !== 'Draft') {
        return notFound(res);
      }

      const clientEmail = (widget.fields?.ClientEmail || '').toLowerCase().trim();
      if (!clientEmail) return notFound(res);

      // 2. Find active Travelify integration for this client
      const integration = await findActiveTravelifyIntegration(clientEmail);
      if (!integration) {
        console.warn(`No active Travelify integration for client (widgetId=${widgetId})`);
        return notFound(res);
      }

      const integrationAppId = integration.fields?.[IF.AppId];
      const apiKeyEncrypted = integration.fields?.[IF.ApiKeyEncrypted];
      if (!integrationAppId || !apiKeyEncrypted) return notFound(res);

      // 3. Decrypt
      try {
        apiKey = decrypt(apiKeyEncrypted);
      } catch (e) {
        console.error('Decryption failed for integration', integration.id, ':', e.message);
        return notFound(res);
      }
      appId = integrationAppId;
      integrationId = integration.id;
    }

    // 4. Call Travelify
    // The Travelify API requires an Origin header. From a browser, this is set
    // automatically; from a server-to-server call (Node fetch from Vercel) it
    // is not, and the API silently returns 401 "Missing or invalid application
    // credentials" — making it look like the auth is wrong when it's actually
    // the missing Origin. Sending our own product origin satisfies the gate.
    const travelifyRes = await fetch(TRAVELIFY_API, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${appId}:${apiKey}`,
        'Content-Type': 'application/json',
        'Origin': 'https://www.travelgenix.io',
      },
      body: JSON.stringify({
        emailAddress,
        departDate,
        orderRef,
      }),
      // Hard timeout via AbortController
      signal: AbortSignal.timeout(12000),
    });

    // Capture body as text first so we can log it on the demo path even on
    // non-200 responses.
    const rawText = await travelifyRes.text();
    const isDemo = widgetId === DEMO_WIDGET_SENTINEL;

    if (isDemo) {
      console.log('[DEMO DEBUG] Travelify response:', {
        status: travelifyRes.status,
        statusText: travelifyRes.statusText,
        contentType: travelifyRes.headers.get('content-type'),
        bodyPreview: rawText.slice(0, 1500),
      });
    }

    if (travelifyRes.status === 404) {
      return notFound(res);
    }
    if (!travelifyRes.ok) {
      console.error(`Travelify returned ${travelifyRes.status} for widget ${widgetId}`);
      return notFound(res);
    }

    let raw;
    try {
      raw = JSON.parse(rawText);
    } catch {
      return notFound(res);
    }

    // Travelify's documented 404 shape is { code: '404', message: ... }
    if (raw && (raw.code === '404' || raw.code === 404)) {
      return notFound(res);
    }

    // 5. Trim + sanitise
    const order = trimOrder(raw);
    if (!order || !order.id) return notFound(res);

    // 6. Async update LastUsedAt (skipped on demo path — no integration record)
    if (integrationId) touchLastUsed(integrationId);

    return res.status(200).json({ order });
  } catch (err) {
    console.error('retrieve-order error:', err.message);
    return notFound(res);
  }
}
