/**
 * What else this traveller could book (23 Sep 2026).
 *
 * Andy: "add a section to a booking once a client logs in, which will upsell
 * them additional products related to their booking ... look at what products
 * are already booked and don't include those in the upsell options."
 *
 * The two things that make this right rather than merely present:
 *
 *   - it never offers what they already have, which is a set difference
 *     against the eight canonical products on the order rather than a guess;
 *   - each tile is built to Travelify's deep linking spec rather than to a
 *     guess at it. An earlier draft assumed the search types were the product
 *     names, which would have shipped two dead buttons, and anchored
 *     attractions on an airport code when the spec wants a location NAME and a
 *     country, and car hire on a date when it wants a datetime.
 *
 * Only two of the four Andy asked for can be built. The spec defines five
 * search types and none of them is transfers or airport extras.
 *
 * Run: node test/order-upsell-smoke.mjs   (npm run test:order-upsell)
 */
import { readFileSync } from 'node:fs';
import { upsellTiles, upsellUrl, bookedProducts, tripShape, partySize, travellerList,
  activeUpsells, allowedUpsells, orderLinkRef,
  UPSELL_PRODUCTS, UPSELL_CATALOGUE, AWAITING_PROOF, CHILD_AGE_WHEN_UNKNOWN } from '../public/_order-upsell.js';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '  — ' + detail : '')); }
};
const find = (tiles, p) => tiles.find((t) => t.product === p) || null;

/**
 * Travelify's own example order from the upsellsActive spec (24 Sep 2026): all
 * four active, id 123456, key 0CB5D0BC-.... Every fixture below carries the
 * list, because since that spec an order WITHOUT it offers nothing at all.
 */
const ALL_FOUR = ['CarRental', 'Transfers', 'AirportExtras', 'TicketsAttractions'];
const REF = orderLinkRef(123456, '0CB5D0BC-51FE-4950-9201-E9AD792489F5');

/** Andy's own example: a flight and hotel to Paris. */
// A flight route in THE SHAPE /api/retrieve-order SENDS (trimFlights):
// item.flights.routes[], each with a direction and its segments. The first
// version of these fixtures put routes at item.legs, a shape no real order has,
// and the module was written to match them; so every test passed while every
// real booking found no flight and no car hire tile. Taken from ET122149.
const leg = (from, to, depart, arrive) => ({ segments: [{ origin: { iataCode: from }, destination: { iataCode: to }, depart, arrive }] });
const flightsItem = (...routes) => ({ product: 'Flights', flights: { routes } });
const PARIS = {
  id: 123456,
  upsellsActive: ALL_FOUR,
  items: [
    flightsItem(
      leg('LHR', 'CDG', '2027-04-10T07:00:00', '2027-04-10T09:20:00'),
      leg('CDG', 'LHR', '2027-04-17T18:00:00', '2027-04-17T18:20:00')),
    { product: 'Accommodation', startDate: '2027-04-10T00:00:00',
      accommodation: { name: 'Hotel X', location: { city: 'Paris', country: 'FR' },
        units: [{ checkin: '2027-04-10', nights: 7 }] } },
  ],
  // The REAL shape. /api/retrieve-order puts the de-duped party on the summary;
  // no order has a top-level `travellers`, which is exactly what the first
  // version of this module read.
  summary: { travellers: [{ type: 'Adult' }, { type: 'Adult' }, { type: 'Child', age: 9 }] },
};

console.log('\nUpsell: what else could they book\n');

console.log("Andy's example, a flight and hotel to Paris");
{
  const tiles = upsellTiles(PARIS);
  ok('it knows what is already booked',
    [...bookedProducts(PARIS)].sort().join(',') === 'Accommodation,Flights');
  // Two, not four. Travelify's deep linking spec has no search type for
  // transfers or airport extras, so those two cannot be linked at all.
  ok('the two linkable additions are offered', tiles.length === 2, tiles.map((t) => t.product).join(', '));
  ok('and neither the flight nor the hotel is offered again',
    !find(tiles, 'Flights') && !find(tiles, 'Accommodation'));
  ok('transfers and airport extras are built and waiting on one click, not forgotten',
    AWAITING_PROOF.includes('Transfers') && AWAITING_PROOF.includes('AirportExtras'));
  ok('and neither is offered as a tile',
    !find(tiles, 'Transfers') && !find(tiles, 'AirportExtras'));

  const trip = tripShape(PARIS);
  ok('it reads the trip as LHR to CDG', trip.originIata === 'LHR' && trip.destIata === 'CDG');
  ok('and the dates off the stay, not a local parse',
    trip.checkIn === '2027-04-10' && trip.checkOut === '2027-04-17',
    JSON.stringify([trip.checkIn, trip.checkOut]));
  ok('it knows where they are staying, by name and country',
    trip.place && trip.place.loc === 'Paris' && trip.place.ctry === 'FR', JSON.stringify(trip.place));
  ok('and when they land and fly home, to the minute',
    trip.arriveAt === '2027-04-10T09:20' && trip.departAt === '2027-04-17T18:00',
    JSON.stringify([trip.arriveAt, trip.departAt]));

  ok('the party is carried through',
    partySize(PARIS).adults === 2 && partySize(PARIS).children === 1);
}

// ── The party ────────────────────────────────────────────────────────────────
// Andy, 23 Sep 2026: "the search should be for the correct amount of and type
// people in the party - not hard coded". It was hard coded, and not by
// intention: partySize read `order.travellers`, a key no real order carries, so
// the traveller loop ran over an empty list every time and fell straight
// through to its two-adult fallback. A family of five searched as a couple.
console.log('\nthe party, counted rather than assumed');
{
  ok('the travellers are found where the API really puts them',
    travellerList(PARIS).length === 3);
  const party = partySize(PARIS);
  ok('so two adults and a child are counted, not defaulted',
    party.adults === 2 && party.children === 1 && party.counted === true);

  const family = { ...PARIS, summary: { travellers: [
    { type: 'Adult' }, { type: 'Adult' }, { type: 'Adult' },
    { type: 'Child', age: 11 }, { type: 'Child', age: 6 }, { type: 'Infant' }] } };
  const f = partySize(family);
  ok('a party of six reads as three adults, two children and an infant',
    f.adults === 3 && f.children === 2 && f.infants === 1,
    JSON.stringify(f));
  // An infant is its own deep link parameter, needs no age and is capped at one
  // per adult. Counted as a child it would both overstate chd and price a babe
  // in arms as a seated eight-year-old.
  const url = upsellUrl(upsellTiles(family)[0], '474', REF);
  ok('and the link says so', /adt=3/.test(url) && /chd=2/.test(url) && /inf=1/.test(url), url);
  ok('with an age for each child, theirs and not ours',
    /chdage=11/.test(url) && /chdage=6/.test(url), url);

  ok('a lone traveller is searched as one adult, not two',
    partySize({ ...PARIS, summary: { travellers: [{ type: 'Adult' }] } }).adults === 1);
  ok('an untyped traveller counts as an adult',
    partySize({ ...PARIS, summary: { travellers: [{}, {}] } }).adults === 2);
  ok('more infants than adults is clamped to the spec\'s one each',
    partySize({ ...PARIS, summary: { travellers: [{ type: 'Adult' }, { type: 'Infant' }, { type: 'Infant' }] } }).infants === 1);
  ok('a party too big for the spec is clamped, not sent out of range',
    partySize({ ...PARIS, summary: { travellers: Array.from({ length: 14 }, () => ({ type: 'Adult' })) } }).adults === 9);

  // Where the list is genuinely missing, two adults is the deep link's own
  // default rather than a number we chose. It says so, so nobody reads it as a
  // count.
  const none = partySize({ items: [] });
  ok('an order with no traveller list falls back and admits it',
    none.adults === 2 && none.counted === false);
  ok('a hotel guest list stands in when the summary is empty',
    partySize({ items: [{ product: 'Accommodation',
      accommodation: { guests: [{ type: 'Adult' }, { type: 'Adult' }, { type: 'Adult' }] } }] }).adults === 3);
}

// ── Already booked ───────────────────────────────────────────────────────────
console.log('\nsomething they already have');
{
  const withCar = { ...PARIS, items: [...PARIS.items, { product: 'CarRental' }] };
  const tiles = upsellTiles(withCar);
  ok('a booked car hire is not offered again', !find(tiles, 'CarRental'));
  ok('the other one still is', tiles.length === 1);

  // Travelify's rule 3. Our first version dropped booked tickets like any other
  // product; their spec says keep offering them, "customers may want to buy
  // further tickets for other activities during their stay".
  const both = { ...PARIS, items: [...PARIS.items,
    { product: 'CarRental' }, { product: 'TicketsAttractions' }] };
  const left = upsellTiles(both);
  ok('a booking that has car hire AND tickets is still offered things to do',
    left.length === 1 && left[0].product === 'TicketsAttractions', left.map((t) => t.product).join(', '));
}

// ── The client's switches ────────────────────────────────────────────────────
console.log("\nthe client's own switches");
{
  const off = upsellTiles(PARIS, { enabled: { CarRental: false } });
  ok('a product switched off is not offered', !find(off, 'CarRental'));
  ok('the rest are unaffected', off.length === 1);
  ok('switching nothing off leaves both', upsellTiles(PARIS, { enabled: {} }).length === 2);
}

// ── Bookings that cannot anchor a search ─────────────────────────────────────
// A link that dead-ends is worse than no link, so a tile with nothing to search
// for is dropped rather than shipped pointing at nothing.
console.log('\nbookings with less to go on');
{
  const hotelOnly = {
    upsellsActive: ALL_FOUR,
    items: [{ product: 'Accommodation', startDate: '2027-04-10T00:00:00',
      accommodation: { name: 'Hotel X', location: { city: 'Paris', country: 'FR' },
        units: [{ checkin: '2027-04-10', nights: 3 }] } }],
    summary: { travellers: [{ type: 'Adult' }] },
  };
  const tiles = upsellTiles(hotelOnly);
  ok('a hotel with no flight still gets things to do', !!find(tiles, 'TicketsAttractions'));
  ok('but no car hire, having no airport to pick one up at', !find(tiles, 'CarRental'));

  const flightOnly = {
    upsellsActive: ALL_FOUR,
    items: [flightsItem(
      leg('MAN', 'ALC', '2027-06-01T06:00:00', '2027-06-01T09:30:00'),
      leg('ALC', 'MAN', '2027-06-08T20:00:00', '2027-06-08T21:40:00'))],
    summary: { travellers: [{ type: 'Adult' }, { type: 'Adult' }] },
  };
  const f = upsellTiles(flightOnly);
  ok('a flight with no hotel gets both', f.length === 2, f.map((t) => t.product).join(', '));
  ok('its car hire is picked up when they land', find(f, 'CarRental').fr === '2027-06-01T09:30');
  ok('and dropped off when they fly home', find(f, 'CarRental').to === '2027-06-08T20:00');
  // No accommodation means no city, so the airport stands in as the location,
  // which the spec allows through the location type.
  ok('with no hotel, the airport is the place', find(f, 'TicketsAttractions').loc === 'ALC');
  ok('and it says so, so the lookup is right', find(f, 'TicketsAttractions').loct === 'Airport');

  ok('an empty order offers nothing', upsellTiles({ items: [] }).length === 0);
  ok('a missing order does not throw', upsellTiles(null).length === 0);
}

// ── The link ─────────────────────────────────────────────────────────────────
console.log('\nthe deep link, against Travelify\'s own examples');
{
  const tiles = upsellTiles(PARIS);

  // Spec: st=TicketsAttractions&loc=Barcelona&ctry=ES&fr=...&to=...&adt=2
  const things = upsellUrl(find(tiles, 'TicketsAttractions'), '474', REF);
  ok('attractions go to the client\'s own application', things.indexOf('/deeplink/474?') !== -1, things);
  ok('attractions search a location NAME and country, not an airport code',
    things.indexOf('loc=Paris') !== -1 && things.indexOf('ctry=FR') !== -1, things);
  ok('across the dates they are there',
    things.indexOf('fr=2027-04-10') !== -1 && things.indexOf('to=2027-04-17') !== -1);

  // Spec: st=CarRental&pup=BCN&pupctry=ES&pupt=Airport&fr=<datetime>&to=<datetime>
  const car = upsellUrl(find(tiles, 'CarRental'), '474', REF);
  ok('car hire uses a PICKUP, not a destination', car.indexOf('pup=CDG') !== -1, car);
  ok('and says it is an airport, so the code resolves', car.indexOf('pupt=Airport') !== -1);
  ok('its dates are datetimes, as the spec requires',
    /fr=2027-04-10T09%3A20/.test(car) && /to=2027-04-17T18%3A00/.test(car), car);

  // "must specify an age for each child searched" — without every age the
  // search is invalid, so it goes adults-only rather than being rejected.
  ok('a child with a known age is searched for',
    things.indexOf('chd=1') !== -1 && things.indexOf('chdage=9') !== -1, things);
  // Travelify's order carries a traveller's TYPE and usually no age, and the
  // spec will not take a child without one. Searching the right number of
  // people at an assumed age beats searching the wrong number of people: the
  // first version dropped every ageless child, so a family of four opened a
  // search for two. The customer can change an age on the results page; they
  // cannot add a child who was never in the search.
  const noAge = { ...PARIS, summary: { travellers: [{ type: 'Adult' }, { type: 'Child' }] } };
  const bare = upsellUrl(upsellTiles(noAge)[0], '474', REF);
  ok('a child with no stated age is still searched for',
    bare.indexOf('chd=1') !== -1, bare);
  ok('at the one assumed age, stated once so it can be found',
    bare.indexOf('chdage=' + CHILD_AGE_WHEN_UNKNOWN) !== -1, bare);
  ok('and a real age always beats the assumption',
    /chdage=9/.test(upsellUrl(upsellTiles(PARIS)[0], '474', REF)));
  ok('nobody is invited who is not on the booking',
    bare.indexOf('inf=') === -1, bare);

  ok('no application id means no link', upsellUrl(find(tiles, 'CarRental'), '', REF) === '');
  ok('no tile means no link', upsellUrl(null, '474', REF) === '');
}

// ── A real booking, in the real shape ────────────────────────────────────────
// ET122149, Exclusively Travel: Luton to Rhodes and back, flights only, as the
// booking-dates suite carries it. Travelify dresses the airport-local times as
// UTC ("...Z"), and bookingMoment reads those fields straight back.
console.log('\na real booking in the shape retrieve-order sends');
{
  const route = (direction, from, to, depart, arrive, country) => ({ legID: 0, direction, duration: 255,
    segments: [{ origin: { iataCode: from, name: from, country: country[0] }, destination: { iataCode: to, name: to, country: country[1] },
      depart, arrive, cabinClass: 'Economy', marketingCarrier: { code: 'U2', name: 'Easyjet' }, flightNo: 'EZY2381' }] });
  const ET122149 = {
    id: 122149, upsellsActive: ALL_FOUR,
    summary: { travellers: [{ type: 'Adult', title: 'Mrs', firstname: 'Gillian', surname: 'Clark' }] },
    items: [{ id: 111089, product: 'Flights', startDate: '2026-10-02T00:00:00', duration: 14,
      flights: { fareType: 'LowCost', routes: [
        route('Outbound', 'LTN', 'RHO', '2026-10-02T12:55:00Z', '2026-10-02T19:10:00Z', ['GB', 'GR']),
        route('Inbound', 'RHO', 'LTN', '2026-10-16T19:55:00Z', '2026-10-16T22:20:00Z', ['GR', 'GB'])] } }],
  };
  const trip = tripShape(ET122149);
  ok('it finds the flight where the order really keeps it', trip.originIata === 'LTN' && trip.destIata === 'RHO', JSON.stringify(trip));
  ok('and the clocks on it, read from the UTC fields', trip.arriveAt === '2026-10-02T19:10' && trip.departAt === '2026-10-16T19:55');
  const car = find(upsellTiles(ET122149), 'CarRental');
  ok('so a real booking is offered car hire, which none was before 24 Sep', !!car);
  ok('picked up at Rhodes, with the country the segment carries', car && car.pup === 'RHO' && car.pupctry === 'GR', JSON.stringify(car));
  const extras = find(upsellTiles(ET122149, { include: ['AirportExtras'] }), 'AirportExtras');
  ok('and airport extras would be at Luton, in GB', extras && extras.loc === 'LTN' && extras.ctry === 'GB', JSON.stringify(extras));

  // A package holiday keeps its flights on item.flights under product
  // 'Packages', exactly where a flight booking does.
  const pkg = { ...ET122149, items: [{ ...ET122149.items[0], product: 'Packages' }] };
  ok('a package holiday\'s flights are found too', tripShape(pkg).destIata === 'RHO');

  // The drift that hid this: the module and the trimmer must agree on where
  // flights live.
  const api = readFileSync(new URL('../api/retrieve-order.js', import.meta.url), 'utf8');
  const mod = readFileSync(new URL('../public/_order-upsell.js', import.meta.url), 'utf8');
  ok('the trimmer sends flights as routes, and the module reads routes',
    /routes: Array\.isArray\(d\.routes\)/.test(api) && /f\.flights\.routes/.test(mod) && !/\bf\.legs\b/.test(mod));
}

// ── Travelify's rule, against their own table ────────────────────────────────
// "Orders API: upsellsActive field", 24 Sep 2026. allowedUpsells is their rule
// and nothing else, so it is held to their worked example row for row, before
// any gate of ours gets a say.
console.log("\nTravelify's upsellsActive rule, against the table in their spec");
{
  const order = (items) => ({ id: 123456, upsellsActive: ALL_FOUR, items: items.map((p) => ({ product: p })) });
  const same = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');

  ok('nothing booked: all four',
    same(allowedUpsells(order([])), ['CarRental', 'Transfers', 'AirportExtras', 'TicketsAttractions']));
  ok('transfers booked: car hire, airport extras and tickets',
    same(allowedUpsells(order(['Transfers'])), ['CarRental', 'AirportExtras', 'TicketsAttractions']));
  ok('tickets booked: all four still, because tickets are never removed',
    same(allowedUpsells(order(['TicketsAttractions'])), ALL_FOUR));
  ok('all four booked: tickets and nothing else',
    same(allowedUpsells(order(ALL_FOUR)), ['TicketsAttractions']));

  ok('a product not in upsellsActive is never offered, booked or not',
    !allowedUpsells({ upsellsActive: ['CarRental'], items: [] }).includes('TicketsAttractions'));
  ok('upsellsActive missing: nothing', allowedUpsells({ items: [] }).length === 0);
  ok('upsellsActive null: nothing', allowedUpsells({ upsellsActive: null, items: [] }).length === 0);
  ok('upsellsActive empty: nothing', allowedUpsells({ upsellsActive: [], items: [] }).length === 0);
  ok('a value we do not know is ignored, not an error',
    activeUpsells(['CarRental', 'Cruises', 42, null, '']).join(',') === 'CarRental');
  ok('a value named twice counts once', activeUpsells(['CarRental', 'CarRental']).length === 1);
  ok('not an array at all: nothing, and no throw', activeUpsells('CarRental').length === 0);

  // And the whole pipeline agrees with it, so no gate of ours can ADD a
  // product Travelify did not allow.
  ok('a booking whose application sells nothing gets no tiles',
    upsellTiles({ ...PARIS, upsellsActive: [] }).length === 0);
  ok('a booking whose application sells only car hire is offered only car hire',
    upsellTiles({ ...PARIS, upsellsActive: ['CarRental'] }).map((t) => t.product).join(',') === 'CarRental');
  ok('a booking from before the field existed offers nothing, per rule 4',
    upsellTiles({ ...PARIS, upsellsActive: undefined }).length === 0);
}

// ── The order reference ──────────────────────────────────────────────────────
// Every upsell link ends ?orderRef={id}/{key} (or &orderRef= where there is
// already a query string), so what is bought through it is linked back to this
// booking.
console.log('\nevery link carries the order reference');
{
  ok('it is the id and the key, joined with a slash',
    REF === '123456/0CB5D0BC-51FE-4950-9201-E9AD792489F5', REF);
  const url = upsellUrl(find(upsellTiles(PARIS), 'CarRental'), '474', REF);
  ok('it is the LAST thing on the link', url.endsWith('&orderRef=123456/0CB5D0BC-51FE-4950-9201-E9AD792489F5'), url);
  ok('with the slash as the spec writes it, not %2F', !/orderRef=[^&]*%2F/.test(url));
  ok('joined with & because the link already has a query string', /\?st=/.test(url) && /&orderRef=/.test(url));
  ok('and there is only one of it', (url.match(/orderRef=/g) || []).length === 1);

  // "Do not use orderRef from the order record (for example DEMO123456)".
  ok('the customer-facing reference is refused as the id', orderLinkRef('DEMO123456', 'ABCDEF12-0000') === '');
  ok('no id, no link', orderLinkRef(null, '0CB5D0BC-51FE-4950-9201-E9AD792489F5') === '');
  ok('no key, no link', orderLinkRef(123456, '') === '' && orderLinkRef(123456, undefined) === '');
  ok('a key with anything but letters, digits and hyphens is refused, not escaped',
    orderLinkRef(123456, 'abc/../def') === '' && orderLinkRef(123456, 'a b c d e f g h') === '');
  ok('a tile without the reference has no link, so it is dropped',
    upsellUrl(find(upsellTiles(PARIS), 'CarRental'), '474', '') === ''
    && upsellUrl(find(upsellTiles(PARIS), 'CarRental'), '474') === '');
}

// ── The two built and waiting on one click ───────────────────────────────────
// 23 Sep 2026: Andy opened both links on a real application and the deep linker
// refused each by name, {"success":false,"error":"Search type Transfers is not
// currently supported by deep linker"}. 24 Sep 2026: Travelify's upsellsActive
// spec names both as products whose deeplinks "can be shown", so the refusal
// may be stale. Their spec can say the client sells transfers; it cannot say
// OUR transfer parameters are right, which were read across from Car Rental.
// So they stay off until a link lands on a search, and these are those links.
console.log('\nbuilt, allowed by Travelify, and waiting on one click');
{
  const pending = upsellTiles(PARIS, { include: ['Transfers', 'AirportExtras'] });
  const transfer = find(pending, 'Transfers');
  const extras = find(pending, 'AirportExtras');

  ok('both are waiting on proof, and the history is kept in the module rather than a status',
    AWAITING_PROOF.join(',') === 'Transfers,AirportExtras');

  ok('a transfer runs from the airport they land at',
    transfer && transfer.pup === 'CDG' && transfer.pupt === 'Airport', JSON.stringify(transfer));
  ok('to where they are staying, which is a real second place',
    transfer && transfer.drp === 'Paris' && transfer.drpt === 'City');
  ok('picked up when they land and returning when they fly home',
    transfer && transfer.fr === '2027-04-10T09:20' && transfer.to === '2027-04-17T18:00');

  // Andy's own reason for a per-product anchor: "airport parking belongs to the
  // OUTBOUND date at the UK airport, not to the week in Paris".
  ok('airport extras belong to the airport they fly FROM',
    extras && extras.loc === 'LHR' && extras.loct === 'Airport', JSON.stringify(extras));
  ok('and last from leaving to getting back, not the stay',
    extras && extras.fr === '2027-04-10T07:00' && extras.to === '2027-04-17T18:20');

  ok('neither reaches a customer until its link is proved, even when Travelify allows it',
    !find(upsellTiles(PARIS), 'Transfers') && !find(upsellTiles(PARIS), 'AirportExtras'));
  ok('and "include" cannot override Travelify: not active, not built',
    !find(upsellTiles({ ...PARIS, upsellsActive: ['CarRental'] }, { include: ['Transfers'] }), 'Transfers'));

  console.log('\n    Open these, each on a real application ID in place of 474:');
  console.log('    Transfers     ' + upsellUrl(transfer, '474', REF));
  console.log('    AirportExtras ' + upsellUrl(extras, '474', REF) + '\n');
}

// ── The shape of the list itself ─────────────────────────────────────────────
console.log('the list');
{
  ok('two of the four products are live and shown', UPSELL_PRODUCTS.length === 2);
  ok('all four are in the catalogue, so none is quietly dropped', UPSELL_CATALOGUE.length === 4);
  ok('every one of them carries a search type, a label and a hint',
    UPSELL_CATALOGUE.every((t) => t.st && t.label && t.hint));
  ok('none of them is the booking itself',
    !UPSELL_PRODUCTS.includes('Flights') && !UPSELL_PRODUCTS.includes('Accommodation')
    && !UPSELL_PRODUCTS.includes('Packages'));
  const tiles = upsellTiles(PARIS);
  ok('every tile carries a label and a hint for the page',
    tiles.every((t) => t.label && t.hint && t.label.length > 2));
}

// ── The section on the page ──────────────────────────────────────────────────
// The widget draws what the API hands it and decides nothing, so what matters
// here is that it draws it safely and in the right place.
console.log('\nthe section on the booking page');
{
  const widget = readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8');
  ok('the widget keeps the tiles the API sent', /upsell: Array\.isArray\(data\.upsell\)/.test(widget));
  ok('it sits between the booking and the support block',
    /renderAmendSection\(order, c\)\}\s*\n\s*\$\{renderUpsell\(upsell, c\)\}/.test(widget));
  ok('every link is escaped and whitelisted, not pasted in raw',
    /esc\(safeUrl\(t\.url\)\)/.test(widget));

  // Andy, 23 Sep 2026: "make the tiles look a bit more like buttons" and "add a
  // relevant icon to each box". Both are answered by making the tile the SAME
  // button the page already uses for Download PDF and Request a change, rather
  // than a second one that only nearly matches it.
  ok('a tile is the page\'s own action button',
    /<a class="tgm-action tgm-upsell-card"/.test(widget));
  ok('with the icon chip, the title, the sub-line and the arrow that button has',
    /tgm-action-icon/.test(widget) && /tgm-action-title/.test(widget)
    && /tgm-action-sub/.test(widget) && /svg\(IC\.arrow\)/.test(widget));
  ok('each product has its own icon', /TicketsAttractions: IC\.ticket/.test(widget) && /CarRental: IC\.car/.test(widget));
  ok('including the two Travelify refuses, so they arrive drawn',
    /Transfers: IC\.van/.test(widget) && /AirportExtras: IC\.lounge/.test(widget));
  ok('an unknown product still gets an icon rather than a gap',
    /UPSELL_IC\[t\.product\] \|\| IC\.search/.test(widget));

  // Tokens only. --tgm-surface and --tgm-muted have never existed in this
  // widget, so every use of them fell through to a light-mode fallback and the
  // section stayed white behind a dark-theme booking.
  ok('the section is themed from tokens this widget actually defines',
    !/tgm-upsell[^\n]*--tgm-surface/.test(widget) && !/tgm-upsell[^\n]*--tgm-muted/.test(widget));
  ok('links open in a new tab so the booking is not lost',
    /target="_blank" rel="noopener noreferrer"/.test(widget));
  ok('the label and hint are escaped too',
    /esc\(t\.label\)/.test(widget) && /esc\(t\.hint\)/.test(widget));
  ok('no tiles means no section at all',
    /if \(!Array\.isArray\(tiles\) \|\| !tiles\.length\) return ''/.test(widget));
  ok('the client can switch the whole section off',
    /c\.display\.showUpsell === false/.test(widget));
  // The age itself is owned by test:traveller-age; what matters here is that
  // the order carries one at all, so the tiles are not left assuming.
  const api2 = readFileSync(new URL('../api/retrieve-order.js', import.meta.url), 'utf8');
  ok('a traveller\'s age or date of birth is read off the order, not dropped at the trim',
    (api2.match(/\.\.\.rawAgeFields\(/g) || []).length === 4);
  ok('and it becomes an age before anything is sent', /ageTravellers\(items\);/.test(api2));

  const api = readFileSync(new URL('../api/retrieve-order.js', import.meta.url), 'utf8');
  ok('the API builds the tiles, so the widget has no second copy of the rules',
    /upsellTiles\(order/.test(api) && !/upsellTiles\(/.test(widget));
  ok('a tile with no link is dropped rather than drawn dead',
    /\.filter\(\(t\) => t\.url\)/.test(api));
  ok('the booking still loads if the upsell throws',
    /upsell failed, booking returned without it/.test(api));
  ok('the widget config is hoisted, not read where it is out of scope',
    /let widgetConfig = \{\};/.test(api));

  const editor = readFileSync(new URL('../public/editor-mybooking.html', import.meta.url), 'utf8');
  // Tied to the proved list on purpose: flip a tile to `proved: true` without
  // giving it a switch here and this fails, rather than shipping a tile the
  // client cannot turn off.
  ok('the editor has a switch per product a customer can be shown',
    (editor.match(/data-upsell="/g) || []).length === UPSELL_PRODUCTS.length);
  ok('and a switch for each one, by name',
    UPSELL_PRODUCTS.every((p) => editor.includes('data-upsell="' + p + '"')));
  ok('and one for the section itself', /data-display="showUpsell"/.test(editor));
  ok('a config saved before this existed still gets the section',
    /sw\.classList\.toggle\('on', v !== false\)/.test(editor));
}

// ── The same tiles in the email ──────────────────────────────────────────────
// Travelify: "apply the same rules consistently in emails and in order view
// widgets/apps, so the customer sees the same upsell options in both places".
// The email does not work them out again. /api/booking-email reads the booking
// through /api/retrieve-order, which has already built the tiles, and hands
// that same list to the renderer.
console.log('\nthe same tiles, in the email');
{
  const { renderBookingEmail, EMAIL_BLOCKS, DEFAULT_EMAIL_LAYOUT } = await import('../public/_booking-email-template.js');
  const tiles = upsellTiles(PARIS).map((t) => ({ product: t.product, label: t.label, hint: t.hint, url: upsellUrl(t, '474', REF) }));
  const order = { id: 123456, status: 'Confirmed', customerFirstname: 'Claire', currency: 'GBP', items: PARIS.items, summary: PARIS.summary };
  const render = (layout, upsell) => renderBookingEmail({ order, brand: { name: 'Sample Travel' }, layout, upsell, orderRef: 'X' }).html;

  ok('the email has an "Add to your trip" block', EMAIL_BLOCKS.some((b) => b.type === 'upsell' && b.kind === 'data'));
  const html = render([{ type: 'greeting' }, { type: 'upsell' }, { type: 'signoff' }], tiles);
  ok('it draws every tile the booking page is offering',
    tiles.every((t) => html.includes(t.label)), tiles.map((t) => t.label).join(', '));
  ok('with the very same links, order reference and all',
    tiles.every((t) => html.includes(t.url.replace(/&/g, '&amp;'))));
  ok('nothing to offer, nothing drawn',
    !render([{ type: 'upsell' }], []).includes('Add to your trip')
    && !render([{ type: 'upsell' }], undefined).includes('Add to your trip'));
  ok('a link that is not https is dropped, even from our own API',
    !render([{ type: 'upsell' }], [{ product: 'CarRental', label: 'Car hire', hint: '', url: 'http://dl.tvllnk.com/x' }]).includes('Car hire')
    && !render([{ type: 'upsell' }], [{ product: 'CarRental', label: 'Car hire', hint: '', url: 'javascript:alert(1)' }]).includes('javascript:'));
  ok('a label is escaped, not pasted in',
    render([{ type: 'upsell' }], [{ product: 'CarRental', label: '<b>x</b>', hint: '', url: tiles[0].url }]).includes('&lt;b&gt;'));

  // Andy, 24 Sep 2026: in everyone's email by default ("yes please"), where it
  // sits on the page, after the booking and before the contact details.
  ok('the built-in email carries it, just before the contact details',
    DEFAULT_EMAIL_LAYOUT.map((b) => b.type).indexOf('upsell')
      === DEFAULT_EMAIL_LAYOUT.map((b) => b.type).indexOf('support') - 1);
  ok('so a client who never opens the builder still offers it',
    render(undefined, tiles).includes('Add to your trip'));

  const sender = readFileSync(new URL('../api/booking-email.js', import.meta.url), 'utf8');
  ok('the real send hands over the tiles retrieve-order built, rather than building its own',
    /upsell: Array\.isArray\(retrieveData\?\.upsell\) \? retrieveData\.upsell : \[\]/.test(sender)
    && !/upsellTiles\(/.test(sender));
  const preview = readFileSync(new URL('../api/admin/booking-email-preview.js', import.meta.url), 'utf8');
  ok('and so does the staff preview', /looked\?\.upsell/.test(preview) && /\n\s+upsell,\n/.test(preview));
  const editor = readFileSync(new URL('../public/editor-mybooking.html', import.meta.url), 'utf8');
  ok('and the editor preview draws sample tiles, so a client adding the block sees it',
    (editor.match(/upsell: MOCK_UPSELL,/g) || []).length === 2);
}

// ── The key goes in the link and nowhere else ────────────────────────────────
console.log('\nthe order key');
{
  const api = readFileSync(new URL('../api/retrieve-order.js', import.meta.url), 'utf8');
  ok('the reference is built from the raw order\'s id and key', /orderLinkRef\(raw\.id, raw\.key\)/.test(api));
  ok('and the key is never added to the order the widget, PDF and email pass around',
    !/^\s+key:/m.test(api.slice(api.indexOf('function trimOrder('), api.indexOf('function computeSummary('))));
  ok('upsellsActive is carried through, fresh on every fetch', /upsellsActive: Array\.isArray\(raw\.upsellsActive\)/.test(api));
  const shape = readFileSync(new URL('../api/admin/order-shape.js', import.meta.url), 'utf8');
  ok('the staff inspector reports upsellsActive, and only WHETHER a key is there',
    /upsellsActive:/.test(shape) && /hasKey:/.test(shape) && !/key: r\.key/.test(shape));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
