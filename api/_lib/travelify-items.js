/**
 * Travelgenix — robust Travelify order-item classification.
 *
 * Travelify order items nominally arrive as { product: 'Accommodation',
 * dataObject: {...} }. Real orders vary in three ways that used to make the
 * My Booking widget silently drop a booking's whole trip — the price still
 * counted toward the total, so the customer saw a confirmed booking with a
 * balance but no hotel, no flights and no real passenger list (observed on
 * Exclusively Travel ET90803, 9 Jul 2026):
 *
 *   1. dataObject arrives as a JSON-encoded STRING, not an object, so
 *      trimAccommodation/trimFlights read a string and produce all-empty
 *      detail (the flights item matched by product but rendered no legs).
 *   2. the detail lives under an alternate key (data / detail / object).
 *   3. the product is labelled with a variant string, or is a product type we
 *      have never seen, so the exact-match dispatch skipped it entirely (the
 *      ~£2,877 main item never appeared anywhere).
 *
 * These helpers make item handling tolerant of all three. They are ADDITIVE:
 * an item that is already well formed (an object dataObject under a canonical
 * product label) is classified EXACTLY as before, so working bookings are
 * untouched — the new paths only fire for items the old code dropped.
 *
 * Pure and dependency-free so /api/retrieve-order (widget + email) and
 * /api/booking-pdf share ONE source of truth and cannot drift apart.
 *
 * Module type: ESM (matches the rest of tg-widgets).
 */

// The eight product types every downstream consumer (widget, PDF, email)
// filters on via `item.product === '<Type>'`. trimItem normalises to one of
// these so a variant/unknown label still gets picked up and rendered.
export const CANONICAL_PRODUCTS = Object.freeze([
  'Accommodation', 'Flights', 'AirportExtras', 'Transfers',
  'CarRental', 'TicketsAttractions', 'Packages', 'Extras',
]);
const CANONICAL_SET = new Set(CANONICAL_PRODUCTS);

// Known label variants → canonical product. Keys are normalised (lowercase,
// alphanumerics only) so 'Car Rental', 'car-rental' and 'CARRENTAL' all match
// the same entry.
const PRODUCT_ALIASES = Object.freeze({
  accommodation: 'Accommodation', accommodations: 'Accommodation',
  hotel: 'Accommodation', hotels: 'Accommodation', villa: 'Accommodation',
  villas: 'Accommodation', apartment: 'Accommodation', apartments: 'Accommodation',
  property: 'Accommodation', properties: 'Accommodation', room: 'Accommodation',
  rooms: 'Accommodation', stay: 'Accommodation', lodging: 'Accommodation',
  flight: 'Flights', flights: 'Flights', flightonly: 'Flights', flightsonly: 'Flights',
  airportextras: 'AirportExtras', airportextra: 'AirportExtras', lounge: 'AirportExtras',
  lounges: 'AirportExtras', parking: 'AirportExtras', airportparking: 'AirportExtras',
  airporthotel: 'AirportExtras', airporthotels: 'AirportExtras',
  transfer: 'Transfers', transfers: 'Transfers',
  carrental: 'CarRental', carrentals: 'CarRental', carhire: 'CarRental',
  car: 'CarRental', cars: 'CarRental',
  ticketsattractions: 'TicketsAttractions', tickets: 'TicketsAttractions',
  ticket: 'TicketsAttractions', attraction: 'TicketsAttractions',
  attractions: 'TicketsAttractions', experience: 'TicketsAttractions',
  experiences: 'TicketsAttractions', excursion: 'TicketsAttractions',
  excursions: 'TicketsAttractions', activity: 'TicketsAttractions', activities: 'TicketsAttractions',
  packages: 'Packages', package: 'Packages', holiday: 'Packages', holidays: 'Packages',
  dynamicpackage: 'Packages', dynamicpackages: 'Packages', packageholiday: 'Packages', packageholidays: 'Packages',
  extras: 'Extras', extra: 'Extras', addextra: 'Extras', addextras: 'Extras',
  addextragroup: 'Extras', addextragroups: 'Extras',
});

const normLabel = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Normalise an item's detail payload into a plain object (or null).
 *   - unwraps a JSON-encoded string,
 *   - falls back to common alternate keys,
 *   - returns null for anything we can't turn into an object, so callers can
 *     treat "no usable detail" uniformly.
 */
export function coerceDataObject(item) {
  if (!item || typeof item !== 'object') return null;
  let d = item.dataObject;
  if (d == null) d = item.data ?? item.detail ?? item.details ?? item.object ?? null;
  if (typeof d === 'string') {
    const s = d.trim();
    if (s && (s[0] === '{' || s[0] === '[')) {
      try { d = JSON.parse(s); } catch { return null; }
    } else {
      return null;
    }
  }
  return (d && typeof d === 'object') ? d : null;
}

/**
 * Classify by the SHAPE of the payload when the label is unknown. Ordered
 * most-specific first: Packages carry both a hotel and a flight shape, so they
 * must be tested before the individual product shapes. Returns null when the
 * shape matches nothing we know how to render.
 */
export function sniffProductFromShape(d) {
  if (!d || typeof d !== 'object') return null;

  // Extras dataObject is an ARRAY of extra groups.
  if (Array.isArray(d)) {
    return d.some(g => g && typeof g === 'object' && (Array.isArray(g.extras) || g.type != null || g.name != null))
      ? 'Extras'
      : null;
  }

  const hasFlight = Array.isArray(d.routes) || Array.isArray(d.segments) || d.fareType != null;
  const hasHotel = Array.isArray(d.units)
    || (d.name != null && (d.location != null || Array.isArray(d.amenities) || d.rating != null || Array.isArray(d.guests)));

  if (hasFlight && hasHotel) return 'Packages';
  if (Array.isArray(d.packages) && (d.transmission != null || d.rentalOperator != null || d.classCode != null || d.className != null)) return 'CarRental';
  if (d.vehicle != null || d.outPickup != null || d.outDropoff != null || d.journeyDuration != null) return 'Transfers';
  if (d.ticketType != null || Array.isArray(d.dateOptions)
    || (Array.isArray(d.options) && d.options.some(o => o && Array.isArray(o.dateOptions)))) return 'TicketsAttractions';
  if ((d.startDateTime != null || d.endDateTime != null) && d.location && d.location.iataCode != null) return 'AirportExtras';
  if (hasFlight) return 'Flights';
  if (hasHotel) return 'Accommodation';
  return null;
}

/**
 * Resolve a raw label + payload onto a canonical product, recording HOW it was
 * resolved so callers can prefer confident matches over shape guesses.
 *   1. 'exact'  — the label is already canonical (fast path, authoritative),
 *   2. 'alias'  — a known label variant,
 *   3. 'sniff'  — a structural read of the payload (catches never-seen labels).
 *
 * The Packages ambiguity is resolved by SHAPE, not the label alone: a generic
 * word like 'Holiday' must not invent a bundled hotel+flight when the payload
 * is only one of them (which would set a phantom hasFlights/hasAccommodation
 * downstream), and a single-product label must not drop a genuinely bundled
 * component. Other label/shape disagreements keep the (more intentional) label.
 */
function resolveInternal(rawProduct, dataObject) {
  const raw = String(rawProduct == null ? '' : rawProduct).trim();
  if (CANONICAL_SET.has(raw)) return { type: raw, by: 'exact' };

  const alias = PRODUCT_ALIASES[normLabel(raw)] || null;
  const sniff = sniffProductFromShape(dataObject);

  if (alias) {
    if (alias === 'Packages' && sniff && sniff !== 'Packages') return { type: sniff, by: 'sniff' };
    if (alias !== 'Packages' && sniff === 'Packages') return { type: 'Packages', by: 'sniff' };
    return { type: alias, by: 'alias' };
  }
  if (sniff) return { type: sniff, by: 'sniff' };
  return { type: null, by: null };
}

/**
 * Resolve a raw Travelify product label onto our canonical set (or null).
 */
export function resolveProductType(rawProduct, dataObject) {
  return resolveInternal(rawProduct, dataObject).type;
}

/**
 * Coerce + classify in one call.
 * Returns { productType, dataObject, rawProduct, resolvedBy }.
 *   - productType is null when the item can't be classified at all.
 *   - resolvedBy is 'exact' | 'alias' | 'sniff' | null — callers use it to keep
 *     genuine (exact/alias) matches ahead of shape-sniffed ones so a mystery
 *     item can't displace a real hotel/flight of the same type.
 */
export function classifyItem(item) {
  const dataObject = coerceDataObject(item);
  const { type, by } = resolveInternal(item && item.product, dataObject);
  return {
    productType: type,
    dataObject,
    rawProduct: item && item.product != null ? String(item.product) : null,
    resolvedBy: by,
  };
}

/**
 * Collect the unique traveller/guest list across every product sub-object on
 * a set of trimmed items.
 *
 * Reads from ALL sub-objects on each item, not the first truthy one. The old
 * `accommodation?.guests || flights?.travellers || …` short-circuit picked an
 * EMPTY accommodation.guests array (empty arrays are truthy in JS) and so
 * never reached a populated flights.travellers — a Packages booking, or any
 * booking whose hotel carried no guests but whose flights carried the
 * passengers, lost its whole passenger list and fell back to the order-level
 * customerTitle ("Mr" for a party of Miss/Ms). De-dupes on title + name.
 */
export function aggregateTravellers(items) {
  // De-dupe on the PERSON, tolerating the common title divergence between the
  // hotel record (often title-less) and the flight record (airline-required
  // title) for the SAME passenger — which must collapse to one — WITHOUT
  // collapsing two genuinely different people who share a first + surname but
  // carry distinct titles (e.g. a "John Smith" father and son), which must
  // stay two. Two records merge only when their titles match or either side is
  // title-less; the first sighting keeps its type/position (so the hotel's
  // 'Lead' wins) and borrows a title from a later sighting when it lacked one.
  const buckets = new Map(); // 'first|surname' -> kept traveller objects
  const order = [];
  const norm = (s) => (s || '').trim().toLowerCase();
  const titled = (t) => !!(t && t.title && String(t.title).trim());
  for (const item of (Array.isArray(items) ? items : [])) {
    if (!item || typeof item !== 'object') continue;
    const lists = [
      item.accommodation?.guests,
      item.flights?.travellers,
      item.airportExtras?.travellers,
      item.transfers?.travellers,
      item.carRental?.travellers,
      item.ticketsAttractions?.guests,
      item.extras?.travellers,
    ].filter(Array.isArray);
    for (const list of lists) {
      for (const t of list) {
        if (!t || typeof t !== 'object') continue;
        const fn = norm(t.firstname);
        const sn = norm(t.surname);
        if (!fn && !sn) continue;
        const key = `${fn}|${sn}`;
        let bucket = buckets.get(key);
        if (!bucket) { bucket = []; buckets.set(key, bucket); }
        // Find an existing record for the same person: same title, or either
        // side untitled. A different non-empty title means a distinct person.
        let slot = -1;
        for (let i = 0; i < bucket.length; i++) {
          const e = bucket[i];
          if (norm(e.title) === norm(t.title) || !titled(e) || !titled(t)) { slot = i; break; }
        }
        if (slot === -1) {
          bucket.push(t);
          order.push(t);
        } else if (!titled(bucket[slot]) && titled(t)) {
          // Same person, first sighting had no title — borrow this one's,
          // keeping the original type/position.
          const upgraded = { ...bucket[slot], title: t.title };
          const oi = order.indexOf(bucket[slot]);
          bucket[slot] = upgraded;
          if (oi !== -1) order[oi] = upgraded;
        }
      }
    }
  }
  return order;
}

/**
 * A PII-safe one-line description of an item we could NOT classify — logged so
 * the next never-seen product type or payload shape can be diagnosed from
 * server logs without shipping a bespoke probe and without leaking customer
 * data (no names, references, addresses or free text, only structural keys).
 */
export function describeUnclassifiedItem(item) {
  const d = coerceDataObject(item);
  let keys = [];
  if (Array.isArray(d)) {
    keys = ['<array>', ...(d[0] && typeof d[0] === 'object' ? Object.keys(d[0]) : [])].slice(0, 25);
  } else if (d && typeof d === 'object') {
    keys = Object.keys(d).slice(0, 25);
  }
  return {
    rawProduct: item && item.product != null ? String(item.product).slice(0, 40) : null,
    dataObjectType: Array.isArray(d) ? 'array' : (d ? 'object' : typeof (item && item.dataObject)),
    dataObjectKeys: keys,
    hasPrice: typeof (item && item.price) === 'number',
  };
}
