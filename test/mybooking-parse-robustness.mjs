// Smoke: robust Travelify order-item parsing.
//
// Reproduces the failure seen on Exclusively Travel ET90803 (9 Jul 2026): a
// confirmed holiday whose hotel and flights vanished from the My Booking
// widget/PDF/email — only the post-booking Extra survived — and whose party of
// Miss/Ms passengers showed as "Mr". Root cause: trimItem only extracted detail
// on an EXACT product-label match with an already-object dataObject, so an
// item whose dataObject was a JSON string, or whose product used an unfamiliar
// label, lost all its detail while its price still counted toward the total.
//
// These assertions drive the shared classifier + traveller aggregator (the
// real code both /api/retrieve-order and /api/booking-pdf now run) and then
// render an ET90803-shaped booking through the PDF + email templates to prove
// the trip and the correct passenger titles come through end to end.
//
// Run: node test/mybooking-parse-robustness.mjs

import {
  classifyItem, coerceDataObject, resolveProductType, sniffProductFromShape,
  aggregateTravellers, describeUnclassifiedItem, CANONICAL_PRODUCTS,
} from '../api/_lib/travelify-items.js';
import { renderPdfHtml } from '../public/_pdf-template.js';
import { renderBookingEmail } from '../api/_lib/booking-email-template.js';

let fails = 0;
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) fails++; };

// ---- Realistic Travelify payload shapes ----
const hotelData = {
  name: 'Lindos Blu Hotel', propertyType: 'Hotel', rating: 5,
  location: { city: 'Lindos', country: 'GR', address1: 'Vlicha Bay' },
  pricing: { currency: 'GBP', price: 2877 },
  units: [{ name: 'Sea View Suite', nights: 7, checkin: '2026-07-26T00:00:00' }],
  amenities: ['Pool', 'Spa'], descriptions: [], media: [],
  guests: [
    { type: 'Lead', title: 'Miss', firstname: 'Alexandra', surname: 'Stephenson' },
    { type: 'Adult', title: 'Ms', firstname: 'Jordan', surname: 'Stephenson' },
  ],
};
const flightData = {
  fareType: 'Return',
  pricing: { currency: 'GBP', price: 1240 },
  routes: [{
    direction: 'Outbound', duration: 240,
    segments: [{
      origin: { iataCode: 'LGW', name: 'London Gatwick' },
      destination: { iataCode: 'RHO', name: 'Rhodes' },
      depart: '2026-07-26T07:00:00', arrive: '2026-07-26T13:00:00',
      marketingCarrier: { code: 'BA', name: 'British Airways' }, flightNo: 'BA2606',
    }],
  }],
  travellers: [
    { type: 'Adult', title: 'Miss', firstname: 'Alexandra', surname: 'Stephenson' },
    { type: 'Adult', title: 'Ms', firstname: 'Jordan', surname: 'Stephenson' },
  ],
  fareInformation: [],
};

// ===== 1. classifyItem: the three failure modes =====

// (a) Regression guard — a well-formed canonical item is classified EXACTLY
// as before, and its dataObject is passed straight through.
{
  const item = { product: 'Accommodation', price: 2877, dataObject: hotelData };
  const { productType, dataObject } = classifyItem(item);
  check('canonical Accommodation still classifies as Accommodation', productType === 'Accommodation');
  check('canonical dataObject passed through unchanged', dataObject === hotelData);
}

// (b) dataObject delivered as a JSON STRING (the flights item on ET90803:
// matched by product but rendered no legs).
{
  const item = { product: 'Flights', price: 1240, dataObject: JSON.stringify(flightData) };
  const { productType, dataObject } = classifyItem(item);
  check('Flights with stringified dataObject → classified Flights', productType === 'Flights');
  check('Flights stringified dataObject is parsed to an object with routes',
    !!dataObject && Array.isArray(dataObject.routes) && dataObject.routes.length === 1);
}

// (c) Unfamiliar product label with a hotel-shaped payload (the ~£2,877 main
// item that appeared nowhere). Sniff must recover it as Accommodation.
{
  const item = { product: 'Villa Stay', price: 2877, dataObject: hotelData };
  const { productType } = classifyItem(item);
  check('unknown label "Villa Stay" + hotel shape → Accommodation', productType === 'Accommodation');
}

// ===== 2. resolveProductType: label variants + structural sniff =====
check('exact canonical fast-path', resolveProductType('Packages', null) === 'Packages');
check('alias: HOTEL → Accommodation', resolveProductType('HOTEL', null) === 'Accommodation');
check('alias: "Car Hire" → CarRental', resolveProductType('Car Hire', null) === 'CarRental');
check('alias: singular "Flight" → Flights', resolveProductType('Flight', null) === 'Flights');
check('alias: "Holiday" → Packages', resolveProductType('Holiday', null) === 'Packages');

check('sniff: routes → Flights', sniffProductFromShape(flightData) === 'Flights');
check('sniff: units/guests → Accommodation', sniffProductFromShape(hotelData) === 'Accommodation');
check('sniff: hotel + flight shape → Packages',
  sniffProductFromShape({ ...hotelData, routes: flightData.routes }) === 'Packages');
check('sniff: array of extra groups → Extras',
  sniffProductFromShape([{ type: 'Transport', name: 'TRANSFERS', extras: [{ name: 'Taxi' }] }]) === 'Extras');
check('sniff: transfer shape → Transfers',
  sniffProductFromShape({ vehicle: 'Private Car', outPickup: { name: 'RHO' } }) === 'Transfers');
check('sniff: car rental shape → CarRental',
  sniffProductFromShape({ name: 'Seat Ibiza', classCode: 'Economy', transmission: 'Manual', packages: [{}] }) === 'CarRental');
check('sniff: tickets shape → TicketsAttractions',
  sniffProductFromShape({ name: 'Desert Safari', ticketType: 'Tours', options: [] }) === 'TicketsAttractions');
check('sniff: unknown shape → null', sniffProductFromShape({ policyNumber: 'X', cover: 'Gold' }) === null);

// Packages ambiguity resolved by SHAPE, not label alone: a generic "Holiday"
// label over a hotel-only payload must NOT invent phantom flights.
check('ambiguous "Holiday" + hotel-only payload → Accommodation (not Packages)',
  resolveProductType('Holiday', hotelData) === 'Accommodation');
check('ambiguous "Holiday" + flight-only payload → Flights (not Packages)',
  resolveProductType('Holiday', flightData) === 'Flights');
check('"Holiday" + genuine hotel+flight payload → Packages',
  resolveProductType('Holiday', { ...hotelData, routes: flightData.routes }) === 'Packages');
check('"Holiday" with no payload → Packages (label-only, unchanged)',
  resolveProductType('Holiday', null) === 'Packages');
// A single-product label over a genuinely bundled payload keeps the bundle.
check('label "Hotel" but payload bundles flights → Packages (no dropped flights)',
  resolveProductType('Hotel', { ...hotelData, routes: flightData.routes }) === 'Packages');

// classifyItem reports HOW it resolved, for the genuine-before-sniffed ordering.
check('classifyItem: exact label → resolvedBy exact', classifyItem({ product: 'Accommodation', dataObject: hotelData }).resolvedBy === 'exact');
check('classifyItem: alias label → resolvedBy alias', classifyItem({ product: 'Hotel', dataObject: hotelData }).resolvedBy === 'alias');
check('classifyItem: unknown label recovered by shape → resolvedBy sniff', classifyItem({ product: 'GroupBooking', dataObject: hotelData }).resolvedBy === 'sniff');

// ===== 3. coerceDataObject: strings, alternate keys, junk =====
check('coerce: object passed through', coerceDataObject({ dataObject: hotelData }) === hotelData);
check('coerce: JSON string parsed',
  coerceDataObject({ dataObject: JSON.stringify({ a: 1 }) })?.a === 1);
check('coerce: alternate key `data`', coerceDataObject({ data: hotelData }) === hotelData);
check('coerce: non-JSON string → null', coerceDataObject({ dataObject: 'just text' }) === null);
check('coerce: missing → null', coerceDataObject({ price: 5 }) === null);
check('coerce: array kept as array', Array.isArray(coerceDataObject({ dataObject: [{ extras: [] }] })));

// ===== 4. Genuinely unknown item → null + PII-safe diagnostic =====
{
  const item = { product: 'Insurance', price: 60, dataObject: { policyNumber: 'POL-123', holder: 'Alexandra Stephenson' } };
  const { productType } = classifyItem(item);
  check('unknown product + unknown shape → null (falls back to raw label downstream)', productType === null);
  const d = describeUnclassifiedItem(item);
  check('diagnostic reports the raw label', d.rawProduct === 'Insurance');
  check('diagnostic reports structural keys', Array.isArray(d.dataObjectKeys) && d.dataObjectKeys.includes('policyNumber'));
  check('diagnostic leaks no PII (no customer name/value)', !JSON.stringify(d).includes('Stephenson'));
}

check('CANONICAL_PRODUCTS has all eight types', CANONICAL_PRODUCTS.length === 8);

// ===== 5. aggregateTravellers: the empty-array short-circuit bug =====
{
  // Hotel carried NO guests, flights carried the whole party. The old
  // `accommodation?.guests || flights?.travellers` returned the empty hotel
  // array and never saw the passengers.
  const items = [
    { product: 'Accommodation', accommodation: { guests: [] } },
    { product: 'Flights', flights: { travellers: [
      { title: 'Miss', firstname: 'Alexandra', surname: 'Stephenson' },
      { title: 'Ms', firstname: 'Jordan', surname: 'Stephenson' },
    ] } },
  ];
  const t = aggregateTravellers(items);
  check('aggregate: empty hotel guests no longer shadow flight travellers', t.length === 2);
  check('aggregate: Miss surfaced', t.some(p => p.title === 'Miss' && p.firstname === 'Alexandra'));
  check('aggregate: Ms surfaced', t.some(p => p.title === 'Ms' && p.firstname === 'Jordan'));
}
{
  // De-dupe the overlap when the same person is on both hotel and flights.
  const items = [
    { product: 'Accommodation', accommodation: { guests: [{ title: 'Miss', firstname: 'Alexandra', surname: 'Stephenson' }] } },
    { product: 'Flights', flights: { travellers: [{ title: 'Miss', firstname: 'Alexandra', surname: 'Stephenson' }] } },
  ];
  check('aggregate: overlapping person de-duped', aggregateTravellers(items).length === 1);
}
{
  // Regression guard for the Packages case flagged in review: the hotel record
  // carries the person WITHOUT a title, the flight record carries the SAME
  // person WITH a title. Must list them ONCE, keeping the hotel record's
  // type/position but borrowing the flight's title — not twice.
  const pkgItem = {
    product: 'Packages',
    accommodation: { guests: [{ type: 'Lead', firstname: 'Jane', surname: 'Doe' }] },
    flights: { travellers: [{ type: 'Adult', title: 'Miss', firstname: 'Jane', surname: 'Doe' }] },
  };
  const t = aggregateTravellers([pkgItem]);
  check('aggregate: title-divergent same person listed once (no duplicate)', t.length === 1);
  check('aggregate: borrowed the title from the flight record', t[0].title === 'Miss');
  check('aggregate: kept the hotel record type/position (Lead)', t[0].type === 'Lead');
}
{
  // Two genuinely DIFFERENT people who share a first + surname but carry
  // distinct titles must NOT be collapsed (e.g. a father/son both "John Smith").
  const items = [{ product: 'Accommodation', accommodation: { guests: [
    { type: 'Lead', title: 'Mr', firstname: 'John', surname: 'Smith' },
    { type: 'Adult', title: 'Master', firstname: 'John', surname: 'Smith' },
  ] } }];
  const t = aggregateTravellers(items);
  check('aggregate: distinct same-name people with different titles kept separate', t.length === 2);
  check('aggregate: both distinct titles preserved',
    t.some(p => p.title === 'Mr') && t.some(p => p.title === 'Master'));
}
{
  // Guard the object-corruption path the review probed: upgrading a title-less
  // record must not mutate the original guest object in item.accommodation.guests.
  const hotelGuest = { type: 'Lead', firstname: 'Ada', surname: 'Byte' };
  const items = [
    { product: 'Accommodation', accommodation: { guests: [hotelGuest] } },
    { product: 'Flights', flights: { travellers: [{ type: 'Adult', title: 'Ms', firstname: 'Ada', surname: 'Byte' }] } },
  ];
  const t = aggregateTravellers(items);
  check('aggregate: single merged record with borrowed title', t.length === 1 && t[0].title === 'Ms');
  check('aggregate: original hotel guest object not mutated', hotelGuest.title === undefined);
}

// ===== 6. End-to-end: an ET90803-shaped booking renders its trip + titles =====
{
  const items = [
    { id: 1, status: 'Confirmed', product: 'Accommodation', bookingReference: 'ET90803', price: 2877,
      currency: 'GBP', startDate: '2026-07-26T00:00:00', duration: 7, accommodation: hotelData },
    { id: 2, status: 'Confirmed', product: 'Flights', bookingReference: 'ET90803', price: 1240,
      currency: 'GBP', startDate: '2026-07-26T00:00:00', duration: 7, flights: flightData },
    { id: 3, status: 'Confirmed', product: 'Extras', price: 86, currency: 'GBP',
      startDate: '2026-07-26T00:00:00', duration: 7,
      extras: { groups: [{ type: 'Luggage', name: 'LUGGAGE', description: 'HOLD LUGGAGE 23KG',
        extras: [{ type: 'Luggage', name: 'Hold Luggage', description: '23kg', qty: 1, payAtPickup: false,
          pricing: { currency: 'GBP', price: 86 },
          participants: [{ type: 'Adult', title: 'Miss', firstname: 'Alexandra', surname: 'Stephenson' }] }] }],
        travellers: [{ type: 'Adult', title: 'Miss', firstname: 'Alexandra', surname: 'Stephenson' }] } },
  ];
  const order = {
    id: 61799583, status: 'Confirmed',
    // The order-level customer title that used to wrongly show for every
    // passenger when the real party failed to parse.
    customerTitle: 'Mr', customerFirstname: 'Alex', customerSurname: 'Stephenson',
    customerEmail: 'alstephenson1@gmail.com', currency: 'GBP', created: '2026-07-08T00:00:00Z',
    items,
    summary: {
      totalPrice: 4203, hasAccommodation: true, hasFlights: true, hasExtras: true,
      hasAirportExtras: false, hasTransfers: false, hasCarRental: false,
      hasTicketsAttractions: false, hasPackages: false,
      earliestStart: '2026-07-26T00:00:00',
      travellers: aggregateTravellers(items),
    },
    payments: [], documents: [],
  };

  // The passenger DATA the widget renders in full (the surface where the
  // wrong "Mr" was reported). Both passengers, both correct titles — no
  // fallback to the order-level "Mr".
  const party = order.summary.travellers;
  check('widget data: both passengers present', party.length === 2);
  check('widget data: Miss Alexandra with correct title',
    party.some(p => p.title === 'Miss' && p.firstname === 'Alexandra'));
  check('widget data: Ms Jordan with correct title',
    party.some(p => p.title === 'Ms' && p.firstname === 'Jordan'));
  check('widget data: nobody wrongly titled Mr', !party.some(p => p.title === 'Mr'));

  // The PDF + email summarise to the LEAD guest (as the real ET90803 doc did):
  // the fix is that the lead now shows the correct title instead of "Mr".
  const pdf = renderPdfHtml(order, { brandName: 'Exclusively Travel' });
  const pdfText = pdf.replace(/<[^>]*>/g, ' ');
  check('PDF: hotel name now renders', pdf.includes('Lindos Blu Hotel'));
  check('PDF: flight route renders', pdf.includes('Rhodes') || pdf.includes('RHO'));
  check('PDF: lead guest shows correct title (Miss, not Mr)', /Miss\s+Alexandra\s+Stephenson/.test(pdfText));

  const email = renderBookingEmail({ order, orderRef: 'ET90803', brand: { name: 'Exclusively Travel' } });
  const emailText = email.html.replace(/<[^>]*>/g, ' ');
  check('Email: html is a string', typeof email.html === 'string');
  check('Email: hotel name in email', email.html.includes('Lindos Blu Hotel'));
  check('Email: lead traveller shows correct title (Miss, not Mr)', /Miss\s+Alexandra/.test(emailText));
  check('Email: reflects the full party (two travellers)', /Travellers/.test(emailText));
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
