/**
 * Travelgenix Control — Retrieve Order BY CLIENT RECORD ID (internal endpoint)
 *
 * Server-to-server sibling of /api/retrieve-order. Where retrieve-order is
 * keyed by widgetId (public, called by the embedded My Booking widget), this
 * endpoint is keyed by a Clients record id and is called ONLY by trusted
 * Travelgenix services (currently Luna Travel's traveller PWA) carrying the
 * shared internal key.
 *
 * Why this exists:
 *   Luna Travel's traveller app needs the full Travelify order for a redeemed
 *   booking, resolved against the agency's OWN Travelify credentials. Per the
 *   28 May architecture, Luna Travel never reads Airtable directly — it reads
 *   from Control. This endpoint is that read: it resolves credentials via the
 *   same proven lookupClientCredentialsByRecordId path used by the admin
 *   Travelify tab and the Test-connection check, calls Travelify, and returns
 *   the SAME trimmed/sanitised order shape as /api/retrieve-order, plus the
 *   agency's white-label branding.
 *
 * Auth:
 *   X-TG-Internal-Key header must match env TG_INTERNAL_KEY (timing-safe).
 *   No cookie, no CORS — this is never called from a browser.
 *
 * Request (POST):
 *   { recordId, emailAddress, departDate, orderRef }
 * Response (200):
 *   { ok: true, order: <trimmed order>, agency: <branding|null> }
 * All failures return a generic status with no field-level detail.
 *
 * NOTE ON DUPLICATION: the trim* / safe* / computeSummary / trimOrder block
 * below is copied VERBATIM from api/retrieve-order.js (v1.4.1) so the order
 * shape is byte-identical and the Booking type keeps mirroring one contract.
 * Post-show TODO: extract a shared api/_order-trim.js and import in both.
 */

import crypto from 'node:crypto';
import { lookupClientCredentialsByRecordId } from '../_auth.js';

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const CLIENTS_TABLE = 'tblikekpaTKraMktZ';
const TRAVELIFY_API = 'https://api.travelify.io/account/order';

// Clients table branding/contact field IDs (returnFieldsByFieldId=true).
const CF = {
  appName:       'fld0H6vOJOYqiODF5',
  clientName:    'fldx9CiWtSm5lX7MF',
  tradingName:   'fldDbFv039Bip6W8u',
  email:         'fldVRiIAlrTjxnNHP',
  website:       'fld9zVc9PHgu18RVW',
  logoUrl:       'fldGAJdxjdzz2X0sp',
  phone:         'fldFES7Aa057MB3VT',
  brandPrimary:  'fldz0cwl3jvX9PL6s',
  brandAccent:   'fld9dUcFDE5Nxm1lE',
  welcome:       'fld10hwtIDkX2YWTx',
};

// ----- Timing-safe key compare -----
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ----- Validation (mirrors retrieve-order.js patterns) -----
function validateRecordId(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim();
  if (!/^rec[A-Za-z0-9]{14}$/.test(v)) return null;
  return v;
}
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

// ----- Agency branding read (one Clients GET; creds resolver does its own) -----
async function fetchAgencyBranding(recordId) {
  const key = process.env.AIRTABLE_KEY;
  if (!key) return null;
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}/${recordId}`);
  url.searchParams.set('returnFieldsByFieldId', 'true');
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  const rec = await res.json();
  const f = rec.fields || {};
  const str = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
  return {
    name: str(f[CF.tradingName]) || str(f[CF.appName]) || str(f[CF.clientName]) || '',
    legalName: str(f[CF.clientName]) || '',
    appName: str(f[CF.appName]) || '',
    email: str(f[CF.email]) || '',
    website: str(f[CF.website]) || '',
    logoUrl: str(f[CF.logoUrl]) || '',
    phone: str(f[CF.phone]) || '',
    brandPrimaryColour: str(f[CF.brandPrimary]) || '',
    brandAccentColour: str(f[CF.brandAccent]) || '',
    welcomeMessage: str(f[CF.welcome]) || '',
  };
}

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

// Extras — a distinct Travelify product ("Add Extra Group / Add Extra" in the
// agent system, frequently added to a booking AFTER it was originally made).
// Unlike every other product its dataObject is an ARRAY of extra groups; each
// group holds one or more bookable extras, and each extra carries its own
// price and participants. We also flatten a unique traveller list so the
// order-level traveller aggregation can pick these people up the same way it
// does for every other product.
function trimExtras(dataObject) {
  const rawGroups = Array.isArray(dataObject) ? dataObject : [];
  const seen = new Set();
  const travellers = [];
  const groups = rawGroups.slice(0, 20).map((g) => ({
    type: safeStr(g.type, 60),
    name: safeStr(g.name, 120),
    description: safeStr(g.description, 500),
    extras: Array.isArray(g.extras)
      ? g.extras.slice(0, 20).map((e) => {
          const participants = Array.isArray(e.participants)
            ? e.participants.slice(0, 20).map((p) => ({
                type: safeStr(p.type, 30),
                title: safeStr(p.title, 30),
                firstname: safeStr(p.firstname, 80),
                surname: safeStr(p.surname, 80),
              }))
            : [];
          for (const p of participants) {
            const key = `${(p.title || '').toLowerCase()}|${(p.firstname || '').toLowerCase()}|${(p.surname || '').toLowerCase()}`;
            if (!seen.has(key) && (p.firstname || p.surname)) { seen.add(key); travellers.push(p); }
          }
          return {
            type: safeStr(e.type, 60),
            name: safeStr(e.name, 200),
            description: safeStr(e.description, 1000),
            qty: safeNum(e.qtySelected),
            payAtPickup: !!e.isPayAtPickup,
            pricing: e.pricing ? {
              currency: safeStr(e.pricing.currency, 10),
              price: safeNum(e.pricing.price),
              refundability: safeStr(e.pricing.refundability, 30),
            } : null,
            participants,
          };
        })
      : [],
  }));
  return { groups, travellers };
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
  } else if (item.product === 'Extras' && item.dataObject) {
    out.extras = trimExtras(item.dataObject);
  }
  // Other product types (Insurance, etc) fall through with the
  // common envelope only. Widget renders a generic "Booked" card for those
  // so the price isn't orphaned.

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
    hasTransfers: false,
    hasCarRental: false,
    hasTicketsAttractions: false,
    hasPackages: false,
    hasExtras: false,
    accommodationItems: 0,
    flightItems: 0,
    airportExtrasItems: 0,
    transfersItems: 0,
    carRentalItems: 0,
    ticketsAttractionsItems: 0,
    packagesItems: 0,
    extrasItems: 0,
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
    } else if (item.product === 'Extras') {
      summary.hasExtras = true;
      summary.extrasItems++;
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
      item.extras?.travellers ||
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


// ----- HTTP handler (internal, server-to-server) -----

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Internal-key gate. No browser ever calls this, so no CORS is set.
  const provided = typeof req.headers['x-tg-internal-key'] === 'string'
    ? req.headers['x-tg-internal-key'] : '';
  const expected = process.env.TG_INTERNAL_KEY;
  if (!expected || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'unauthorised' });
  }

  // Parse body
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'bad_request' });
  }

  // Validate inputs
  const recordId = validateRecordId(body.recordId);
  const emailAddress = validateEmail(body.emailAddress);
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);
  if (!recordId || !emailAddress || !departDate || !orderRef) {
    return res.status(400).json({ error: 'bad_request' });
  }

  try {
    // 1. Resolve this agency's Travelify credentials (Clients table, plaintext).
    //    Same path proven by the admin Travelify tab + Test connection.
    let creds;
    try {
      creds = await lookupClientCredentialsByRecordId(recordId);
    } catch (e) {
      console.error('[retrieve-order-by-client] cred lookup failed:', e.message);
      return res.status(404).json({ error: 'not_found' });
    }
    if (!creds || !creds.appId || !creds.apiKey) {
      console.warn('[retrieve-order-by-client] no credentials for', recordId);
      return res.status(404).json({ error: 'not_found' });
    }

    // 2. Call Travelify. The Origin header is mandatory — without it the API
    //    silently returns a false 401. Do not remove it.
    let tRes;
    try {
      tRes = await fetch(TRAVELIFY_API, {
        method: 'POST',
        headers: {
          Authorization: `Token ${creds.appId}:${creds.apiKey}`,
          'Content-Type': 'application/json',
          Origin: 'https://www.travelgenix.io',
        },
        body: JSON.stringify({ emailAddress, departDate, orderRef }),
        signal: AbortSignal.timeout(12000),
      });
    } catch (e) {
      console.error('[retrieve-order-by-client] travelify fetch failed:', e.message);
      return res.status(502).json({ error: 'upstream' });
    }

    const rawText = await tRes.text();
    if (tRes.status === 404) return res.status(404).json({ error: 'not_found' });
    if (!tRes.ok) {
      console.error('[retrieve-order-by-client] travelify non-ok', tRes.status);
      return res.status(404).json({ error: 'not_found' });
    }

    let raw;
    try { raw = JSON.parse(rawText); }
    catch { return res.status(404).json({ error: 'not_found' }); }

    // Travelify's documented in-body not-found shape
    if (raw && (raw.code === '404' || raw.code === 404)) {
      return res.status(404).json({ error: 'not_found' });
    }

    // 3. Trim + sanitise (verbatim parity with /api/retrieve-order).
    const order = trimOrder(raw);
    if (!order || !order.id) return res.status(404).json({ error: 'not_found' });

    // 4. White-label branding from the same Clients record (best-effort).
    let agency = null;
    try { agency = await fetchAgencyBranding(recordId); }
    catch (e) { console.warn('[retrieve-order-by-client] branding fetch failed:', e.message); }

    return res.status(200).json({ ok: true, order, agency });
  } catch (err) {
    console.error('[retrieve-order-by-client] error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
}
