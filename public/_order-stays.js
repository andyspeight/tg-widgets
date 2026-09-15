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

/** Check-out as YYYY-MM-DD, counted forward from check-in. Null when unknown. */
function stayCheckout(checkin, nights) {
  if (!checkin || !Number.isFinite(nights)) return null;
  const d = new Date(checkin.length === 10 ? checkin + 'T00:00:00Z' : checkin);
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
 *   checkin     YYYY-MM-DD (or whatever the feed carried)
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
    const checkin = item.startDate || (unit && unit.checkin) || null;
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
    .map((s, i) => ({ s, i, t: s.checkin ? Date.parse(s.checkin.length === 10 ? s.checkin + 'T00:00:00Z' : s.checkin) : NaN }))
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

export { listStays, primaryStay, isMultiStay, stayNights, stayCheckout, STAY_PRODUCTS, isStayProduct };
