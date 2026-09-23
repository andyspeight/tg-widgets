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
 *   - each tile searches its OWN dates. Airport extras are the one that is not
 *     at the destination: parking, a lounge and fast track all happen at the
 *     airport they fly FROM. A tile that searches Paris for airport parking is
 *     worse than no tile.
 *
 * Run: node test/order-upsell-smoke.mjs   (npm run test:order-upsell)
 */
import { upsellTiles, upsellUrl, bookedProducts, tripShape, partySize, UPSELL_PRODUCTS } from '../public/_order-upsell.js';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '  — ' + detail : '')); }
};
const find = (tiles, p) => tiles.find((t) => t.product === p) || null;

/** Andy's own example: a flight and hotel to Paris. */
const leg = (from, to, depart) => ({ segments: [{ origin: { iataCode: from }, destination: { iataCode: to }, depart }] });
const PARIS = {
  id: 'TG1',
  items: [
    { product: 'Flights', legs: [leg('LHR', 'CDG', '2027-04-10T07:00:00'), leg('CDG', 'LHR', '2027-04-17T18:00:00')] },
    { product: 'Accommodation', startDate: '2027-04-10T00:00:00',
      accommodation: { name: 'Hotel X', units: [{ checkin: '2027-04-10', nights: 7 }] } },
  ],
  travellers: [{ type: 'Adult' }, { type: 'Adult' }, { type: 'Child' }],
};

console.log('\nUpsell: what else could they book\n');

console.log("Andy's example, a flight and hotel to Paris");
{
  const tiles = upsellTiles(PARIS);
  ok('it knows what is already booked',
    [...bookedProducts(PARIS)].sort().join(',') === 'Accommodation,Flights');
  ok('all four additions are offered', tiles.length === 4, tiles.map((t) => t.product).join(', '));
  ok('and neither the flight nor the hotel is offered again',
    !find(tiles, 'Flights') && !find(tiles, 'Accommodation'));
  ok('things to do comes first', tiles[0] && tiles[0].product === 'TicketsAttractions');

  const trip = tripShape(PARIS);
  ok('it reads the trip as LHR to CDG', trip.originIata === 'LHR' && trip.destIata === 'CDG');
  ok('and the dates off the stay, not a local parse',
    trip.checkIn === '2027-04-10' && trip.checkOut === '2027-04-17',
    JSON.stringify([trip.checkIn, trip.checkOut]));

  ok('things to do searches the destination', find(tiles, 'TicketsAttractions').dst === 'CDG');
  ok('car hire is picked up at the destination', find(tiles, 'CarRental').dst === 'CDG');
  ok('transfers are at the destination', find(tiles, 'Transfers').dst === 'CDG');
  // The whole point of per-product dates.
  ok('airport extras are at the airport they fly FROM, not the one they fly to',
    find(tiles, 'AirportExtras').dst === 'LHR', find(tiles, 'AirportExtras').dst);
  ok('airport extras start on the outbound day',
    find(tiles, 'AirportExtras').from === '2027-04-10');

  ok('the party is carried through', partySize(PARIS).adults === 2 && partySize(PARIS).children === 1);
}

// ── Already booked ───────────────────────────────────────────────────────────
console.log('\nsomething they already have');
{
  const withCar = { ...PARIS, items: [...PARIS.items, { product: 'CarRental' }] };
  const tiles = upsellTiles(withCar);
  ok('a booked car hire is not offered again', !find(tiles, 'CarRental'));
  ok('the other three still are', tiles.length === 3);

  const allFour = { ...PARIS, items: [...PARIS.items,
    { product: 'CarRental' }, { product: 'Transfers' },
    { product: 'TicketsAttractions' }, { product: 'AirportExtras' }] };
  ok('a booking with everything gets no tiles at all', upsellTiles(allFour).length === 0);
}

// ── The client's switches ────────────────────────────────────────────────────
console.log("\nthe client's own switches");
{
  const off = upsellTiles(PARIS, { enabled: { CarRental: false, Transfers: false } });
  ok('a product switched off is not offered', !find(off, 'CarRental') && !find(off, 'Transfers'));
  ok('the rest are unaffected', off.length === 2);
  ok('switching nothing off leaves all four', upsellTiles(PARIS, { enabled: {} }).length === 4);
}

// ── Bookings that cannot anchor a search ─────────────────────────────────────
// A link that dead-ends is worse than no link, so a tile with nothing to search
// for is dropped rather than shipped pointing at nothing.
console.log('\nbookings with less to go on');
{
  const hotelOnly = {
    items: [{ product: 'Accommodation', startDate: '2027-04-10T00:00:00',
      accommodation: { name: 'Hotel X', units: [{ checkin: '2027-04-10', nights: 3 }] } }],
    travellers: [{ type: 'Adult' }],
  };
  const tiles = upsellTiles(hotelOnly);
  ok('a hotel with no flight offers no airport extras', !find(tiles, 'AirportExtras'));
  ok('and offers no transfers or car hire either, having no airport to use',
    !find(tiles, 'Transfers') && !find(tiles, 'CarRental'));

  const flightOnly = {
    items: [{ product: 'Flights', legs: [leg('MAN', 'ALC', '2027-06-01T06:00:00'), leg('ALC', 'MAN', '2027-06-08T20:00:00')] }],
    travellers: [{ type: 'Adult' }, { type: 'Adult' }],
  };
  const f = upsellTiles(flightOnly);
  ok('a flight with no hotel still gets all four', f.length === 4, f.map((t) => t.product).join(', '));
  ok('its dates come off the flight', find(f, 'CarRental').from === '2027-06-01');
  ok('and its airport extras sit at the departure airport', find(f, 'AirportExtras').dst === 'MAN');

  ok('an empty order offers nothing', upsellTiles({ items: [] }).length === 0);
  ok('a missing order does not throw', upsellTiles(null).length === 0);
}

// ── The link ─────────────────────────────────────────────────────────────────
console.log('\nthe deep link');
{
  const tiles = upsellTiles(PARIS);
  const url = upsellUrl(find(tiles, 'CarRental'), '474');
  ok('it goes to the client\'s own application', url.indexOf('/deeplink/474?') !== -1, url);
  ok('it carries the search type', url.indexOf('st=CarRental') !== -1);
  ok('it carries both dates', url.indexOf('fr=2027-04-10') !== -1 && url.indexOf('to=2027-04-17') !== -1);
  ok('it carries the party', url.indexOf('adt=2') !== -1 && url.indexOf('chd=1') !== -1);
  // Without the client's app id a link would send their customer to somebody
  // else's booking engine, so there is no link at all.
  ok('no application id means no link', upsellUrl(find(tiles, 'CarRental'), '') === '');
  ok('no tile means no link', upsellUrl(null, '474') === '');

  const same = upsellUrl({ st: 'Transfers', dst: 'CDG', from: '2027-04-10', to: '2027-04-10', adults: 2 }, '474');
  ok('a single-day search does not repeat the date', same.indexOf('to=') === -1, same);
}

// ── The shape of the list itself ─────────────────────────────────────────────
console.log('\nthe list');
{
  ok('exactly four products can be upsold', UPSELL_PRODUCTS.length === 4);
  ok('none of them is the booking itself',
    !UPSELL_PRODUCTS.includes('Flights') && !UPSELL_PRODUCTS.includes('Accommodation')
    && !UPSELL_PRODUCTS.includes('Packages'));
  const tiles = upsellTiles(PARIS);
  ok('every tile carries a label and a hint for the page',
    tiles.every((t) => t.label && t.hint && t.label.length > 2));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
