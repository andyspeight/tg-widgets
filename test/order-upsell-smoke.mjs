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
import { upsellTiles, upsellUrl, bookedProducts, tripShape, partySize, UPSELL_PRODUCTS, NOT_DEEPLINKABLE } from '../public/_order-upsell.js';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '  — ' + detail : '')); }
};
const find = (tiles, p) => tiles.find((t) => t.product === p) || null;

/** Andy's own example: a flight and hotel to Paris. */
const leg = (from, to, depart, arrive) => ({ segments: [{ origin: { iataCode: from }, destination: { iataCode: to }, depart, arrive }] });
const PARIS = {
  id: 'TG1',
  items: [
    { product: 'Flights', legs: [
      leg('LHR', 'CDG', '2027-04-10T07:00:00', '2027-04-10T09:20:00'),
      leg('CDG', 'LHR', '2027-04-17T18:00:00', '2027-04-17T18:20:00')] },
    { product: 'Accommodation', startDate: '2027-04-10T00:00:00',
      accommodation: { name: 'Hotel X', location: { city: 'Paris', country: 'FR' },
        units: [{ checkin: '2027-04-10', nights: 7 }] } },
  ],
  travellers: [{ type: 'Adult' }, { type: 'Adult' }, { type: 'Child', age: 9 }],
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
  ok('transfers and airport extras are recorded as not linkable, not forgotten',
    !!NOT_DEEPLINKABLE.Transfers && !!NOT_DEEPLINKABLE.AirportExtras);
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

// ── Already booked ───────────────────────────────────────────────────────────
console.log('\nsomething they already have');
{
  const withCar = { ...PARIS, items: [...PARIS.items, { product: 'CarRental' }] };
  const tiles = upsellTiles(withCar);
  ok('a booked car hire is not offered again', !find(tiles, 'CarRental'));
  ok('the other one still is', tiles.length === 1);

  const both = { ...PARIS, items: [...PARIS.items,
    { product: 'CarRental' }, { product: 'TicketsAttractions' }] };
  ok('a booking with everything gets no tiles at all', upsellTiles(both).length === 0);
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
    items: [{ product: 'Accommodation', startDate: '2027-04-10T00:00:00',
      accommodation: { name: 'Hotel X', location: { city: 'Paris', country: 'FR' },
        units: [{ checkin: '2027-04-10', nights: 3 }] } }],
    travellers: [{ type: 'Adult' }],
  };
  const tiles = upsellTiles(hotelOnly);
  ok('a hotel with no flight still gets things to do', !!find(tiles, 'TicketsAttractions'));
  ok('but no car hire, having no airport to pick one up at', !find(tiles, 'CarRental'));

  const flightOnly = {
    items: [{ product: 'Flights', legs: [
      leg('MAN', 'ALC', '2027-06-01T06:00:00', '2027-06-01T09:30:00'),
      leg('ALC', 'MAN', '2027-06-08T20:00:00', '2027-06-08T21:40:00')] }],
    travellers: [{ type: 'Adult' }, { type: 'Adult' }],
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
  const things = upsellUrl(find(tiles, 'TicketsAttractions'), '474');
  ok('attractions go to the client\'s own application', things.indexOf('/deeplink/474?') !== -1, things);
  ok('attractions search a location NAME and country, not an airport code',
    things.indexOf('loc=Paris') !== -1 && things.indexOf('ctry=FR') !== -1, things);
  ok('across the dates they are there',
    things.indexOf('fr=2027-04-10') !== -1 && things.indexOf('to=2027-04-17') !== -1);

  // Spec: st=CarRental&pup=BCN&pupctry=ES&pupt=Airport&fr=<datetime>&to=<datetime>
  const car = upsellUrl(find(tiles, 'CarRental'), '474');
  ok('car hire uses a PICKUP, not a destination', car.indexOf('pup=CDG') !== -1, car);
  ok('and says it is an airport, so the code resolves', car.indexOf('pupt=Airport') !== -1);
  ok('its dates are datetimes, as the spec requires',
    /fr=2027-04-10T09%3A20/.test(car) && /to=2027-04-17T18%3A00/.test(car), car);

  // "must specify an age for each child searched" — without every age the
  // search is invalid, so it goes adults-only rather than being rejected.
  ok('a child with a known age is searched for',
    things.indexOf('chd=1') !== -1 && things.indexOf('chdage=9') !== -1, things);
  const noAge = { ...PARIS, travellers: [{ type: 'Adult' }, { type: 'Child' }] };
  const bare = upsellUrl(upsellTiles(noAge)[0], '474');
  ok('a child with no age is left out rather than sent without one',
    bare.indexOf('chd=') === -1 && bare.indexOf('chdage') === -1, bare);

  ok('no application id means no link', upsellUrl(find(tiles, 'CarRental'), '') === '');
  ok('no tile means no link', upsellUrl(null, '474') === '');
}

// ── The shape of the list itself ─────────────────────────────────────────────
console.log('\nthe list');
{
  ok('exactly two products can be deep linked', UPSELL_PRODUCTS.length === 2);
  ok('none of them is the booking itself',
    !UPSELL_PRODUCTS.includes('Flights') && !UPSELL_PRODUCTS.includes('Accommodation')
    && !UPSELL_PRODUCTS.includes('Packages'));
  const tiles = upsellTiles(PARIS);
  ok('every tile carries a label and a hint for the page',
    tiles.every((t) => t.label && t.hint && t.label.length > 2));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
