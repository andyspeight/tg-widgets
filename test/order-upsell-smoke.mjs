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
  UPSELL_PRODUCTS, UPSELL_CATALOGUE, AWAITING_PROOF, CHILD_AGE_WHEN_UNKNOWN } from '../public/_order-upsell.js';

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
  ok('transfers and airport extras are built and waiting on proof, not forgotten',
    AWAITING_PROOF.join(',') === 'Transfers,AirportExtras');
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
  const url = upsellUrl(upsellTiles(family)[0], '474');
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
    summary: { travellers: [{ type: 'Adult' }] },
  };
  const tiles = upsellTiles(hotelOnly);
  ok('a hotel with no flight still gets things to do', !!find(tiles, 'TicketsAttractions'));
  ok('but no car hire, having no airport to pick one up at', !find(tiles, 'CarRental'));

  const flightOnly = {
    items: [{ product: 'Flights', legs: [
      leg('MAN', 'ALC', '2027-06-01T06:00:00', '2027-06-01T09:30:00'),
      leg('ALC', 'MAN', '2027-06-08T20:00:00', '2027-06-08T21:40:00')] }],
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
  // Travelify's order carries a traveller's TYPE and usually no age, and the
  // spec will not take a child without one. Searching the right number of
  // people at an assumed age beats searching the wrong number of people: the
  // first version dropped every ageless child, so a family of four opened a
  // search for two. The customer can change an age on the results page; they
  // cannot add a child who was never in the search.
  const noAge = { ...PARIS, summary: { travellers: [{ type: 'Adult' }, { type: 'Child' }] } };
  const bare = upsellUrl(upsellTiles(noAge)[0], '474');
  ok('a child with no stated age is still searched for',
    bare.indexOf('chd=1') !== -1, bare);
  ok('at the one assumed age, stated once so it can be found',
    bare.indexOf('chdage=' + CHILD_AGE_WHEN_UNKNOWN) !== -1, bare);
  ok('and a real age always beats the assumption',
    /chdage=9/.test(upsellUrl(upsellTiles(PARIS)[0], '474')));
  ok('nobody is invited who is not on the booking',
    bare.indexOf('inf=') === -1, bare);

  ok('no application id means no link', upsellUrl(find(tiles, 'CarRental'), '') === '');
  ok('no tile means no link', upsellUrl(null, '474') === '');
}

// ── The two that are built but not yet proved ────────────────────────────────
// Travelify's deep linking document is from 2022 and is NOT the whole list: our
// own Event Tickets widgets book through TicketAccommodation and
// TicketAccommodationFlight, neither of which appears in it. So transfers and
// airport extras may well work; they are read across from Car Rental, the
// nearest product the document does describe, and that is a reasoned shape
// rather than a verified one.
//
// This prints the exact URL each tile would produce on application 474. Open
// one: if it lands on a search, set `proved: true` in UPSELL_CATALOGUE and the
// tile ships. If it 400s, the shape or the search type is wrong and the tile
// stays off, because a missing button is honest and a dead one is not.
console.log('\nbuilt, and waiting on one click against the live service');
{
  const pending = upsellTiles(PARIS, { include: AWAITING_PROOF });
  const transfer = find(pending, 'Transfers');
  const extras = find(pending, 'AirportExtras');

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

  ok('neither is offered to a customer until it is proved',
    !find(upsellTiles(PARIS), 'Transfers') && !find(upsellTiles(PARIS), 'AirportExtras'));

  console.log('\n    Transfers     ' + upsellUrl(transfer, '474'));
  console.log('    AirportExtras ' + upsellUrl(extras, '474') + '\n');
}

// ── The shape of the list itself ─────────────────────────────────────────────
console.log('the list');
{
  ok('two of the four products are proved and shown', UPSELL_PRODUCTS.length === 2);
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
  ok('including the two not yet proved, so they arrive drawn',
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

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
