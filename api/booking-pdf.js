/**
 * Travelgenix Widget Suite — Booking PDF (public endpoint)
 *
 * Generates a print-ready A4 PDF of a confirmed booking.
 *
 * Mirrors retrieve-order.js exactly for auth/lookup/Travelify call so the
 * two endpoints behave identically — same env var, same widget+integration
 * resolution, same Origin handling, same DEMO_WIDGET_ID bypass. Differs only
 * in output: this one renders HTML via _pdf-template.js and pipes through
 * Puppeteer to produce a PDF buffer instead of returning JSON.
 *
 * Endpoint:
 *   POST /api/booking-pdf
 *   Body: { widgetId, emailAddress, departDate, orderRef }
 *
 * Response:
 *   200 → application/pdf (binary attachment)
 *   404 → { error: 'not_found' }
 *   429 → { error: 'too_many_attempts' }
 *   5xx → { error: 'server_error' }
 *
 * Vercel function config (vercel.json):
 *   memory: 1024, maxDuration: 30
 *
 * Vercel deps (package.json):
 *   @sparticuz/chromium, puppeteer-core
 */

import { setCors, sanitiseForFormula, lookupClientCredentialsByEmail, lookupClientCredentialsByRecordId } from './_auth.js';
import { renderPdfHtml } from '../public/_pdf-template.js';
import { classifyItem, describeUnclassifiedItem, aggregateTravellers } from './_lib/travelify-items.js';

// ----- Constants (matched 1:1 with retrieve-order.js) -----

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';

const TRAVELIFY_API = 'https://api.travelify.io/account/order';

// ----- Demo bypass (mirrors retrieve-order.js) -----
// When widgetId === DEMO_WIDGET_SENTINEL, skip the Airtable widget lookup
// and use the hardcoded Travelgenix demo credentials (App 250). Same fallback
// as /api/offers and /api/retrieve-order.
const DEMO_WIDGET_SENTINEL = 'DEMO_WIDGET_ID';
const DEMO_APP_ID = '250';
const DEMO_PUBLIC_KEY = 'A41D180E-CBFE-4E30-A47D-FAAB424A650D';

// ----- Puppeteer (lazy-loaded so cold start is cheap on health checks) -----

let _chromium, _puppeteer;
async function getBrowser() {
  if (!_chromium) {
    _chromium = (await import('@sparticuz/chromium')).default;
    _puppeteer = (await import('puppeteer-core')).default;
  }
  return await _puppeteer.launch({
    args: [..._chromium.args, '--font-render-hinting=none'],
    defaultViewport: _chromium.defaultViewport,
    executablePath: await _chromium.executablePath(),
    headless: _chromium.headless,
  });
}

// ----- Rate limiting -----

const rateLimitStore = new Map();
const RL_WINDOW_MS = 15 * 60 * 1000;

function rateLimit(key, max) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore.entries()) if (v.resetAt < now) rateLimitStore.delete(k);
  }
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return { ok: true };
  }
  if (entry.count >= max) return { ok: false, retryAfterMs: entry.resetAt - now };
  entry.count++;
  return { ok: true };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ----- Validation -----

function validateEmail(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  if (v.length < 5 || v.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}
function validateDate(s) {
  if (typeof s !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const yr = parseInt(s.slice(0, 4), 10);
  if (yr < 2020 || yr > 2050) return null;
  return s;
}
function validateOrderRef(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toUpperCase();
  if (!/^[A-Z0-9_\-]{3,40}$/.test(v)) return null;
  return v;
}
function validateWidgetId(s) {
  if (typeof s !== 'string') return null;
  if (!/^[a-zA-Z0-9_\-]{8,80}$/.test(s)) return null;
  return s;
}

// ----- Airtable (identical pattern to retrieve-order.js) -----

function airtableHeaders() {
  const key = process.env.AIRTABLE_KEY;
  if (!key) throw new Error('AIRTABLE_KEY env var missing');
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function findWidgetById(widgetId) {
  const safe = sanitiseForFormula(widgetId);
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${WIDGETS_TABLE}`);
  url.searchParams.set('filterByFormula', `{WidgetID}='${safe}'`);
  url.searchParams.set('maxRecords', '1');
  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) throw new Error(`Widget lookup failed: ${res.status}`);
  const data = await res.json();
  return data.records?.[0] || null;
}

// ----- Trim (mirrors retrieve-order.js shape so template input is identical) -----
// Kept inline rather than imported to avoid coupling the public retrieve
// endpoint's trim function as a stable contract.

const safeStr = (v, max = 500) => v == null ? null : String(v).slice(0, max);
const safeNum = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const sanitiseDesc = (t) => typeof t === 'string' ? t.replace(/<[^>]*>/g, '').slice(0, 4000) : null;
const sanitiseUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) && u.length <= 500) ? u : null;

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
    } : null,
    pricing: d.pricing ? {
      currency: safeStr(d.pricing.currency, 10),
      price: safeNum(d.pricing.price),
      inResortFees: safeNum(d.pricing.inResortFees),
      isRefundable: !!d.pricing.isRefundable,
      refundability: safeStr(d.pricing.refundability, 30),
      breakdown: Array.isArray(d.pricing.breakdown)
        ? d.pricing.breakdown.slice(0, 10).map(b => ({
            type: safeStr(b.type, 30), name: safeStr(b.name, 100),
            description: safeStr(b.description, 200),
            unitPrice: safeNum(b.unitPrice), qty: safeNum(b.qty),
          })) : [],
      payAtLocation: Array.isArray(d.pricing.payAtLocation)
        ? d.pricing.payAtLocation.slice(0, 10).map(b => ({
            type: safeStr(b.type, 30), name: safeStr(b.name, 100),
            description: safeStr(b.description, 200),
            unitPrice: safeNum(b.unitPrice), qty: safeNum(b.qty),
          })) : [],
      depositOptions: Array.isArray(d.pricing.depositOptions)
        ? d.pricing.depositOptions.slice(0, 5).map(opt => ({
            id: safeNum(opt.id), name: safeStr(opt.name, 60),
            amount: safeNum(opt.amount), dueDate: safeStr(opt.dueDate, 30),
            breakdown: Array.isArray(opt.breakdown)
              ? opt.breakdown.slice(0, 12).map(b => ({
                  num: safeNum(b.num), amount: safeNum(b.amount), dueDate: safeStr(b.dueDate, 30),
                })) : [],
          })) : [],
    } : null,
    descriptions: Array.isArray(d.descriptions)
      ? d.descriptions.slice(0, 30).map(desc => ({
          type: safeStr(desc.type, 40), title: safeStr(desc.title, 100),
          text: sanitiseDesc(desc.text),
        })).filter(x => x.text) : [],
    amenities: Array.isArray(d.amenities)
      ? d.amenities.slice(0, 30).map(a => safeStr(a, 60)).filter(Boolean) : [],
    media: Array.isArray(d.media)
      ? d.media.slice(0, 12).map(m => ({
          type: safeStr(m.type, 40), url: sanitiseUrl(m.url), caption: safeStr(m.caption, 200),
        })).filter(m => m.url) : [],
    units: Array.isArray(d.units)
      ? d.units.slice(0, 5).map(u => ({
          name: safeStr(u.name, 200), roomType: safeStr(u.roomType, 60),
          checkin: safeStr(u.checkin, 30), nights: safeNum(u.nights),
          rates: Array.isArray(u.rates)
            ? u.rates.slice(0, 3).map(r => ({
                name: safeStr(r.name, 100), board: safeStr(r.board, 40),
              })) : [],
        })) : [],
    guests: Array.isArray(d.guests)
      ? d.guests.slice(0, 12).map(g => ({
          type: safeStr(g.type, 30), title: safeStr(g.title, 30),
          firstname: safeStr(g.firstname, 80), surname: safeStr(g.surname, 80),
        })) : [],
  };
}

function trimFlightSegment(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    origin: s.origin ? { iataCode: safeStr(s.origin.iataCode, 10), terminal: safeStr(s.origin.terminal, 20), name: safeStr(s.origin.name, 200) } : null,
    destination: s.destination ? { iataCode: safeStr(s.destination.iataCode, 10), terminal: safeStr(s.destination.terminal, 20), name: safeStr(s.destination.name, 200) } : null,
    depart: safeStr(s.depart, 30), arrive: safeStr(s.arrive, 30),
    duration: safeNum(s.duration), cabinClass: safeStr(s.cabinClass, 40), fareName: safeStr(s.fareName, 80),
    baggage: s.baggage ? { allowance: safeStr(s.baggage.allowance, 200), weight: safeStr(s.baggage.weight, 40) } : null,
    marketingCarrier: s.marketingCarrier ? { code: safeStr(s.marketingCarrier.code, 10), name: safeStr(s.marketingCarrier.name, 100) } : null,
    flightNo: safeStr(s.flightNo, 20), aircraft: safeStr(s.aircraft, 20),
  };
}

function trimFlights(d) {
  return {
    fareType: safeStr(d.fareType, 40),
    pricing: d.pricing ? { currency: safeStr(d.pricing.currency, 10), price: safeNum(d.pricing.price) } : null,
    routes: Array.isArray(d.routes)
      ? d.routes.slice(0, 4).map(r => ({
          direction: safeStr(r.direction, 30), duration: safeNum(r.duration),
          segments: Array.isArray(r.segments) ? r.segments.slice(0, 6).map(trimFlightSegment).filter(Boolean) : [],
        })) : [],
    fareInformation: Array.isArray(d.fareInformation)
      ? d.fareInformation.slice(0, 10).map(f => ({
          type: safeStr(f.type, 40), title: safeStr(f.title, 100), text: safeStr(f.text, 1000),
        })).filter(f => f.text) : [],
    travellers: Array.isArray(d.travellers)
      ? d.travellers.slice(0, 12).map(t => ({
          type: safeStr(t.type, 30), title: safeStr(t.title, 30),
          firstname: safeStr(t.firstname, 80), surname: safeStr(t.surname, 80),
        })) : [],
  };
}

function trimAirportExtras(d) {
  return {
    type: safeStr(d.type, 40), name: safeStr(d.name, 200), subTitle: safeStr(d.subTitle, 200),
    startDateTime: safeStr(d.startDateTime, 30), endDateTime: safeStr(d.endDateTime, 30),
    location: d.location ? { iataCode: safeStr(d.location.iataCode, 10), terminal: safeStr(d.location.terminal, 20) } : null,
    descriptions: Array.isArray(d.descriptions)
      ? d.descriptions.slice(0, 12).map(desc => ({
          type: safeStr(desc.type, 40), title: safeStr(desc.title, 100), text: sanitiseDesc(desc.text),
        })).filter(x => x.text) : [],
    pricing: d.pricing ? { currency: safeStr(d.pricing.currency, 10), price: safeNum(d.pricing.price) } : null,
    travellers: Array.isArray(d.travellers)
      ? d.travellers.slice(0, 12).map(t => ({
          type: safeStr(t.type, 30), title: safeStr(t.title, 30),
          firstname: safeStr(t.firstname, 80), surname: safeStr(t.surname, 80),
        })) : [],
  };
}

// Shared between Transfers and CarRental. Same shape: a pickup or dropoff
// point with optional airport metadata.
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

// Transfers (Travelify product = "Transfers") — distinct from AirportExtras
// with type=Transfer; different dataObject shape (Hoppa, Holiday Taxis etc).
function trimTransfers(d) {
  return {
    type: safeStr(d.type, 40),
    vehicle: safeStr(d.vehicle, 100),
    company: safeStr(d.company, 120),
    journeyDistance: safeStr(d.journeyDistance, 30),
    journeyDuration: safeStr(d.journeyDuration, 30),
    numberUnits: safeNum(d.numberUnits),
    minOccupancy: safeNum(d.minOccupancy),
    maxOccupancy: safeNum(d.maxOccupancy),
    smallBagAllowance: safeNum(d.smallBagAllowance),
    bigBagAllowance: safeNum(d.bigBagAllowance),
    outPickup: trimLocationPoint(d.outPickup),
    outDropoff: trimLocationPoint(d.outDropoff),
    returnPickup: trimLocationPoint(d.returnPickup),
    returnDropoff: trimLocationPoint(d.returnDropoff),
    information: Array.isArray(d.information)
      ? d.information.slice(0, 8).map(i => ({
          type: safeStr(i.type, 40), title: safeStr(i.title, 100), text: sanitiseDesc(i.text),
        })).filter(x => x.text) : [],
    media: Array.isArray(d.media)
      ? d.media.slice(0, 4).map(m => ({
          type: safeStr(m.type, 40), url: sanitiseUrl(m.url), caption: safeStr(m.caption, 200),
        })).filter(m => m.url) : [],
    pricing: d.pricing ? {
      currency: safeStr(d.pricing.currency, 10), price: safeNum(d.pricing.price),
      memberPrice: safeNum(d.pricing.memberPrice), refundability: safeStr(d.pricing.refundability, 30),
    } : null,
    travellers: Array.isArray(d.travellers)
      ? d.travellers.slice(0, 12).map(t => ({
          type: safeStr(t.type, 30), title: safeStr(t.title, 30),
          firstname: safeStr(t.firstname, 80), surname: safeStr(t.surname, 80),
        })) : [],
  };
}

// Car Rental (Travelify product = "CarRental"). Vehicle specs + pickup/dropoff
// + inclusions from the booked package + free-text policies.
function trimCarRental(d) {
  const pkg = Array.isArray(d.packages) && d.packages[0] ? d.packages[0] : null;
  const pkgPricing = pkg?.pricing || null;
  const payAtLocation = Array.isArray(pkgPricing?.payAtLocation)
    ? pkgPricing.payAtLocation
    : (Array.isArray(d.pricing?.payAtLocation) ? d.pricing.payAtLocation : []);
  return {
    name: safeStr(d.name, 200),
    classCode: safeStr(d.classCode, 60),
    className: safeStr(d.className, 60),
    transmission: safeStr(d.transmission, 30),
    fuelType: safeStr(d.fuelType, 30),
    doors: safeNum(d.doors),
    seats: safeNum(d.seats),
    luggageLarge: safeNum(d.luggageLarge),
    luggageSmall: safeNum(d.luggageSmall),
    oneWay: !!d.oneWay,
    rentalOperator: d.rentalOperator ? {
      code: safeStr(d.rentalOperator.code, 30),
      name: safeStr(d.rentalOperator.name, 120),
    } : null,
    pickup: trimLocationPoint(d.pickup),
    dropoff: trimLocationPoint(d.dropoff),
    inclusions: Array.isArray(pkg?.inclusions)
      ? pkg.inclusions.slice(0, 20).map(i => safeStr(i, 60)).filter(Boolean) : [],
    information: Array.isArray(d.information)
      ? d.information.slice(0, 12).map(i => ({
          type: safeStr(i.type, 40), title: safeStr(i.title, 120), text: sanitiseDesc(i.text),
        })).filter(x => x.text) : [],
    descriptions: Array.isArray(pkg?.descriptions)
      ? pkg.descriptions.slice(0, 6).map(desc => ({
          type: safeStr(desc.type, 40), title: safeStr(desc.title, 100), text: sanitiseDesc(desc.text),
        })).filter(x => x.text) : [],
    media: Array.isArray(d.media)
      ? d.media.slice(0, 4).map(m => ({
          type: safeStr(m.type, 40), url: sanitiseUrl(m.url), caption: safeStr(m.caption, 200),
        })).filter(m => m.url) : [],
    payAtLocation: payAtLocation.slice(0, 12).map(line => ({
      name: safeStr(line.name, 120), description: safeStr(line.description, 500),
      unitPrice: safeNum(line.unitPrice), qty: safeNum(line.qty),
    })).filter(l => l.name || l.description),
    pricing: d.pricing ? {
      currency: safeStr(d.pricing.currency, 10), price: safeNum(d.pricing.price),
      memberPrice: safeNum(d.pricing.memberPrice), refundability: safeStr(d.pricing.refundability, 30),
    } : null,
    travellers: d.driver ? [{
      type: safeStr(d.driver.type, 30), title: safeStr(d.driver.title, 30),
      firstname: safeStr(d.driver.firstname, 80), surname: safeStr(d.driver.surname, 80),
      isDriver: true,
    }] : [],
  };
}

// Tickets & Attractions (Travelify product = "TicketsAttractions").
function trimTicketsAttractions(d) {
  const opt = Array.isArray(d.options) && d.options[0] ? d.options[0] : null;
  const dateOpt = Array.isArray(opt?.dateOptions) && opt.dateOptions[0] ? opt.dateOptions[0] : null;
  const subOpt = Array.isArray(opt?.subOptions) && opt.subOptions[0] ? opt.subOptions[0] : null;
  return {
    name: safeStr(d.name, 200),
    ticketType: safeStr(d.ticketType, 60),
    minDuration: safeNum(d.minDuration),
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
      ? d.categories.slice(0, 8).map(c => safeStr(c, 60)).filter(Boolean) : [],
    features: Array.isArray(d.features)
      ? d.features.slice(0, 20).map(f => safeStr(f, 60)).filter(Boolean) : [],
    selectedOption: opt ? {
      name: safeStr(opt.name, 200),
      type: safeStr(opt.type, 60),
      scheduledDateTime: safeStr(dateOpt?.date, 30),
      scheduledLabel: safeStr(dateOpt?.label, 200),
      subOption: subOpt ? {
        name: safeStr(subOpt.name, 120),
        type: safeStr(subOpt.type, 60),
        travellerType: safeStr(subOpt.travellerType, 30),
      } : null,
    } : null,
    descriptions: Array.isArray(d.descriptions)
      ? d.descriptions.slice(0, 10).map(desc => ({
          type: safeStr(desc.type, 40), title: safeStr(desc.title, 100), text: sanitiseDesc(desc.text),
        })).filter(x => x.text) : [],
    media: Array.isArray(d.media)
      ? d.media.slice(0, 6).map(m => ({
          type: safeStr(m.type, 40), url: sanitiseUrl(m.url), caption: safeStr(m.caption, 200),
        })).filter(m => m.url) : [],
    pricing: d.pricing ? {
      currency: safeStr(d.pricing.currency, 10), price: safeNum(d.pricing.price),
      memberPrice: safeNum(d.pricing.memberPrice), refundability: safeStr(d.pricing.refundability, 30),
    } : null,
    guests: Array.isArray(d.guests)
      ? d.guests.slice(0, 20).map(g => ({
          type: safeStr(g.type, 30), title: safeStr(g.title, 30),
          firstname: safeStr(g.firstname, 80), surname: safeStr(g.surname, 80),
        })) : [],
  };
}

// Packages (Travelify product = "Packages") = ATOL-protected holiday
// packages (Jet2 Holidays, EveryHoliday, TUI, etc). Composite of hotel +
// flights with an ATOL operator. Splits the package's dataObject into
// virtual accommodation + flights so existing render paths just work.
function trimPackages(d) {
  return {
    accommodation: trimAccommodation(d),
    flights: trimFlights(d),
    operator: d.operator ? {
      code: safeStr(d.operator.code, 30),
      name: safeStr(d.operator.name, 120),
      message: safeStr(d.operator.message, 300),
    } : null,
    atolProtected: Array.isArray(d.inclusions)
      ? d.inclusions.some(i => /^ATOLProtection$/i.test(i))
      : false,
    inclusions: Array.isArray(d.inclusions)
      ? d.inclusions.slice(0, 15).map(i => safeStr(i, 60)).filter(Boolean) : [],
  };
}

// Extras — a distinct Travelify product ("Add Extra Group / Add Extra", often
// added to a booking after it was made). Its dataObject is an ARRAY of groups,
// each holding one or more bookable extras with their own price + participants.
function trimExtras(dataObject) {
  const rawGroups = Array.isArray(dataObject) ? dataObject : [];
  const seen = new Set();
  const travellers = [];
  const groups = rawGroups.slice(0, 20).map((g) => ({
    type: safeStr(g.type, 60), name: safeStr(g.name, 120), description: safeStr(g.description, 500),
    extras: Array.isArray(g.extras) ? g.extras.slice(0, 20).map((e) => {
      const participants = Array.isArray(e.participants) ? e.participants.slice(0, 20).map((p) => ({
        type: safeStr(p.type, 30), title: safeStr(p.title, 30),
        firstname: safeStr(p.firstname, 80), surname: safeStr(p.surname, 80),
      })) : [];
      for (const p of participants) {
        const key = `${(p.title || '').toLowerCase()}|${(p.firstname || '').toLowerCase()}|${(p.surname || '').toLowerCase()}`;
        if (!seen.has(key) && (p.firstname || p.surname)) { seen.add(key); travellers.push(p); }
      }
      return {
        type: safeStr(e.type, 60), name: safeStr(e.name, 200), description: safeStr(e.description, 1000),
        qty: safeNum(e.qtySelected), payAtPickup: !!e.isPayAtPickup,
        pricing: e.pricing ? { currency: safeStr(e.pricing.currency, 10), price: safeNum(e.pricing.price), refundability: safeStr(e.pricing.refundability, 30) } : null,
        participants,
      };
    }) : [],
  }));
  return { groups, travellers };
}

function trimItem(item) {
  if (!item || typeof item !== 'object') return null;
  // Resolve the product type and normalise the detail payload robustly —
  // unwraps a JSON-string dataObject, tries alternate keys, maps label
  // variants, and sniffs the shape as a last resort. Mirrors
  // /api/retrieve-order so the PDF matches the widget. See
  // api/_lib/travelify-items.js.
  const { productType, dataObject, resolvedBy } = classifyItem(item);
  const out = {
    id: safeNum(item.id), status: safeStr(item.status, 30),
    product: productType || safeStr(item.product, 30),
    bookingReference: safeStr(item.bookingReference, 100), price: safeNum(item.price),
    currency: safeStr(item.originalCurrency, 10), startDate: safeStr(item.startDate, 30),
    duration: safeNum(item.duration),
  };
  if (productType === 'Accommodation' && dataObject) {
    out.accommodation = trimAccommodation(dataObject);
  } else if (productType === 'Flights' && dataObject) {
    out.flights = trimFlights(dataObject);
  } else if (productType === 'AirportExtras' && dataObject) {
    out.airportExtras = trimAirportExtras(dataObject);
  } else if (productType === 'Transfers' && dataObject) {
    out.transfers = trimTransfers(dataObject);
  } else if (productType === 'CarRental' && dataObject) {
    out.carRental = trimCarRental(dataObject);
  } else if (productType === 'TicketsAttractions' && dataObject) {
    out.ticketsAttractions = trimTicketsAttractions(dataObject);
  } else if (productType === 'Packages' && dataObject) {
    // Packages are composite: expose accommodation + flights directly on
    // the item so all existing rendering Just Works. Operator info and
    // ATOL flag travel alongside on item.package for the hero badge.
    const pkg = trimPackages(dataObject);
    out.accommodation = pkg.accommodation;
    out.flights = pkg.flights;
    out.package = {
      operator: pkg.operator,
      atolProtected: pkg.atolProtected,
      inclusions: pkg.inclusions,
    };
  } else if (productType === 'Extras' && dataObject) {
    out.extras = trimExtras(dataObject);
  } else {
    console.warn('[booking-pdf] unclassified order item', describeUnclassifiedItem(item));
  }
  // Mark shape-sniffed items so trimOrder can keep genuine matches ahead of
  // them (stripped before rendering). Mirrors /api/retrieve-order.
  if (resolvedBy === 'sniff') out.__sniffed = true;
  return out;
}

function computeSummary(items) {
  const summary = {
    totalPrice: 0,
    hasAccommodation: false, hasFlights: false, hasAirportExtras: false,
    hasTransfers: false, hasCarRental: false, hasTicketsAttractions: false, hasPackages: false,
    hasExtras: false,
    earliestStart: null, travellers: [],
  };
  for (const item of items) {
    if (typeof item.price === 'number') summary.totalPrice += item.price;
    if (item.product === 'Accommodation') summary.hasAccommodation = true;
    else if (item.product === 'Flights') summary.hasFlights = true;
    else if (item.product === 'AirportExtras') summary.hasAirportExtras = true;
    else if (item.product === 'Transfers') summary.hasTransfers = true;
    else if (item.product === 'CarRental') summary.hasCarRental = true;
    else if (item.product === 'TicketsAttractions') summary.hasTicketsAttractions = true;
    else if (item.product === 'Extras') summary.hasExtras = true;
    else if (item.product === 'Packages') {
      // Packages bundle hotel + flights — set both flags so downstream
      // consumers treat the booking as a holiday with flights.
      summary.hasPackages = true;
      summary.hasAccommodation = true;
      summary.hasFlights = true;
    }
    if (item.startDate) {
      const ts = Date.parse(item.startDate);
      if (Number.isFinite(ts) && (!summary.earliestStart || ts < Date.parse(summary.earliestStart))) {
        summary.earliestStart = item.startDate;
      }
    }
  }
  summary.totalPrice = Math.round(summary.totalPrice * 100) / 100;
  if (summary.totalPrice === 0) summary.totalPrice = null;
  summary.travellers = aggregateTravellers(items);
  return summary;
}

function trimOrder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const items = Array.isArray(raw.items) ? raw.items.slice(0, 8).map(trimItem).filter(Boolean) : [];
  // Keep genuine (exact/alias) product matches ahead of shape-sniffed ones so
  // a mystery item can't displace the real hotel/flight in items.find().
  // Stable; sniffed items were previously dropped so this is strictly additive.
  items.sort((a, b) => (a.__sniffed ? 1 : 0) - (b.__sniffed ? 1 : 0));
  for (const it of items) delete it.__sniffed;
  const paidToDate = (() => {
    const ps = Array.isArray(raw.payments) ? raw.payments : [];
    const sum = ps.filter(p => p && String(p.status || '').toLowerCase() === 'success')
      .reduce((s, p) => s + (typeof p.amount === 'number' ? p.amount : 0), 0);
    return Math.round(sum * 100) / 100;
  })();
  const depositOption = (() => {
    const opt = raw.depositOption;
    if (!opt || typeof opt !== 'object') return null;
    const breakdown = Array.isArray(opt.breakdown)
      ? opt.breakdown.slice(0, 24).map(b => ({ num: safeNum(b.num), amount: safeNum(b.amount), dueDate: safeStr(b.dueDate, 30) }))
          .filter(b => typeof b.amount === 'number' && b.amount > 0)
      : [];
    if (!breakdown.length) return null;
    return { initialAmount: safeNum(opt.initialAmount), currency: safeStr(opt.currency, 10), breakdown };
  })();
  return {
    id: safeNum(raw.id), status: safeStr(raw.status, 30),
    customerTitle: safeStr(raw.customerTitle, 30),
    customerFirstname: safeStr(raw.customerFirstname, 80),
    customerSurname: safeStr(raw.customerSurname, 80),
    customerEmail: safeStr(raw.customerEmail, 254),
    specialRequests: safeStr(raw.specialRequests, 1000),
    currency: safeStr(raw.currency, 10), created: safeStr(raw.created, 30),
    items, summary: computeSummary(items),
    paidToDate, depositOption,
  };
}

// ----- Errors -----

function notFound(res) {
  return res.status(404).json({ error: 'not_found', message: "We couldn't find a confirmed booking with those details." });
}

// ----- Handler -----

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Internal-call detection. /api/booking-email calls this endpoint server-to-
  // server to get the PDF for an outgoing email. Those calls come from the
  // Vercel function's egress IP — if we rate-limited by that IP, every email
  // user across the platform would share a tiny bucket. Instead, when the
  // shared secret header matches, we trust the X-TG-Real-IP header for rate
  // limiting and apply a higher per-IP cap (the email endpoint already
  // rate-limits the user, so this is just a backstop).
  const isInternalCall = !!process.env.TG_INTERNAL_KEY
    && req.headers['x-tg-internal-key'] === process.env.TG_INTERNAL_KEY;

  const realIp = isInternalCall && typeof req.headers['x-tg-real-ip'] === 'string'
    ? req.headers['x-tg-real-ip']
    : getClientIp(req);

  const ipLimit = rateLimit(`pdf:ip:${realIp}`, isInternalCall ? 30 : 5);
  if (!ipLimit.ok) {
    return res.status(429).json({ error: 'too_many_attempts', retryAfterMs: ipLimit.retryAfterMs });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return notFound(res);
  }

  const widgetId = validateWidgetId(body.widgetId);
  const emailAddress = validateEmail(body.emailAddress);
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);

  if (!widgetId || !emailAddress || !departDate || !orderRef) return notFound(res);

  const widgetLimit = rateLimit(`pdf:ipw:${realIp}:${widgetId}`, 30);
  if (!widgetLimit.ok) {
    return res.status(429).json({ error: 'too_many_attempts', retryAfterMs: widgetLimit.retryAfterMs });
  }

  let browser;
  try {
    let appId;
    let apiKey;

    if (widgetId === DEMO_WIDGET_SENTINEL) {
      // ----- Demo path -----
      // Use the hardcoded Travelgenix demo credentials (App 250).
      appId = DEMO_APP_ID;
      apiKey = DEMO_PUBLIC_KEY;

      console.log('[PDF DEMO DEBUG] About to call Travelify with:', {
        appId: String(appId),
        keyLength: typeof apiKey === 'string' ? apiKey.length : 0,
        keyPreview: typeof apiKey === 'string' ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : 'invalid',
        emailAddress, departDate, orderRef,
      });
    } else {
      // ----- Real client path -----
      const widget = await findWidgetById(widgetId);
      if (!widget) return notFound(res);

      const widgetType = widget.fields?.WidgetType;
      if (widgetType !== 'My Booking') return notFound(res);

      const widgetStatus = widget.fields?.Status;
      if (widgetStatus && widgetStatus !== 'Active' && widgetStatus !== 'Draft') return notFound(res);

      const ownerRecordId = (widget.fields?.ClientRecordId || '').trim();
      const clientEmail = (widget.fields?.ClientEmail || '').toLowerCase().trim();
      if (!ownerRecordId && !clientEmail) return notFound(res);

      // Resolve the OWNING CLIENT's Travelify credentials.
      //
      // Primary path: the widget records the Airtable record ID of the client
      // that owns it (ClientRecordId), captured at save time from the
      // authenticated session. Resolve directly from that client — unambiguous,
      // and correct even when the widget was created by a staff member who
      // belongs to several client accounts (resolving by their email would
      // otherwise pick the wrong account via the user→client link).
      //
      // Fallback path: legacy widgets with no ClientRecordId resolve by
      // ClientEmail as before, so nothing existing breaks.
      let creds;
      try {
        if (ownerRecordId) {
          creds = await lookupClientCredentialsByRecordId(ownerRecordId);
        }
        if (!creds && clientEmail) {
          creds = await lookupClientCredentialsByEmail(clientEmail);
        }
      } catch (err) {
        console.error('[booking-pdf] credential lookup failed for',
          ownerRecordId || clientEmail, '—', err.message);
        return notFound(res);
      }
      if (!creds) {
        console.warn(`[booking-pdf] No Travelify credentials resolved for widgetId=${widgetId} ` +
          `(ownerRecordId=${ownerRecordId || 'none'}, clientEmail=${clientEmail || 'none'})`);
        return notFound(res);
      }

      appId = creds.appId;
      apiKey = creds.apiKey;
    }

    // Travelify requires the Origin header (without it returns a misleading 401).
    const travelifyRes = await fetch(TRAVELIFY_API, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${appId}:${apiKey}`,
        'Content-Type': 'application/json',
        'Origin': 'https://www.travelgenix.io',
      },
      body: JSON.stringify({ emailAddress, departDate, orderRef }),
      signal: AbortSignal.timeout(12000),
    });

    // Capture body as text first so we can log it on the demo path even on
    // non-200 responses.
    const rawText = await travelifyRes.text();
    const isDemo = widgetId === DEMO_WIDGET_SENTINEL;

    if (isDemo) {
      console.log('[PDF DEMO DEBUG] Travelify response:', {
        status: travelifyRes.status,
        statusText: travelifyRes.statusText,
        contentType: travelifyRes.headers.get('content-type'),
        bodyPreview: rawText.slice(0, 1500),
      });
    }

    if (travelifyRes.status === 404) return notFound(res);
    if (!travelifyRes.ok) {
      console.error(`PDF: Travelify ${travelifyRes.status} for widget ${widgetId}`);
      return notFound(res);
    }

    let raw;
    try { raw = JSON.parse(rawText); } catch { return notFound(res); }
    if (raw && (raw.code === '404' || raw.code === 404)) return notFound(res);

    const order = trimOrder(raw);
    if (!order || !order.id) return notFound(res);

    // Pull brand/contact/styling from the widget record. Two sources:
    //   - Settings JSON (existing — colours, radius, support contact, brand name)
    //   - Top-level fields (FromName, LogoUrl, EmailFooter — added Apr 2026
    //     for the email-send feature; used here too so the PDF logo matches
    //     the email logo).
    // Skip on demo path since there's no widget record — use defaults.
    let widgetSettings = {};
    let pdfBrandName = '';
    let pdfLogoUrl = '';
    if (widgetId !== DEMO_WIDGET_SENTINEL) {
      const widget = await findWidgetById(widgetId);
      // The widget's brand config (colours, radius, support, brand name) lives
      // in the `Config` field — that's what the editor saves and what the live
      // widget reads. (`Settings` is a legacy field the widget never writes, so
      // reading it left the PDF on Travelgenix defaults.) Fall back to Settings
      // for any old record that still carries it.
      const s = widget?.fields?.Config || widget?.fields?.Settings;
      if (s) {
        if (typeof s === 'object') widgetSettings = s;
        else { try { widgetSettings = JSON.parse(s); } catch { widgetSettings = {}; } }
      }
      const fields = widget?.fields || {};
      pdfBrandName = (fields.FromName || '').toString().trim()
        || widgetSettings?.brand?.name
        || (fields.ClientName || '').toString().trim()
        || '';
      const logoUrl = (fields.LogoUrl || '').toString().trim();
      // Only accept HTTPS — Puppeteer will refuse mixed content and a typo'd
      // URL renders as a broken-image placeholder in the PDF.
      pdfLogoUrl = (logoUrl && /^https:\/\//i.test(logoUrl)) ? logoUrl : '';
    }

    const html = renderPdfHtml(order, {
      brandName: pdfBrandName,
      logoUrl: pdfLogoUrl,
      supportEmail: widgetSettings?.support?.email || null,
      supportPhone: widgetSettings?.support?.phone || null,
      colors: widgetSettings?.colors || {},
      radius: typeof widgetSettings?.radius === 'number' ? widgetSettings.radius : 12,
      // Widget display toggles (e.g. display.showCancellation) so the PDF
      // honours the same show/hide choices as the on-page widget.
      display: (widgetSettings && typeof widgetSettings.display === 'object' && widgetSettings.display) || {},
      // The customer-typed orderRef is the final fallback when no supplier
      // bookingReference exists on any item. Without it, the template
      // displays the internal numeric order.id, which the customer has
      // never seen and doesn't match their confirmation paperwork.
      orderRef,
    });

    browser = await getBrowser();
    const page = await browser.newPage();
    // Emulate print media so @media print rules fire and break-inside / 
    // page-break-inside CSS is honoured. Without this, Chromium treats 
    // the document as on-screen and ignores print-only break rules — which 
    // causes sections to flow across page boundaries instead of moving 
    // cleanly to the next page.
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfRaw = await page.pdf({
      format: 'A4', printBackground: true,
      preferCSSPageSize: true,
    });
    await browser.close();
    browser = null;

    // Coerce to a Node Buffer. Puppeteer's page.pdf() may return a Uint8Array
    // depending on version, and res.send() can re-encode anything non-Buffer
    // as UTF-8 text — which silently corrupts PDF binary data and produces a
    // file that opens to "may be damaged".
    const pdfBuffer = Buffer.isBuffer(pdfRaw) ? pdfRaw : Buffer.from(pdfRaw);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `inline; filename="booking-${orderRef}.pdf"`);
    res.status(200);
    return res.end(pdfBuffer);

  } catch (err) {
    console.error('booking-pdf error:', err.message, err.stack?.slice(0, 500));
    try { await browser?.close(); } catch {}
    return res.status(500).json({ error: 'server_error' });
  }
}
