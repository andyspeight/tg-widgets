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
 * WHAT DECIDES A TILE (24 Sep 2026)
 *
 * Travelify's Orders API now says, on every order, which upsells the client's
 * application is selling: `upsellsActive`, an array of product types. Their
 * spec ("Orders API: upsellsActive field", Andy, 24 Sep 2026) is the authority
 * on WHICH products may be offered, and `allowedUpsells` below is that spec
 * and nothing else:
 *
 *   1. only a product type listed in upsellsActive;
 *   2. CarRental, Transfers and AirportExtras are dropped when the order
 *      already has an item of that product;
 *   3. TicketsAttractions is the one exception, and is offered even when
 *      tickets are already booked, "customers may want to buy further tickets
 *      for other activities during their stay";
 *   4. missing, null or empty means NO upsells at all;
 *   5. a value we do not know is ignored, never an error or a broken link.
 *
 * That replaces our own guess at rule 2, which dropped a booked
 * TicketsAttractions like any other.
 *
 * Two gates of our own sit after Travelify's, and neither can ADD a product it
 * did not allow:
 *
 *   `status`  whether OUR link for the product has been opened against the
 *             live service and landed on a search. upsellsActive says the
 *             client sells transfers; it cannot say our transfer parameters
 *             are right. See below.
 *   anchor    whether this booking has something to search with: a place for
 *             attractions, an arrival airport for car hire. A tile with
 *             nothing to search for is dropped rather than drawn dead.
 *
 * Plus the client's own switches in the My Booking editor, which can only
 * hide.
 *
 * `status`:
 *
 *   'live'     opened against the service and lands on a real search.
 *              TicketsAttractions and CarRental, built from the deep linking
 *              document's own worked examples parameter for parameter.
 *   'unproved' built and never landed. `npm run test:order-upsell` prints the
 *              exact URL, so one click settles it.
 *
 * Deliberately absent whatever happens: Flights, Accommodation and Packages are
 * the booking itself rather than an addition, and Extras is a bag of supplier
 * oddments with nothing to search for. Neither is in Travelify's list either.
 */
export const UPSELL_CATALOGUE = Object.freeze([
  Object.freeze({
    product: 'TicketsAttractions', st: 'TicketsAttractions', status: 'live',
    // Travelify's rule 3: offered even when tickets are already on the order.
    repeatable: true,
    label: 'Things to do', hint: 'Tours, attractions and days out while you are there.',
  }),
  Object.freeze({
    product: 'CarRental', st: 'CarRental', status: 'live',
    label: 'Car hire', hint: 'A car for your trip, picked up when you land.',
  }),
  Object.freeze({
    // HISTORY. 23 Sep 2026: Andy opened this link on a real application and the
    // deep linker replied, verbatim,
    //   {"success":false,"error":"Search type Transfers is not currently
    //    supported by deep linker"}
    // and he raised it with Darren. 24 Sep 2026: Travelify's upsellsActive spec
    // names Transfers as a product whose deeplink "can be shown", so the refusal
    // may be stale. Unproved rather than refused until the link is opened again.
    // The PARAMETERS are ours, read across from Car Rental; the search type
    // being accepted does not prove them.
    product: 'Transfers', st: 'Transfers', status: 'unproved',
    label: 'Airport transfers', hint: 'A ride from the airport to where you are staying, and back.',
  }),
  Object.freeze({
    // Same history as Transfers: refused by name on 23 Sep 2026
    //   {"success":false,"error":"Search type AirportExtras is not currently
    //    supported by deep linker"}
    // and named as deeplink-able by the upsellsActive spec on 24 Sep 2026.
    product: 'AirportExtras', st: 'AirportExtras', status: 'unproved',
    label: 'Airport extras', hint: 'Parking, lounges and fast track at the airport you fly from.',
  }),
]);

/** Every product type Travelify's upsellsActive can name that we know about. */
const KNOWN = new Map(UPSELL_CATALOGUE.map((t) => [t.product, t]));

/** The tiles a customer can actually be shown, in order, when Travelify allows them. */
export const UPSELL_PRODUCTS = Object.freeze(
  UPSELL_CATALOGUE.filter((t) => t.status === 'live').map((t) => t.product));

/** Built, and waiting on one click against the live service. See above. */
export const AWAITING_PROOF = Object.freeze(
  UPSELL_CATALOGUE.filter((t) => t.status === 'unproved').map((t) => t.product));

/** Search type by product, for every tile in the catalogue. */
export const SEARCH_TYPE = Object.freeze(
  UPSELL_CATALOGUE.reduce((acc, t) => { acc[t.product] = t.st; return acc; }, {}));

/** What each tile says. Plain, warm, UK English, no exclamation marks. */
const COPY = new Map(UPSELL_CATALOGUE.map((t) => [t.product, { label: t.label, hint: t.hint }]));

/**
 * Travelify's `upsellsActive`, cleaned. Rules 4 and 5 of their spec: anything
 * but a non-empty array is none, and a value we do not know is dropped rather
 * than trusted, "new product types may be added in future and should not cause
 * errors or produce broken deeplinks". Order kept, duplicates dropped.
 */
export function activeUpsells(value) {
  if (!Array.isArray(value) || !value.length) return [];
  const out = [];
  for (const v of value) {
    const p = typeof v === 'string' ? v.trim() : '';
    if (p && KNOWN.has(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * Travelify's rule, exactly as their spec states it and nothing more: the
 * product types that may be offered on this order. "upsellsActive minus the
 * product types already present in items, except TicketsAttractions, which is
 * never removed by the existing purchase check."
 *
 * Read off `order.upsellsActive` on every call. /api/retrieve-order carries it
 * through from the order it has just fetched, and it is never stored, per the
 * spec: "active product types can change".
 */
export function allowedUpsells(order) {
  const active = activeUpsells(order && order.upsellsActive);
  if (!active.length) return [];
  const booked = bookedProducts(order);
  return active.filter((p) => KNOWN.get(p).repeatable || !booked.has(p));
}

/**
 * The order's own id and key, as the `orderRef` every upsell deeplink must end
 * with so a new purchase can be linked back to this booking: "123456/0CB5D0BC-
 * 51FE-4950-9201-E9AD792489F5".
 *
 * Travelify's spec, and it is specific about three things:
 *   - the id and the KEY, never the order record's own `orderRef` field
 *     ("DEMO123456"), which is the customer-facing reference and links nothing;
 *   - on EVERY upsell link, in the widget and in the email;
 *   - no id or no key means no link at all, "as the resulting purchase could
 *     not be linked to the order".
 *
 * Returns '' for anything that is not plainly an id and a key, so the tile is
 * dropped rather than sent with a reference that points nowhere.
 */
export function orderLinkRef(id, key) {
  const i = id == null ? '' : String(id).trim();
  const k = key == null ? '' : String(key).trim();
  if (!/^\d{1,15}$/.test(i)) return '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(k)) return '';
  return i + '/' + k;
}

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
  // Every item that CARRIES flights, not only the ones sold as Flights: a
  // package holiday (Jet2, TUI, EveryHoliday) is product 'Packages' with its
  // flights on item.flights, exactly where a flight-only booking keeps them.
  const flights = items.filter((it) => it && it.flights && typeof it.flights === 'object');

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
  // Airport extras are bought at the airport they fly FROM and last as long as
  // the car is parked, so they need the other two clocks: the moment they leave
  // and the moment they get back.
  let leaveAt = '';
  let backAt = '';
  // The two airports' country codes, when the segment carries them. Car hire
  // and airport extras both name a location by its IATA code, and a country
  // alongside it is what the deep linking document's own examples send.
  let originCountry = '';
  let destCountry = '';

  // THE SHAPE /api/retrieve-order ACTUALLY SENDS: item.flights.routes[], each
  // with its segments (trimFlights). Until 24 Sep 2026 this read item.legs, a
  // shape that exists only in the fixtures this file was first tested with, so
  // on every real booking it found no flight at all: no arrival airport, and so
  // no car hire tile, for any customer, from the day the section shipped. The
  // tests now use the real shape, taken from ET122149.
  for (const f of flights) {
    const legs = Array.isArray(f.flights.routes) ? f.flights.routes : [];
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
        leaveAt = clockOf(first.depart);
        arriveAt = clockOf(last && last.arrive);
        originCountry = countryCode(first.origin && first.origin.country);
        destCountry = countryCode(last && last.destination && last.destination.country);
      } else if (to && originIata && to === originIata) {
        inboundDate = dayOf(first.depart);
        departAt = clockOf(first.depart);
        backAt = clockOf(last && last.arrive);
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
    leaveAt,
    backAt,
    originCountry,
    destCountry,
    // Where the trip actually happens. The spec's location searches want a
    // NAME plus a country code ("loc=Barcelona&ctry=ES"), not an airport code,
    // so this comes off the accommodation's own location. A resort or state is
    // a better answer than a city when the feed carries one, for the same
    // reason it is in booking-destination.js: people book Costa del Sol, not
    // Malaga. Falls back to the airport, which the spec allows via loct.
    place: placeOf(order, destIata),
  };
}

/** A two-letter country code, or ''. A country NAME is not a code ("Maldives"). */
function countryCode(v) {
  const c = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(c) ? c : '';
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

/**
 * The Travelify deep linking spec's own limits, so a link is never rejected for
 * a number out of range: adt 1-9, chd 0-9, inf 0 to the number of adults.
 */
const MAX_ADULTS = 9;
const MAX_CHILDREN = 9;

/**
 * The age to search a child at when the booking genuinely does not say.
 *
 * It usually does. Travelify states an AGE on some products and a DATE OF BIRTH
 * on others, and /api/retrieve-order now reads whichever arrived and turns it
 * into whole years at the date they travel (`ageTravellers`), so what lands
 * here is the child's real age. This is the floor under that, for a supplier
 * record that carries neither.
 *
 * Even then, searching the right NUMBER of people at an assumed age beats
 * searching the wrong number of people, which is what the first version did: it
 * dropped every child it had no age for, so a family of four opened a search
 * for two. The customer lands on a live results page with the party on screen
 * and can change an age; they cannot add a child who was never in the search.
 *
 * 8 is the same figure the Travel Offers widget's own party picker starts a
 * child at, so the two agree. A real age always wins over it.
 */
export const CHILD_AGE_WHEN_UNKNOWN = 8;

/**
 * A traveller's age, when we have one.
 *
 * `age` is what the API sends: it has already read the supplier's age or date
 * of birth and counted the years to the travel date. The other two spellings
 * are for an order handed straight to this function in a test or a tool.
 */
function ageOf(person) {
  if (!person) return null;
  const raw = person.age != null ? person.age
    : (person.paxAge != null ? person.paxAge : person.childAge);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 17) return null;
  return Math.round(n);
}

/**
 * The people on this booking.
 *
 * `order.summary.travellers` is where they really are: /api/retrieve-order
 * builds it with `aggregateTravellers`, which reads every product's own list
 * and de-dupes the same person appearing on the hotel and the flight. An
 * earlier version of this file read `order.travellers`, a key no order has, so
 * every upsell search asked for the fallback two adults however many people
 * were actually going. `order.travellers` is kept as a second look only because
 * it is the shape a hand-written fixture reaches for.
 */
export function travellerList(order) {
  if (!order) return [];
  const summary = order.summary;
  if (summary && Array.isArray(summary.travellers) && summary.travellers.length) return summary.travellers;
  if (Array.isArray(order.travellers) && order.travellers.length) return order.travellers;
  // A booking whose summary came back empty may still have a hotel that knows
  // who is sleeping in the room.
  const items = Array.isArray(order.items) ? order.items : [];
  for (const it of items) {
    const guests = it && it.accommodation && it.accommodation.guests;
    if (Array.isArray(guests) && guests.length) return guests;
  }
  return [];
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * The party to search for: how many, and of which kind.
 *
 * Adults, children and infants are three different things to Travelify and to
 * the price. An infant is NOT a child: it has its own `inf` parameter, it needs
 * no age, and it is capped at one per adult. Counting infants as children, as
 * the first version did, both overstated the child count and searched a lap
 * infant as a seated eight-year-old.
 */
export function partySize(order) {
  const people = travellerList(order);
  let adults = 0;
  let children = 0;
  let infants = 0;
  const childAges = [];

  for (const p of people) {
    // Travelify types a traveller Adult / Child / Infant. An untyped traveller
    // is an adult, which is the same assumption the booking summary makes.
    const type = String((p && (p.type || p.paxType)) || 'Adult').toLowerCase();
    if (type.indexOf('infant') !== -1) { infants++; continue; }
    if (type.indexOf('child') !== -1 || type.indexOf('youth') !== -1) {
      children++;
      const age = ageOf(p);
      childAges.push(age == null ? CHILD_AGE_WHEN_UNKNOWN : age);
      continue;
    }
    adults++;
  }

  // No traveller list at all. A search still has to be for somebody, and two
  // adults is the deep link's own default, so say plainly that it was assumed
  // rather than counted.
  if (!adults && !children && !infants) {
    return { adults: 2, children: 0, infants: 0, childAges: [], counted: false };
  }
  // A list of children with no adult on it is a booking we have read wrong
  // rather than a party that can travel, and adt has a floor of 1 either way.
  if (!adults) adults = 1;

  adults = clamp(adults, 1, MAX_ADULTS);
  children = clamp(children, 0, MAX_CHILDREN);
  infants = clamp(infants, 0, adults);
  childAges.length = children;

  return { adults, children, infants, childAges, counted: true };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar day, YYYY-MM-DD, read from the UTC fields like every booking day here. */
function todayDay() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * True when a tile's search starts today or later.
 *
 * Andy, 25 Sep 2026: "You should not show upsell options for dates in the
 * past". Order 119221 (app 250) had a ticket whose date had passed. Its
 * Things to do link takes the stay's own days as fr/to, nothing here moves a
 * date, and the search Andy landed on was for a month ahead: Travelify's deep
 * linker evidently puts its own default in place of a past date. A link that
 * searches for something other than what the tile says is worse than no tile,
 * so the tile goes.
 *
 * Compared by CALENDAR DAY. A tile's `fr` is a booking day (a stay's check-in)
 * or an airport-local clock dressed as UTC (car hire's pickup), so its first
 * ten characters are the day as the booking states it, and they are compared
 * with today's day as a string. No Date is built from a booking value (the
 * booking-dates rule in CLAUDE.md). A search starting today is still offered.
 * A trip already under way has a start in the past and loses its tiles too.
 */
export function upsellStartsInTime(anchor, today) {
  const start = String((anchor && anchor.fr) || '').slice(0, 10);
  const day = (typeof today === 'string' && DAY_RE.test(today)) ? today : todayDay();
  return DAY_RE.test(start) && start >= day;
}

/**
 * The tiles to show, in order.
 *
 * @param order  a trimmed Travelify order, as /api/retrieve-order returns it
 * @param opts   { enabled: { TicketsAttractions: true, ... } } from the widget config,
 *               and `today` (YYYY-MM-DD) for the tests; the API leaves it out
 *
 * A tile is offered only when Travelify's upsellsActive allows it (see
 * allowedUpsells), and then dropped when our link for it is unproved, when the
 * client has switched it off, when the trip carries nothing to anchor its
 * search to, or when that search would start before today (upsellStartsInTime).
 * The last two are the difference between a useful link and a dead one.
 */
export function upsellTiles(order, opts = {}) {
  if (!order) return [];
  const enabled = (opts && opts.enabled) || {};
  // `include` is for the test: it builds a tile for a product that is in the
  // catalogue but not live, so its real URL can be read off and opened against
  // the service. It is never passed by the API, so it cannot reach a customer.
  const include = (opts && Array.isArray(opts.include)) ? opts.include : [];
  // Travelify's rule first. It is the only thing that can put a product on the
  // list; everything after it can only take one off.
  const allowed = allowedUpsells(order);
  if (!allowed.length) return [];
  const trip = tripShape(order);
  const party = partySize(order);
  const today = (opts && typeof opts.today === 'string' && DAY_RE.test(opts.today)) ? opts.today : todayDay();

  // Attractions and transfers work off the stay when there is one and the
  // flight when there is not, so a flight-only booking still gets offers.
  const fromDate = trip.checkIn || trip.outboundDate;
  const toDate = trip.checkOut || trip.inboundDate || fromDate;

  const tiles = [];
  // Catalogue order, so the tiles come out the same way round whatever order
  // Travelify happened to list them in.
  const wanted = UPSELL_CATALOGUE
    .filter((t) => allowed.includes(t.product))
    .filter((t) => t.status === 'live' || include.includes(t.product))
    .map((t) => t.product);
  for (const product of wanted) {
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
        anchor = { pup: trip.destIata, pupt: 'Airport', pupctry: (trip.place && trip.place.ctry) || trip.destCountry, fr: from, to };
      }
    } else if (product === 'Transfers') {
      // Read across from Car Rental, which is the nearest product the document
      // describes: a pickup, a dropoff, and a datetime on each. A transfer runs
      // from the airport they land at to where they are staying, so unlike car
      // hire the dropoff is a real second place rather than "back where you
      // started", and the document's own drp/drpctry/drpt carry it.
      // st=Transfers&pup=<iata>&pupt=Airport&drp=<place>&drpt=City&fr=&to=
      if (trip.destIata && trip.place && trip.arriveAt && trip.departAt) {
        anchor = {
          pup: trip.destIata, pupctry: trip.place.ctry, pupt: 'Airport',
          drp: trip.place.loc, drpctry: trip.place.ctry, drpt: trip.place.type,
          fr: trip.arriveAt, to: trip.departAt,
        };
      }
    } else if (product === 'AirportExtras') {
      // Parking, a lounge and fast track belong to the airport they FLY FROM
      // and to the whole time the car is parked: out on the outbound departure,
      // back on the inbound arrival. Not the week in Paris, which is the reason
      // each product states its own anchor rather than sharing the trip's.
      // The origin airport's country comes off the flight segment when it
      // carries one; without it, the document lets a location stand on its code
      // when the type says Airport.
      // st=AirportExtras&loc=<iata>&loct=Airport&fr=<datetime>&to=<datetime>
      if (trip.originIata && trip.leaveAt) {
        anchor = {
          loc: trip.originIata, ctry: trip.originCountry, loct: 'Airport',
          fr: trip.leaveAt, to: trip.backAt || trip.leaveAt,
        };
      }
    }

    if (!anchor) continue;   // nothing to search for beats a link that dead-ends
    if (!upsellStartsInTime(anchor, today)) continue;
    tiles.push({
      product,
      st: SEARCH_TYPE[product],
      label: COPY.get(product).label,
      hint: COPY.get(product).hint,
      ...anchor,
      adults: party.adults,
      children: party.children,
      infants: party.infants,
      childAges: party.childAges,
      partyCounted: party.counted,
    });
  }
  return tiles;
}

/**
 * One tile's Travelify deep link, on the CLIENT's own application.
 *
 * Returns '' without an appId, so the caller drops the tile rather than
 * sending a customer to somebody else's booking engine; and '' without the
 * order's id/key reference (orderLinkRef), because a purchase that cannot be
 * linked back to the booking is exactly what Travelify's spec forbids.
 */
export function upsellUrl(tile, appId, orderRef) {
  if (!tile || !appId || !tile.st) return '';
  // No id or no key, no link: Travelify's rule, because a purchase made through
  // it could not be linked back to this booking. See orderLinkRef.
  const ref = typeof orderRef === 'string' && /^\d{1,15}\/[A-Za-z0-9-]{8,64}$/.test(orderRef) ? orderRef : '';
  if (!ref) return '';
  const p = new URLSearchParams();
  p.set('st', tile.st);
  // Location, however this search type names it.
  if (tile.loc) { p.set('loc', tile.loc); if (tile.ctry) p.set('ctry', tile.ctry); if (tile.loct) p.set('loct', tile.loct); }
  if (tile.pup) { p.set('pup', tile.pup); if (tile.pupctry) p.set('pupctry', tile.pupctry); if (tile.pupt) p.set('pupt', tile.pupt); }
  // A transfer is dropped somewhere other than where it was picked up. Car hire
  // sends none and the document returns it to the pickup, which is right.
  if (tile.drp) { p.set('drp', tile.drp); if (tile.drpctry) p.set('drpctry', tile.drpctry); if (tile.drpt) p.set('drpt', tile.drpt); }
  if (tile.fr) p.set('fr', tile.fr);
  if (tile.to && tile.to !== tile.fr) p.set('to', tile.to);
  // The party, as three separate counts, because Travelify prices them as three
  // separate things. Adults always; children and infants only when there are
  // any, since the spec defaults both to zero.
  p.set('adt', String(tile.adults || 2));
  // Children need an AGE EACH, per the spec: "must specify an age for each
  // child searched". partySize has already filled any the booking did not state
  // with CHILD_AGE_WHEN_UNKNOWN, so the search is for the right number of
  // people either way and the customer can adjust an age on the results page.
  const ages = Array.isArray(tile.childAges) ? tile.childAges.filter((n) => Number.isFinite(n)) : [];
  if (tile.children && ages.length === tile.children) {
    p.set('chd', String(tile.children));
    for (const a of ages) p.append('chdage', String(a));
  }
  // An infant travels on a lap, has no age parameter and is capped at one per
  // adult. Counting one as a child would both overstate the children and price
  // a babe in arms as a seated eight-year-old.
  if (tile.infants) p.set('inf', String(tile.infants));
  const url = 'https://dl.tvllnk.com/deeplink/' + encodeURIComponent(String(appId)) + '?' + p.toString();
  // Last, and with the slash as it is. Travelify's spec puts orderRef "to the
  // end of the deeplink" and writes it `orderRef=123456/0CB5D0BC-...`; letting
  // URLSearchParams have it would send the slash as %2F. Both halves are
  // already held to digits, letters and hyphens by the check above, so nothing
  // here needs encoding.
  return url + (url.indexOf('?') === -1 ? '?' : '&') + 'orderRef=' + ref;

}
