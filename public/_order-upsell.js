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
 * What we can upsell, in the order it is shown.
 *
 * TWO, not the four Andy listed, and the reason is the deep linking spec
 * rather than a choice. Travelify's document (Darren, read 23 Sep 2026) defines
 * exactly five search types:
 *
 *     Flights · Accommodation · DynamicPackaging · CarRental · TicketsAttractions
 *
 * **There is no search type for airport transfers or for airport extras.** Both
 * are real products on a Travelify order, so we can see when someone has
 * booked one, and neither can be linked to a live search. A tile for them would
 * be a button with nowhere to go.
 *
 * They stay on the list below as a note rather than an omission, so the next
 * person does not spend an afternoon rediscovering it. If Travelify add the
 * search types, adding the tiles back is this constant plus an anchor each.
 *
 * Also deliberately absent: Flights, Accommodation and Packages are the booking
 * itself rather than an addition, and Extras is a bag of supplier oddments with
 * nothing to search for.
 */
export const UPSELL_PRODUCTS = Object.freeze(['TicketsAttractions', 'CarRental']);

/** Asked for, and not possible yet. See above. */
export const NOT_DEEPLINKABLE = Object.freeze({
  Transfers: 'Travelify has no Transfers search type in the deep linking spec.',
  AirportExtras: 'Travelify has no AirportExtras search type in the deep linking spec.',
});

/**
 * Search types, from Travelify's deep linking document.
 *
 * Both verified against the spec's own worked examples. An earlier draft of
 * this file guessed `Transfers` and `AirportExtras` from the product names and
 * would have shipped two dead buttons; the same draft anchored attractions on
 * `dst=CDG` when the spec wants a location NAME, and car hire on a date when
 * it wants a datetime. Reading the document was worth more than the guessing.
 */
export const SEARCH_TYPE = Object.freeze({
  TicketsAttractions: 'TicketsAttractions',
  CarRental: 'CarRental',
});

/** What each tile says. Plain, warm, UK English, no exclamation marks. */
const COPY = Object.freeze({
  TicketsAttractions: { label: 'Things to do', hint: 'Tours, attractions and days out while you are there.' },
  CarRental: { label: 'Car hire', hint: 'A car for your trip, picked up when you land.' },
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
  // Car hire wants a pickup and dropoff CLOCK time, not a date, so carry the
  // moment they land and the moment they fly home. Both are airport-local
  // times dressed as UTC by Travelify, which is exactly what bookingMoment
  // reads back, so the UTC fields ARE the local clock.
  let arriveAt = '';
  let departAt = '';

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
        arriveAt = clockOf(last && last.arrive);
      } else if (to && originIata && to === originIata) {
        inboundDate = dayOf(first.depart);
        departAt = clockOf(first.depart);
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
    arriveAt,
    departAt,
    // Where the trip actually happens. The spec's location searches want a
    // NAME plus a country code ("loc=Barcelona&ctry=ES"), not an airport code,
    // so this comes off the accommodation's own location. A resort or state is
    // a better answer than a city when the feed carries one, for the same
    // reason it is in booking-destination.js: people book Costa del Sol, not
    // Malaga. Falls back to the airport, which the spec allows via loct.
    place: placeOf(order, destIata),
  };
}

/** "2027-04-10T14:35" from a Travelify local-time string. */
export function clockOf(value) {
  const d = bookingMoment(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16);
}

/**
 * The destination as the spec wants it: a name, a country code, and which kind
 * of place it is.
 *
 * `country` on an accommodation location is a two-letter code, which is what
 * `ctry` takes. When there is no accommodation at all, the arrival airport is
 * a valid location too: the spec's own car hire example uses "pup=BCN" with
 * "pupt=Airport", so a code is a location name when the type says so.
 */
export function placeOf(order, destIata) {
  const items = (order && Array.isArray(order.items)) ? order.items : [];
  for (const it of items) {
    if (!it || (it.product !== 'Accommodation' && it.product !== 'Packages')) continue;
    const loc = it.accommodation && it.accommodation.location;
    if (!loc) continue;
    const name = String(loc.state || loc.city || '').trim();
    const ctry = String(loc.country || '').trim().toUpperCase();
    if (name && /^[A-Z]{2}$/.test(ctry)) return { loc: name, ctry, type: 'City' };
    if (name) return { loc: name, ctry: '', type: 'City' };
  }
  if (destIata) return { loc: destIata, ctry: '', type: 'Airport' };
  return null;
}

/** Heads on the booking, for the search's party size. */
export function partySize(order) {
  const t = (order && Array.isArray(order.travellers)) ? order.travellers : [];
  let adults = 0;
  let children = 0;
  const childAges = [];
  for (const p of t) {
    const type = String((p && (p.type || p.paxType)) || '').toLowerCase();
    if (type.indexOf('child') !== -1 || type.indexOf('infant') !== -1) {
      children++;
      const age = Number(p && (p.age != null ? p.age : p.paxAge));
      if (Number.isFinite(age) && age >= 0 && age < 18) childAges.push(Math.round(age));
    } else adults++;
  }
  // A booking with no traveller list still has to search for somebody.
  return { adults: adults || 2, children, childAges };
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
      // Where they are staying, across the whole time they are there.
      // st=TicketsAttractions&loc=<place>&ctry=<code>&fr=<date>&to=<date>
      if (trip.place && fromDate) {
        anchor = { loc: trip.place.loc, ctry: trip.place.ctry, loct: trip.place.type, fr: fromDate, to: toDate };
      }
    } else if (product === 'CarRental') {
      // Picked up at the airport they land at, when they land, and dropped off
      // before they fly home. The spec takes datetimes here, not dates, and a
      // pickup location type of Airport lets the IATA code be the name.
      // st=CarRental&pup=<iata>&pupt=Airport&fr=<datetime>&to=<datetime>
      const from = trip.arriveAt || (trip.outboundDate ? trip.outboundDate + 'T10:00' : '');
      const to = trip.departAt || (trip.inboundDate ? trip.inboundDate + 'T10:00'
        : (trip.checkOut ? trip.checkOut + 'T10:00' : ''));
      if (trip.destIata && from && to) {
        anchor = { pup: trip.destIata, pupt: 'Airport', pupctry: (trip.place && trip.place.ctry) || '', fr: from, to };
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
      childAges: party.childAges,
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
  // Location, however this search type names it.
  if (tile.loc) { p.set('loc', tile.loc); if (tile.ctry) p.set('ctry', tile.ctry); if (tile.loct) p.set('loct', tile.loct); }
  if (tile.pup) { p.set('pup', tile.pup); if (tile.pupctry) p.set('pupctry', tile.pupctry); if (tile.pupt) p.set('pupt', tile.pupt); }
  if (tile.fr) p.set('fr', tile.fr);
  if (tile.to && tile.to !== tile.fr) p.set('to', tile.to);
  p.set('adt', String(tile.adults || 2));
  // Children need an AGE EACH or the search is invalid, per the spec: "must
  // specify an age for each child searched". Without every age we search for
  // the adults alone rather than send a request Travelify will reject. The
  // offers widget reached the same conclusion on the same sentence.
  const ages = Array.isArray(tile.childAges) ? tile.childAges.filter((n) => Number.isFinite(n)) : [];
  if (tile.children && ages.length === tile.children) {
    p.set('chd', String(tile.children));
    for (const a of ages) p.append('chdage', String(a));
  }
  return 'https://dl.tvllnk.com/deeplink/' + encodeURIComponent(String(appId)) + '?' + p.toString();

}
