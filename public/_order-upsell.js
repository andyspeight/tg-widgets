/**
 * public/_order-upsell.js — what else this traveller could book
 *
 * A customer opening their booking has already told us where they are going,
 * when, and how many of them there are. Andy, 23 Sep 2026: "if a client has
 * booked a flight and hotel to Paris we could offer things to do, car hire,
 * airport transfers, airport extras", each one a search deep link for the dates
 * of their trip.
 *
 * Two rules shape everything here.
 *
 * **Never offer what they already have.** A traveller who booked a transfer
 * does not want a transfer tile. Travelify orders carry a product on every
 * item, normalised to one of eight canonical names by travelify-items.js, so
 * this is a set difference rather than a guess.
 *
 * **Each tile searches its own dates, not the trip's.** Andy chose this over
 * one date range for all four, and it matters: airport parking belongs to the
 * OUTBOUND date at the UK airport, not to the week in Paris, and a transfer
 * search spanning ten nights is not a search anyone wants. So each product
 * states what it anchors to.
 *
 * Pure. No network, no clock, no config reads. An order in, tiles out, so the
 * same function answers for the widget, a test and anything later.
 *
 * DATES. Every date here goes through `bookingMoment` and is printed from UTC
 * fields, per the rule in CLAUDE.md: Travelify writes a check-in as
 * "2026-09-26T00:00:00", a date wearing a time with no zone on it, and a local
 * parse puts a British browser a day out.
 */
import { listStays, bookingMoment } from './_order-stays.js';

/**
 * The four we can upsell, in the order they are shown.
 *
 * Deliberately not the other four canonical products: Flights, Accommodation
 * and Packages are the booking itself rather than an addition, and Extras is a
 * bag of supplier oddments with nothing to search for.
 */
export const UPSELL_PRODUCTS = Object.freeze(['TicketsAttractions', 'Transfers', 'CarRental', 'AirportExtras']);

/**
 * ⚠ THE SEARCH TYPES BELOW ARE NOT YET CONFIRMED BY TRAVELIFY (23 Sep 2026).
 *
 * `TicketsAttractions` is proven: the Event Tickets widgets book through it
 * every day. The other three are the canonical product names on the assumption
 * that the deep link vocabulary matches, which is likely and is not evidence.
 *
 * This matters more than it looks. When the events deep link was built on a
 * reasonable assumption about its parameters, every Book button returned
 * "Unable to match location" and it took a probe to find out why. A wrong `st`
 * here ships four dead buttons onto a customer's own booking page.
 *
 * So: confirm each against Travelify's deep linking spec before this is turned
 * on for clients, and correct it HERE. Nothing else needs to change.
 */
export const SEARCH_TYPE = Object.freeze({
  TicketsAttractions: 'TicketsAttractions',   // proven
  Transfers: 'Transfers',                     // unconfirmed
  CarRental: 'CarRental',                     // unconfirmed
  AirportExtras: 'AirportExtras',             // unconfirmed
});

/** What each tile says. Plain, warm, UK English, no exclamation marks. */
const COPY = Object.freeze({
  TicketsAttractions: { label: 'Things to do', hint: 'Tours, attractions and days out while you are there.' },
  Transfers: { label: 'Airport transfers', hint: 'Getting from the airport to where you are staying.' },
  CarRental: { label: 'Car hire', hint: 'A car for your trip, picked up when you land.' },
  AirportExtras: { label: 'Airport extras', hint: 'Parking, lounges and fast track before you fly.' },
});

/** yyyy-mm-dd from a Travelify date, read as a calendar date and not an instant. */
export function dayOf(value) {
  const d = bookingMoment(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Every canonical product already on this order. */
export function bookedProducts(order) {
  const out = new Set();
  const items = (order && Array.isArray(order.items)) ? order.items : [];
  for (const it of items) {
    const p = it && typeof it.product === 'string' ? it.product.trim() : '';
    if (p) out.add(p);
  }
  return out;
}

/**
 * The flight shape of the trip: where they fly from, where they land, and when.
 *
 * Returns nulls rather than guesses. A booking with no flight still gets
 * attractions and transfers off the stay; it just cannot get airport extras,
 * which have no airport to attach to.
 */
export function tripShape(order) {
  const items = (order && Array.isArray(order.items)) ? order.items : [];
  const flights = items.filter((it) => it && it.product === 'Flights');

  let originIata = null;
  let destIata = null;
  let outboundDate = '';
  let inboundDate = '';

  for (const f of flights) {
    const legs = Array.isArray(f.legs) ? f.legs : [];
    for (let i = 0; i < legs.length; i++) {
      const segs = Array.isArray(legs[i] && legs[i].segments) ? legs[i].segments : [];
      if (!segs.length) continue;
      const first = segs[0];
      const last = segs[segs.length - 1];
      const from = first && first.origin && first.origin.iataCode;
      const to = last && last.destination && last.destination.iataCode;
      // The first leg is the way out; anything after it that lands back where
      // they started is the way home.
      if (!originIata && from) {
        originIata = from;
        destIata = to || null;
        outboundDate = dayOf(first.depart);
      } else if (to && originIata && to === originIata) {
        inboundDate = dayOf(first.depart);
      }
    }
  }

  // listStays has already read the check-in as a calendar day and counted the
  // nights forward to a check-out. Re-deriving either here would be a second
  // implementation of the rule that cost us a day-out check-out in September,
  // so take what it gives.
  const stays = listStays(order);
  const first = stays[0] || null;
  const last = stays.length ? stays[stays.length - 1] : null;
  const checkIn = (first && first.checkin) || '';
  // A multi-stay trip runs to the LAST check-out, not the first: someone with
  // three hotels is away for all of it.
  const checkOut = (last && last.checkout) || '';

  return {
    originIata: originIata || null,
    destIata: destIata || null,
    outboundDate: outboundDate || '',
    inboundDate: inboundDate || '',
    checkIn,
    checkOut,
    stayCount: stays.length,
    // Where the trip happens, for the searches that need a place rather than an
    // airport. The destination airport is the steadiest anchor we hold; a city
    // name off an accommodation record is free text and varies by supplier.
    destinationAnchor: destIata || null,
  };
}

/** Heads on the booking, for the search's party size. */
export function partySize(order) {
  const t = (order && Array.isArray(order.travellers)) ? order.travellers : [];
  let adults = 0;
  let children = 0;
  for (const p of t) {
    const type = String((p && (p.type || p.paxType)) || '').toLowerCase();
    if (type.indexOf('child') !== -1 || type.indexOf('infant') !== -1) children++;
    else adults++;
  }
  // A booking with no traveller list still has to search for somebody.
  return { adults: adults || 2, children };
}

/**
 * The tiles to show, in order.
 *
 * @param order  a trimmed Travelify order, as /api/retrieve-order returns it
 * @param opts   { enabled: { TicketsAttractions: true, ... } } from the widget config
 *
 * A tile is dropped when the product is already booked, when the client has
 * switched it off, or when the trip carries nothing to anchor its search to.
 * That last one is the difference between a useful link and a dead one.
 */
export function upsellTiles(order, opts = {}) {
  if (!order) return [];
  const enabled = (opts && opts.enabled) || {};
  const booked = bookedProducts(order);
  const trip = tripShape(order);
  const party = partySize(order);

  // Attractions and transfers work off the stay when there is one and the
  // flight when there is not, so a flight-only booking still gets offers.
  const fromDate = trip.checkIn || trip.outboundDate;
  const toDate = trip.checkOut || trip.inboundDate || fromDate;

  const tiles = [];
  for (const product of UPSELL_PRODUCTS) {
    if (booked.has(product)) continue;
    if (enabled[product] === false) continue;

    let anchor = null;
    if (product === 'TicketsAttractions') {
      // Across the stay, where they are staying.
      if (trip.destinationAnchor && fromDate) {
        anchor = { dst: trip.destinationAnchor, from: fromDate, to: toDate };
      }
    } else if (product === 'Transfers') {
      // The day they land, from the airport they land at.
      const day = trip.outboundDate || trip.checkIn;
      if (trip.destIata && day) {
        anchor = { dst: trip.destIata, from: day, to: trip.inboundDate || trip.checkOut || day };
      }
    } else if (product === 'CarRental') {
      // Picked up on arrival, dropped off when they leave.
      const from = trip.outboundDate || trip.checkIn;
      const to = trip.inboundDate || trip.checkOut || from;
      if (trip.destIata && from) anchor = { dst: trip.destIata, from, to };
    } else if (product === 'AirportExtras') {
      // The one that is NOT at the destination. Parking, a lounge and fast
      // track all happen at the airport they fly FROM, on the day they fly out,
      // and the car sits there until they come home.
      if (trip.originIata && trip.outboundDate) {
        anchor = { dst: trip.originIata, from: trip.outboundDate, to: trip.inboundDate || trip.outboundDate };
      }
    }

    if (!anchor) continue;   // nothing to search for beats a link that dead-ends
    tiles.push({
      product,
      st: SEARCH_TYPE[product],
      label: COPY[product].label,
      hint: COPY[product].hint,
      ...anchor,
      adults: party.adults,
      children: party.children,
    });
  }
  return tiles;
}

/**
 * One tile's Travelify deep link, on the CLIENT's own application.
 *
 * Returns '' without an appId, so the caller drops the tile rather than
 * sending a customer to somebody else's booking engine.
 */
export function upsellUrl(tile, appId) {
  if (!tile || !appId || !tile.st) return '';
  const p = new URLSearchParams();
  p.set('st', tile.st);
  if (tile.dst) p.set('dst', tile.dst);
  if (tile.from) p.set('fr', tile.from);
  if (tile.to && tile.to !== tile.from) p.set('to', tile.to);
  p.set('adt', String(tile.adults || 2));
  if (tile.children) p.set('chd', String(tile.children));
  return 'https://dl.tvllnk.com/deeplink/' + encodeURIComponent(String(appId)) + '?' + p.toString();
}
