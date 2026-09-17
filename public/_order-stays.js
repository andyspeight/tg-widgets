// =============================================================================
//  /public/_order-stays.js — the ONE answer to "which stays are in this booking"
// =============================================================================
//
//  Read by the on-page My Booking widget (which carries a verbatim copy of the
//  core below, held in step by test/order-stays-drift-smoke.mjs because the
//  widget is a single script on customer sites and cannot import), the booking
//  PDF (public/_pdf-template.js) and the confirmation email
//  (public/_booking-email-template.js).
//
//  Why this exists (15 Sep 2026, Exclusively Travel booking ET121109). A
//  customer booked six nights at one hotel and then three at another. Every
//  document we produced showed the first hotel only, and the second stay was
//  absent altogether, while the total still covered both. So the paperwork
//  said £1,158 for six nights.
//
//  The cause was one word, repeated in three files:
//
//      const accItem = items.find(i => i.product === 'Accommodation' ...)
//
//  Every other product type was selected with .filter() and rendered as a
//  list. Accommodation alone used .find(), which returns the first match and
//  silently discards the rest. Nothing held the three copies in step, so the
//  same habit shipped three times.
//
//  Selection lives here now, once. An output asks for the stays and renders
//  all of them. Adding a fourth document means calling listStays, not writing
//  a fourth selector.
//
//  A PACKAGE (Jet2, TUI and friends) bundles hotel and flights into one item
//  and exposes item.accommodation, so it is a stay too and is included in
//  order. A booking can hold several, which is how a twin-centre package
//  arrives.
//
//  Runtime-neutral: no Node imports, no DOM, no environment reads, so the
//  editor previews and the browser widget run the exact code the server runs.
// =============================================================================

// >>> order-stays core (verbatim copy lives in public/widget-mybooking.js)
/** Products that put a roof over someone's head for the night. */
const STAY_PRODUCTS = ['Accommodation', 'Packages'];

const isStayProduct = (p) => STAY_PRODUCTS.indexOf(p) !== -1;

/** Nights: the item's own duration wins, then the room's. Null when unknown. */
function stayNights(item, accom) {
  const d = item && item.duration;
  if (Number.isFinite(d) && d > 0) return d;
  const u = accom && accom.units && accom.units[0];
  const n = u && u.nights;
  if (Number.isFinite(n) && n > 0) return n;
  return null;
}

/**
 * The calendar day inside a booking date, as YYYY-MM-DD. Empty when there
 * isn't one.
 *
 * Travelify writes a check-in as "2026-09-26T00:00:00": a date wearing a time,
 * with no timezone on it. That is a WALL CLOCK value, not an instant. The hotel
 * expects the guest on the 26th whatever a reader's device thinks the time is,
 * so the day is read off the string rather than through a Date.
 */
function stayDay(value) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value == null ? '' : value).trim());
  return m ? m[1] : '';
}

/**
 * A booking date or time as the wall clock says it, for anyone to format.
 *
 * Returns a Date whose UTC fields ARE the numbers written in the string, so
 * formatting it with timeZone 'UTC' prints what the supplier wrote, on every
 * device on earth. A value that carries a real zone ("...Z", "+03:00") is a
 * genuine instant and is left alone.
 *
 * Why (15 Sep 2026, Exclusively Travel ET121109, reported by Andy). The
 * booking's own My Booking page said six nights from 26 Sept checking out on
 * 1 Oct, and the second stay 2 Oct to 4 Oct. Both a day early. The PDF, from
 * the same calculation, said 2 Oct and 5 Oct and was right.
 *
 * new Date('2026-09-26T00:00:00') is parsed in the READER's timezone. In
 * British Summer Time that is 23:00 on the 25th in UTC, so counting six days
 * in UTC and reading the UTC date back lands on 1 Oct. On the server, where
 * the clock is UTC, the same code is correct, which is exactly why the
 * paperwork was right and the screen was wrong. Two other faults of the same
 * family were found with it: a date-only value read a day early for anyone
 * behind UTC (a customer in New York saw 1 Oct for 2026-10-02), and a flight
 * time written as 14:00 printed as 13:00 in British Summer Time and 18:00 in
 * New York.
 */
function bookingMoment(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(s);
  const d = m
    ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)))
    : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Check-out as YYYY-MM-DD, counted forward from check-in in whole days. Null
 * when unknown. Pure calendar arithmetic: no clock, no timezone, so it answers
 * the same on a phone in Sydney and a server in Virginia.
 */
function stayCheckout(checkin, nights) {
  const day = stayDay(checkin);
  if (!day || !Number.isFinite(nights)) return null;
  const d = new Date(day + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + nights);
  return d.toISOString().slice(0, 10);
}

/**
 * Every stay in the booking, in the order the traveller reaches them.
 *
 * Returns an array of plain facts. No formatting and no markup: each document
 * words and styles its own, which is why this can be shared by a PDF, an HTML
 * email and a widget that all look nothing like each other.
 *
 *   item        the order item it came from
 *   accom       item.accommodation
 *   name        property name
 *   checkin     YYYY-MM-DD, the calendar day, whatever shape the feed used
 *   nights      integer, or null
 *   checkout    YYYY-MM-DD, or null
 *   unit, rate  the first room and its first rate
 *   price       this stay's own price, or null
 *   currency    this stay's currency, or ''
 *   isPackage   true when the stay arrived inside a package item
 */
function listStays(order) {
  const items = (order && Array.isArray(order.items)) ? order.items : [];
  const stays = [];
  for (const item of items) {
    if (!item || !isStayProduct(item.product)) continue;
    const accom = item.accommodation || null;
    if (!accom) continue;
    const unit = (accom.units && accom.units[0]) || null;
    // The check-in is a calendar day, kept as YYYY-MM-DD however the feed
    // dressed it, so every output gets one shape and nobody has to parse a
    // date wearing a time for themselves.
    const checkin = stayDay(item.startDate || (unit && unit.checkin) || '') || null;
    const nights = stayNights(item, accom);
    stays.push({
      item,
      accom,
      name: accom.name || '',
      checkin,
      nights,
      checkout: nights ? stayCheckout(checkin, nights) : null,
      unit,
      rate: (unit && unit.rates && unit.rates[0]) || null,
      price: (accom.pricing && typeof accom.pricing.price === 'number')
        ? accom.pricing.price
        : (typeof item.price === 'number' ? item.price : null),
      currency: (accom.pricing && accom.pricing.currency) || item.currency || '',
      isPackage: item.product === 'Packages',
    });
  }
  // Soonest first, so the documents read in the order the trip happens. A stay
  // with no date keeps its position rather than jumping to the front.
  return stays
    .map((s, i) => ({ s, i, t: s.checkin ? Date.parse(s.checkin + 'T00:00:00Z') : NaN }))
    .sort((a, b) => {
      if (Number.isNaN(a.t) && Number.isNaN(b.t)) return a.i - b.i;
      if (Number.isNaN(a.t)) return 1;
      if (Number.isNaN(b.t)) return -1;
      return a.t - b.t || a.i - b.i;
    })
    .map((w) => w.s);
}

/** The representative stay: the one a cover page or a subject line refers to. */
function primaryStay(order) {
  return listStays(order)[0] || null;
}

/** True when the booking moves the traveller between properties. */
function isMultiStay(order) {
  return listStays(order).length > 1;
}
// <<< order-stays core

// Travelify returns board basis as a machine enum ("BedAndBreakfast",
// "AllInclusive"). This is the ONE list of readable labels, shared by the
// email's hotel card and the My Booking page. The widget cannot import, so it
// carries its own copy in fmtBoard; test:order-stays-drift fails if the two
// lists ever differ. Anything not on the list falls back to the raw string so
// we never silently lose information, and "Unknown" means we say nothing
// rather than invent a board basis.
const BOARD_LABELS = {
  'RoomOnly':        'Room only',
  'SelfCatering':    'Self catering',
  'BedAndBreakfast': 'Bed & breakfast',
  'HalfBoard':       'Half board',
  'HalfBoardPlus':   'Half board plus',
  'FullBoard':       'Full board',
  'FullBoardPlus':   'Full board plus',
  'AllInclusive':    'All inclusive',
  'AllInclusivePlus':'All inclusive plus',
  'UltraAllInclusive':'Ultra all inclusive',
};

/** A readable board basis, or null when the supplier gave us nothing real. */
function boardLabel(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.toLowerCase() === 'unknown') return null;
  if (Object.prototype.hasOwnProperty.call(BOARD_LABELS, v)) return BOARD_LABELS[v];
  return v;
}

/**
 * The room as the traveller should read it. Travelify's units[].name is the
 * full supplier string ("8 BED MIXED DORM (for 1 people)") and is preferred;
 * roomType is a category that comes back as the literal "Unknown" when the
 * supplier has not set one. Never invent a default: no "Standard", no
 * "Deluxe". Null means show no room at all.
 */
function roomLabel(unit) {
  if (!unit || typeof unit !== 'object') return null;
  if (typeof unit.name === 'string' && unit.name.trim()) return unit.name.trim();
  const t = typeof unit.roomType === 'string' ? unit.roomType.trim() : '';
  if (t && t.toLowerCase() !== 'unknown') return t;
  return null;
}

export {
  listStays, primaryStay, isMultiStay, stayNights, stayCheckout, stayDay, bookingMoment,
  STAY_PRODUCTS, isStayProduct, BOARD_LABELS, boardLabel, roomLabel,
};
