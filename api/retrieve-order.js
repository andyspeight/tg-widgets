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

import { setCors, sanitiseForFormula, lookupClientCredentialsByEmail, lookupClientCredentialsByRecordId } from './_auth.js';

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';

// Widgets table fields
const WF = {
  WidgetID: 'fldXkwI3mmSrKeY9N', // typical widget id field — we'll lookup by formula on Name match if needed
  ClientEmail: 'fldppykJf1w4YvFNC',
  WidgetType: null, // resolved by name in formula
  Status: null,
};

const TRAVELIFY_API = 'https://api.travelify.io/account/order';

// ----- Demo bypass -----
// When widgetId === DEMO_WIDGET_SENTINEL, skip the Airtable widget lookup and
// use the published Travelgenix demo Travelify credentials (App 250).
//
// SAFETY:
//   - Only triggers on the literal string 'DEMO_WIDGET_ID'. Real widgets use
//     the tgw_{ts}_{rand} format so there is no collision risk.
//   - Demo credentials are published in Travelify's own docs as the demo
//     account so it's safe to ship them in source.
//   - Validation, rate limiting, and response sanitisation still run.
const DEMO_WIDGET_SENTINEL = 'DEMO_WIDGET_ID';
const DEMO_APP_ID = '250';
const DEMO_PUBLIC_KEY = 'A41D180E-CBFE-4E30-A47D-FAAB424A650D';

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

// ----- User → Client resolver -----
//
// Widgets store ClientEmail = the email of the USER who created the widget
// (Luke, Sarah, whoever). But Travelify credentials live on the parent
// CLIENT record (the agency — "Travel Demo Tes Ltd"), not the user record.
// One Travelify account is shared across all users in a client workspace.
//
// This function takes a user email and walks the user→client link to find
// the parent client's canonical email. lookupClientCredentialsByEmail can
// then resolve THAT to the Travelify creds on the Clients table.
//
// Returns the client email (lowercased) on success, null if:
//   - no user matches the email
//   - user has no linked client (legacy/broken record)
//   - linked client record can't be fetched
//
// This is a single extra Airtable read (~80ms) per booking lookup. The
// alternative — denormalising the client email onto every widget at save
// time — would be faster but couples widget-config to admin reorganisations,
// so we eat the lookup cost here.
const USERS_TABLE = 'tblIpeQeZmF7CM7OJ'; // matches USERS.tableId in _lib/auth/schema.js
const CLIENTS_TABLE = 'tblikekpaTKraMktZ'; // matches CLIENTS.tableId
const UF_email  = 'fldSQLKBfsAcVS2s3'; // USERS.fields.email — id used for fields[] read
const UF_client = 'fldyXVZjZKUjlYCm6'; // USERS.fields.client — linked to Clients
const CF_email  = 'fldVRiIAlrTjxnNHP'; // CLIENTS.fields.email — id used for fields[] read

// filterByFormula REQUIRES field names, not field IDs (Airtable API limitation).
// These names must stay in sync with the field renames in the corresponding
// table; the field IDs above are immune to renames but only usable in fields[].
const UF_email_NAME = 'Email';
const CF_email_NAME = 'Email';

async function resolveUserToClientEmail(userEmail) {
  if (!userEmail) return null;
  const safe = sanitiseForFormula(userEmail.toLowerCase());

  // 1. Find the user by email
  const userUrl = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${USERS_TABLE}`);
  userUrl.searchParams.set('filterByFormula', `LOWER({${UF_email_NAME}})='${safe}'`);
  userUrl.searchParams.set('maxRecords', '1');
  // Request response keyed by field ID rather than field name — gives us
  // stability across field renames. Without this, rec.fields would be keyed
  // by display name and lookups via field ID return undefined.
  userUrl.searchParams.set('returnFieldsByFieldId', 'true');
  userUrl.searchParams.append('fields[]', UF_client);
  userUrl.searchParams.append('fields[]', UF_email);

  const userRes = await fetch(userUrl.toString(), { headers: airtableHeaders() });
  if (!userRes.ok) {
    throw new Error(`User lookup failed: ${userRes.status}`);
  }
  const userData = await userRes.json();
  const user = userData.records?.[0];
  if (!user) return null;

  const clientLinks = user.fields?.[UF_client];
  const clientId = Array.isArray(clientLinks) ? clientLinks[0] : null;
  if (!clientId) return null;

  // 2. Fetch that client record to get its canonical email
  const clientUrl = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}/${clientId}`);
  clientUrl.searchParams.set('returnFieldsByFieldId', 'true');
  const clientRes = await fetch(clientUrl.toString(), { headers: airtableHeaders() });
  if (!clientRes.ok) {
    throw new Error(`Client lookup failed: ${clientRes.status}`);
  }
  const clientRec = await clientRes.json();
  const clientEmail = clientRec.fields?.[CF_email];
  if (!clientEmail || typeof clientEmail !== 'string') return null;
  return clientEmail.toLowerCase().trim();
}

// ----- Legacy fallback: direct Clients table lookup -----
//
// Pre-May 2026, widgets were created when the auth model was single-user-per-
// company — what's now the Clients table was called Users, and a widget's
// ClientEmail field held the client's primary contact email directly. After
// the May refactor that split Users and Clients, those widgets still point at
// what is now a Clients.Email value rather than a Users.Email value.
//
// resolveUserToClientEmail() returns null for these legacy widgets (no
// matching User record). This fallback tries the Clients table directly so
// the booking flow still works. Returns the lowercased email if found, null
// if no client matches.
async function findClientEmailDirect(possibleClientEmail) {
  if (!possibleClientEmail) return null;
  const safe = sanitiseForFormula(possibleClientEmail.toLowerCase());

  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}`);
  url.searchParams.set('filterByFormula', `LOWER({${CF_email_NAME}})='${safe}'`);
  url.searchParams.set('maxRecords', '1');
  // Request response keyed by field ID — without this, Airtable keys
  // fields by display name and our field-ID lookups return undefined.
  url.searchParams.set('returnFieldsByFieldId', 'true');
  url.searchParams.append('fields[]', CF_email);

  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) {
    throw new Error(`Client direct lookup failed: ${res.status}`);
  }
  const data = await res.json();
  const rec = data.records?.[0];
  if (!rec) return null;

  const email = rec.fields?.[CF_email];
  if (!email || typeof email !== 'string') return null;
  return email.toLowerCase().trim();
}

// ----- Combined resolver -----
//
// Maps a widget's stored ClientEmail (which historically meant different
// things — sometimes a user email, sometimes a client email) onto a canonical
// client email we can look up Travelify credentials against.
//
// Order of attempts:
//   1. Treat as user email → walk user→client link → return client's email
//      (the post-May 2026 multi-user-per-company model)
//   2. Treat as client email directly → match against Clients.Email
//      (the pre-May 2026 single-user-per-company legacy model)
//
// Returns null only if neither path matches anything, in which case the
// widget's ClientEmail is genuinely orphaned (deleted user, typo, etc.).
async function resolveWidgetEmailToClientEmail(widgetClientEmail) {
  // Try the new model first — it's the common case for widgets created
  // after the May 2026 refactor.
  const viaUser = await resolveUserToClientEmail(widgetClientEmail);
  if (viaUser) return viaUser;

  // Fall back to the legacy direct-match path.
  return await findClientEmailDirect(widgetClientEmail);
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

// Trim a pickup/dropoff location point. Shared between Transfers and
// CarRental, both of which use the same shape (dateTime, name, address,
// lat/long, optional iataCode/onAirport for airport locations).
function trimLocationPoint(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    dateTime: safeStr(p.dateTime, 30),
    name: safeStr(p.name, 200),
    address1: safeStr(p.address1, 200),
    iataCode: safeStr(p.iataCode, 10),
    onAirport: !!p.onAirport,
    country: safeStr(p.country, 10),
    latitude: safeNum(p.latitude),
    longitude: safeNum(p.longitude),
  };
}

// Transfers — airport/private transfer products (Hoppa, Holiday Taxis, etc).
// Travelify's "Transfers" product is distinct from AirportExtras with
// type=Transfer; the dataObject shape is different.
function trimTransfers(d) {
  return {
    type: safeStr(d.type, 40),                    // 'Private', 'Shared', etc
    vehicle: safeStr(d.vehicle, 100),             // 'Private Car', 'Minibus', etc
    company: safeStr(d.company, 120),             // Operator (e.g. 'Elife (EUR)')
    journeyDistance: safeStr(d.journeyDistance, 30),
    journeyDuration: safeStr(d.journeyDuration, 30),
    numberUnits: safeNum(d.numberUnits),
    minOccupancy: safeNum(d.minOccupancy),
    maxOccupancy: safeNum(d.maxOccupancy),
    smallBagAllowance: safeNum(d.smallBagAllowance),
    bigBagAllowance: safeNum(d.bigBagAllowance),
    // outPickup/outDropoff are mandatory. returnPickup/returnDropoff exist
    // only on return-journey bookings — leave null otherwise.
    outPickup: trimLocationPoint(d.outPickup),
    outDropoff: trimLocationPoint(d.outDropoff),
    returnPickup: trimLocationPoint(d.returnPickup),
    returnDropoff: trimLocationPoint(d.returnDropoff),
    information: Array.isArray(d.information)
      ? d.information.slice(0, 8).map(i => ({
          type: safeStr(i.type, 40),
          title: safeStr(i.title, 100),
          text: sanitiseHotelDescription(i.text),
        })).filter(x => x.text)
      : [],
    media: Array.isArray(d.media)
      ? d.media.slice(0, 4).map(m => ({
          type: safeStr(m.type, 40),
          url: sanitiseImageUrl(m.url),
          caption: safeStr(m.caption, 200),
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

// Car Rental (Travelify product = "CarRental"). Surfaces vehicle specs,
// pickup/dropoff, inclusions from the booked package, and important info
// like fuel/mileage/insurance policies.
function trimCarRental(d) {
  // The selected package's pricing carries pay-at-location extras the
  // customer should be warned about. Take from package[0] (the booked
  // package) rather than scanning all packages. Falls back to top-level
  // pricing.payAtLocation if the supplier put it there instead.
  const pkg = Array.isArray(d.packages) && d.packages[0] ? d.packages[0] : null;
  const pkgPricing = pkg?.pricing || null;
  const payAtLocation = Array.isArray(pkgPricing?.payAtLocation)
    ? pkgPricing.payAtLocation
    : (Array.isArray(d.pricing?.payAtLocation) ? d.pricing.payAtLocation : []);
  return {
    name: safeStr(d.name, 200),                     // 'Seat Ibiza'
    classCode: safeStr(d.classCode, 60),            // 'Economy'
    className: safeStr(d.className, 60),
    transmission: safeStr(d.transmission, 30),      // 'Manual', 'Automatic'
    fuelType: safeStr(d.fuelType, 30),
    doors: safeNum(d.doors),
    seats: safeNum(d.seats),
    luggageLarge: safeNum(d.luggageLarge),
    luggageSmall: safeNum(d.luggageSmall),
    oneWay: !!d.oneWay,
    rentalOperator: d.rentalOperator ? {
      code: safeStr(d.rentalOperator.code, 30),
      name: safeStr(d.rentalOperator.name, 120),    // 'KEDDY', 'Europcar' etc
    } : null,
    pickup: trimLocationPoint(d.pickup),
    dropoff: trimLocationPoint(d.dropoff),
    // Inclusions from the booked package — short codes like 'FreeCancellation',
    // 'UnlimitedMileage' that the widget can render as ticks.
    inclusions: Array.isArray(pkg?.inclusions)
      ? pkg.inclusions.slice(0, 20).map(i => safeStr(i, 60)).filter(Boolean)
      : [],
    // Free-text policies (fuel, mileage, deposit, driver req, etc).
    // information[] is the broadest source — keep all of it (capped).
    information: Array.isArray(d.information)
      ? d.information.slice(0, 12).map(i => ({
          type: safeStr(i.type, 40),
          title: safeStr(i.title, 120),
          text: sanitiseHotelDescription(i.text),
        })).filter(x => x.text)
      : [],
    // Cancellation/included-text from the package descriptions array.
    descriptions: Array.isArray(pkg?.descriptions)
      ? pkg.descriptions.slice(0, 6).map(desc => ({
          type: safeStr(desc.type, 40),
          title: safeStr(desc.title, 100),
          text: sanitiseHotelDescription(desc.text),
        })).filter(x => x.text)
      : [],
    media: Array.isArray(d.media)
      ? d.media.slice(0, 4).map(m => ({
          type: safeStr(m.type, 40),
          url: sanitiseImageUrl(m.url),
          caption: safeStr(m.caption, 200),
        })).filter(m => m.url)
      : [],
    // Pay-at-location fees (booster seats, child seats, etc) — same shape
    // as accommodation's payAtLocation. The widget already has rendering
    // for this so we map to the existing field names.
    payAtLocation: payAtLocation.slice(0, 12).map(line => ({
      name: safeStr(line.name, 120),
      description: safeStr(line.description, 500),
      unitPrice: safeNum(line.unitPrice),
      qty: safeNum(line.qty),
    })).filter(l => l.name || l.description),
    pricing: d.pricing ? {
      currency: safeStr(d.pricing.currency, 10),
      price: safeNum(d.pricing.price),
      memberPrice: safeNum(d.pricing.memberPrice),
      refundability: safeStr(d.pricing.refundability, 30),
    } : null,
    // CarRental has a single driver, not a travellers array. Normalise
    // to a one-element travellers array so the widget's traveller
    // aggregation logic doesn't need a special case.
    travellers: d.driver ? [{
      type: safeStr(d.driver.type, 30),
      title: safeStr(d.driver.title, 30),
      firstname: safeStr(d.driver.firstname, 80),
      surname: safeStr(d.driver.surname, 80),
      isDriver: true,
    }] : [],
  };
}

// Tickets & Attractions (Travelify product = "TicketsAttractions").
// Covers museum entries, tours, attraction tickets, event tickets etc.
function trimTicketsAttractions(d) {
  // Select the booked option/date if obvious. Travelify usually returns
  // a single option with a single dateOption for confirmed bookings —
  // multiple imply un-booked inventory that shouldn't really reach the
  // customer-facing widget. Take [0] in both cases.
  const opt = Array.isArray(d.options) && d.options[0] ? d.options[0] : null;
  const dateOpt = Array.isArray(opt?.dateOptions) && opt.dateOptions[0] ? opt.dateOptions[0] : null;
  const subOpt = Array.isArray(opt?.subOptions) && opt.subOptions[0] ? opt.subOptions[0] : null;
  return {
    name: safeStr(d.name, 200),                     // 'Classic Desert Safari with...'
    ticketType: safeStr(d.ticketType, 60),          // 'Tours', 'Attraction Ticket', etc
    minDuration: safeNum(d.minDuration),            // Minutes
    maxDuration: safeNum(d.maxDuration),
    reviewCount: safeNum(d.reviewCount),
    reviewAvg: safeNum(d.reviewAvg),
    location: d.location ? {
      city: safeStr(d.location.city, 100),
      country: safeStr(d.location.country, 10),
      address1: safeStr(d.location.address1, 200),
      latitude: safeNum(d.location.latitude),
      longitude: safeNum(d.location.longitude),
    } : null,
    categories: Array.isArray(d.categories)
      ? d.categories.slice(0, 8).map(c => safeStr(c, 60)).filter(Boolean)
      : [],
    features: Array.isArray(d.features)
      ? d.features.slice(0, 20).map(f => safeStr(f, 60)).filter(Boolean)
      : [],
    // Selected experience option (e.g. 'Shared tour on Tuesday, October 13')
    selectedOption: opt ? {
      name: safeStr(opt.name, 200),
      type: safeStr(opt.type, 60),
      // Bookable date+time from the chosen dateOption. Customer-facing.
      scheduledDateTime: safeStr(dateOpt?.date, 30),
      scheduledLabel: safeStr(dateOpt?.label, 200),
      // Sub-option = ticket type (Adult/Child/Family/etc). One per booking.
      subOption: subOpt ? {
        name: safeStr(subOpt.name, 120),
        type: safeStr(subOpt.type, 60),
        travellerType: safeStr(subOpt.travellerType, 30),
      } : null,
    } : null,
    descriptions: Array.isArray(d.descriptions)
      ? d.descriptions.slice(0, 10).map(desc => ({
          type: safeStr(desc.type, 40),
          title: safeStr(desc.title, 100),
          text: sanitiseHotelDescription(desc.text),
        })).filter(x => x.text)
      : [],
    media: Array.isArray(d.media)
      ? d.media.slice(0, 6).map(m => ({
          type: safeStr(m.type, 40),
          url: sanitiseImageUrl(m.url),
          caption: safeStr(m.caption, 200),
        })).filter(m => m.url)
      : [],
    pricing: d.pricing ? {
      currency: safeStr(d.pricing.currency, 10),
      price: safeNum(d.pricing.price),
      memberPrice: safeNum(d.pricing.memberPrice),
      refundability: safeStr(d.pricing.refundability, 30),
    } : null,
    guests: Array.isArray(d.guests)
      ? d.guests.slice(0, 20).map(g => ({
          type: safeStr(g.type, 30),
          title: safeStr(g.title, 30),
          firstname: safeStr(g.firstname, 80),
          surname: safeStr(g.surname, 80),
        }))
      : [],
  };
}

// Packages (Travelify product = "Packages") = ATOL-protected holiday packages
// (Jet2 Holidays, EveryHoliday, TUI, etc).
//
// A Packages dataObject is the union of an Accommodation dataObject and a
// Flights dataObject — same field names for the hotel parts (name, rating,
// propertyType, amenities, location, descriptions, units, pricing) and same
// 'routes' array as Flights. Plus a top-level 'operator' field naming the
// tour operator whose ATOL the package is sold under (this is required
// disclosure for ATOL packages — Jet2 Holidays, TUI, etc. must be named).
//
// Strategy: split the package into two virtual sub-objects on the trimmed
// item — item.accommodation and item.flights — produced by calling the
// existing trim functions. That way the widget/email/PDF rendering code
// already in place for separate Accommodation + Flights items just works:
// the customer sees the hotel hero, room details, then flight cards
// underneath, exactly as they would for an unbundled hotel+flights booking.
//
// The 'operator' field is exposed separately on the trimmed item so the
// front-end can render the ATOL operator badge ("Holiday operated by
// EveryHoliday — ATOL Protected").
function trimPackages(d) {
  return {
    accommodation: trimAccommodation(d),
    flights: trimFlights(d),
    // Tour operator who holds the ATOL licence for this package. Customer-
    // facing — required disclosure on any ATOL-protected sale.
    operator: d.operator ? {
      code: safeStr(d.operator.code, 30),
      name: safeStr(d.operator.name, 120),
      message: safeStr(d.operator.message, 300),
    } : null,
    // ATOL protection is the headline trust signal. Boolean here for
    // straightforward use on the front-end; logic: protected if the
    // package's inclusions list contains 'ATOLProtection'.
    atolProtected: Array.isArray(d.inclusions)
      ? d.inclusions.some(i => /^ATOLProtection$/i.test(i))
      : false,
    // Package-level inclusions ('ATOLProtection', 'Baggage', 'Transfers' if
    // bundled). The widget renders these as tick chips.
    inclusions: Array.isArray(d.inclusions)
      ? d.inclusions.slice(0, 15).map(i => safeStr(i, 60)).filter(Boolean)
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
  } else if (item.product === 'Transfers' && item.dataObject) {
    out.transfers = trimTransfers(item.dataObject);
  } else if (item.product === 'CarRental' && item.dataObject) {
    out.carRental = trimCarRental(item.dataObject);
  } else if (item.product === 'TicketsAttractions' && item.dataObject) {
    out.ticketsAttractions = trimTicketsAttractions(item.dataObject);
  } else if (item.product === 'Packages' && item.dataObject) {
    // Packages are composite: expose accommodation + flights directly on
    // the item so all existing consumers (widget, email, PDF) Just Work
    // without needing to know about the Packages product type. Operator
    // info and ATOL flag travel alongside on item.package for the badge.
    const pkg = trimPackages(item.dataObject);
    out.accommodation = pkg.accommodation;
    out.flights = pkg.flights;
    out.package = {
      operator: pkg.operator,
      atolProtected: pkg.atolProtected,
      inclusions: pkg.inclusions,
    };
  }
  // Other product types (Insurance, etc) fall through with the
  // common envelope only. Widget renders a generic "Booked" card for those
  // so the price isn't orphaned.

  return out;
}


function computePaidToDate(raw) {
  const ps = Array.isArray(raw.payments) ? raw.payments : [];
  const sum = ps
    .filter(p => p && String(p.status || '').toLowerCase() === 'success')
    .reduce((s, p) => s + (typeof p.amount === 'number' ? p.amount : 0), 0);
  return Math.round(sum * 100) / 100;
}

// The order-level payment schedule (singular `depositOption`). Its `breakdown`
// is the set of payments STILL OUTSTANDING — the already-taken deposit is
// `initialAmount` (and reflected in `payments`), not in the breakdown. Returns
// null when there's nothing left to pay.
function trimDepositOption(opt) {
  if (!opt || typeof opt !== 'object') return null;
  const breakdown = Array.isArray(opt.breakdown)
    ? opt.breakdown.slice(0, 24).map(b => ({
        num: safeNum(b.num),
        amount: safeNum(b.amount),
        dueDate: safeStr(b.dueDate, 30),
      })).filter(b => typeof b.amount === 'number' && b.amount > 0)
    : [];
  if (!breakdown.length) return null;
  return {
    initialAmount: safeNum(opt.initialAmount),
    currency: safeStr(opt.currency, 10),
    breakdown,
  };
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

  // Order-level voucher / promo. Travelify carries the discount at the TOP
  // level (NOT in item prices) as a signed voucherValue — negative means money
  // off. Surface it so the widget/PDF/email can show it as a deduction line and
  // net it off the balance. Only surfaced when it actually reduces the total.
  const voucherValue = (typeof raw.voucherValue === 'number' && raw.voucherValue < 0)
    ? Math.round(raw.voucherValue * 100) / 100
    : 0;
  const voucher = voucherValue ? {
    code: safeStr(raw.voucherCode, 60),
    name: safeStr(raw.voucherName, 120),
    value: voucherValue,
  } : null;

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
    voucher,
    // Order-level payment state (where balance/instalments actually live).
    paidToDate: computePaidToDate(raw),
    depositOption: trimDepositOption(raw.depositOption),
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
    hasTransfers: false,
    hasCarRental: false,
    hasTicketsAttractions: false,
    hasPackages: false,
    accommodationItems: 0,
    flightItems: 0,
    airportExtrasItems: 0,
    transfersItems: 0,
    carRentalItems: 0,
    ticketsAttractionsItems: 0,
    packagesItems: 0,
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
    } else if (item.product === 'Transfers') {
      summary.hasTransfers = true;
      summary.transfersItems++;
    } else if (item.product === 'CarRental') {
      summary.hasCarRental = true;
      summary.carRentalItems++;
    } else if (item.product === 'TicketsAttractions') {
      summary.hasTicketsAttractions = true;
      summary.ticketsAttractionsItems++;
    } else if (item.product === 'Packages') {
      // Packages bundle hotel + flights. Track them as Packages for the
      // badge/total-label logic, but also mark hasAccommodation/hasFlights
      // so the rest of the rendering pipeline picks up the bundled hotel
      // and flight detail without needing special-case awareness.
      summary.hasPackages = true;
      summary.packagesItems++;
      summary.hasAccommodation = true;
      summary.hasFlights = true;
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
  // accommodation 'guests' array, flights/extras 'travellers', tickets
  // 'guests', transfers 'travellers', and car rental's normalised
  // driver-as-traveller. Usually overlapping but not always.
  const seen = new Set();
  for (const item of items) {
    const list =
      item.accommodation?.guests ||
      item.flights?.travellers ||
      item.airportExtras?.travellers ||
      item.transfers?.travellers ||
      item.carRental?.travellers ||
      item.ticketsAttractions?.guests ||
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

  // Per-IP cap. The lookup is gated on three secrets (email + departure date
  // + booking reference), so this is an abuse backstop rather than the primary
  // control — 5/15min blocked normal use (e.g. look up → pay balance → return
  // → look up again, plus any retries). 20/15min still stops a script.
  const ipLimit = rateLimit(`ro:ip:${ip}`, isInternalCall ? 30 : 20);
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

    if (widgetId === DEMO_WIDGET_SENTINEL) {
      // ----- Demo path -----
      // Use the hardcoded Travelgenix demo credentials (App 250). These are
      // published in the Travelify docs as the demo account so it's safe to
      // ship them. Same fallback as /api/offers.
      appId = DEMO_APP_ID;
      apiKey = DEMO_PUBLIC_KEY;

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

      const ownerRecordId = (widget.fields?.ClientRecordId || '').trim();
      const clientEmail = (widget.fields?.ClientEmail || '').toLowerCase().trim();
      if (!ownerRecordId && !clientEmail) return notFound(res);

      // Resolve the OWNING CLIENT's Travelify credentials.
      //
      // Primary path: the widget records the Airtable record ID of the client
      // that owns it (ClientRecordId), captured at save from the authenticated
      // session. This is unambiguous and correct even when a staff member who
      // belongs to several clients created the widget. It deliberately runs
      // BEFORE the email path, because the email path (resolveWidgetEmailTo
      // ClientEmail → resolveUserToClientEmail) walks the user→client link and
      // takes the FIRST linked client, which picks the wrong account for
      // multi-client staff.
      //
      // Fallback path: legacy widgets with no ClientRecordId keep the existing
      // email-based resolution (user→client link, then direct Clients match),
      // so nothing existing breaks.
      let creds;
      try {
        if (ownerRecordId) {
          creds = await lookupClientCredentialsByRecordId(ownerRecordId);
        }
        if (!creds && clientEmail) {
          // Legacy resolution: map the widget's stored email (user or client)
          // onto a canonical client email, then look up credentials.
          const resolvedClientEmail = await resolveWidgetEmailToClientEmail(clientEmail);
          if (!resolvedClientEmail) {
            console.warn(`No parent client found for widget ClientEmail ${clientEmail} (widgetId=${widgetId}). Neither a user nor a client record matched.`);
            return notFound(res);
          }
          creds = await lookupClientCredentialsByEmail(resolvedClientEmail);
          if (!creds) {
            console.warn(`No Travelify credentials on Clients record for ${resolvedClientEmail} (user=${clientEmail}, widgetId=${widgetId})`);
            return notFound(res);
          }
        }
      } catch (err) {
        console.error('[retrieve-order] credential resolution failed for',
          ownerRecordId || clientEmail, '—', err.message);
        return notFound(res);
      }
      if (!creds) {
        console.warn(`[retrieve-order] No Travelify credentials resolved for widgetId=${widgetId} ` +
          `(ownerRecordId=${ownerRecordId || 'none'}, clientEmail=${clientEmail || 'none'})`);
        return notFound(res);
      }

      appId = creds.appId;
      apiKey = creds.apiKey;
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

    // ─── TEMP DIAGNOSTIC — remove after capture ──────────────────────────
    // The My Booking widget isn't surfacing post-booking Extras (order
    // ET90582: a "TRANSFERS / Private Return Taxi" extra added AFTER the
    // original booking). The mapper only reads raw.items[]; we suspect
    // order-level extras live in a field it never looks at. We can't reach
    // Travelify from the dev environment (egress policy), so dump the raw
    // order's STRUCTURE for that one order to find where the extras live.
    // Structure + non-PII product fields only: participant names / DOBs are
    // redacted, and it is scoped to a single orderRef so nothing else logs.
    if (orderRef === 'ET90582') {
      try {
        const PII = /firstname|surname|forename|fullname|lastname|middlename|dob|dateofbirth|birth|email|phone|mobile|passport|nationalid|address/i;
        const describe = (v, depth) => {
          if (v === null || v === undefined) return null;
          if (Array.isArray(v)) return { __len: v.length, __sample: (v.length && depth < 5) ? describe(v[0], depth + 1) : undefined };
          if (typeof v === 'object') {
            const o = {};
            for (const k of Object.keys(v).slice(0, 40)) {
              if (PII.test(k)) { o[k] = '<redacted>'; continue; }
              const val = v[k];
              if (val && typeof val === 'object') o[k] = depth < 5 ? describe(val, depth + 1) : '[obj]';
              else if (typeof val === 'string') o[k] = val.length > 80 ? val.slice(0, 80) + '…' : val;
              else o[k] = val;
            }
            return o;
          }
          return typeof v;
        };
        // Keys the mapper already handles — anything else is a candidate home
        // for the missing extras.
        const KNOWN = new Set(['id', 'status', 'customerTitle', 'customerFirstname', 'customerSurname', 'customerEmail', 'customerPhone', 'customerMobile', 'specialRequests', 'currency', 'created', 'items', 'payments', 'documents', 'depositOption', 'voucherValue', 'voucherCode', 'voucherName', 'key', 'orderKey']);
        const unknown = {};
        for (const k of Object.keys(raw)) { if (!KNOWN.has(k)) unknown[k] = describe(raw[k], 0); }
        // The extras arrived as an item with product 'Extras' the mapper does
        // not handle. Describe that item's dataObject in full (PII-safe) so we
        // can write the trim/render against the real field names.
        const extrasItem = (raw.items || []).find((it) => it && it.product === 'Extras');
        console.log('[EXTRAS DEBUG ET90582]', JSON.stringify({
          topLevelKeys: Object.keys(raw),
          rawItemsCount: Array.isArray(raw.items) ? raw.items.length : 0,
          itemsProducts: (raw.items || []).map((it) => it && it.product),
          extrasItemEnvelope: extrasItem ? describe({ ...extrasItem, dataObject: undefined }, 0) : null,
          extrasItemDataObject: extrasItem ? describe(extrasItem.dataObject, 0) : null,
        }));
      } catch (e) {
        console.log('[EXTRAS DEBUG ET90582] dump failed:', e.message);
      }
    }
    // ─── END TEMP DIAGNOSTIC ─────────────────────────────────────────────

    // 5. Trim + sanitise
    const order = trimOrder(raw);
    if (!order || !order.id) return notFound(res);

    return res.status(200).json({ order });
  } catch (err) {
    console.error('retrieve-order error:', err.message);
    return notFound(res);
  }
}
