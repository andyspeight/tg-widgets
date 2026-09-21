/**
 * My Booking shows the seats and bags, and a discount voucher counts
 * (21 Sep 2026, Exclusively Travel ET122149 — Gill Clark, Leonidas, 2-16 Oct).
 *
 * Two things the client reported on the same booking:
 *
 *   4. "It is showing as owing £30 but this was a promo code used, so in
 *      Travelify it shows as 0 balance." The order carries
 *        vouchers: [{ id: 979, code: 'SUNSHINE30', value: -30, isGift: false }]
 *      and isGift false meant "hold this back, it might already be inside the
 *      item prices". ET122149 proves it is not: our total is the item prices
 *      summed, Travelify reads zero, we read £30. So discount vouchers are
 *      credit now, and TG_DEDUCT_NON_GIFT_VOUCHERS=0 is the way back.
 *
 *   5. "It would be good if it would show the luggage and seats booked. It is
 *      very clear in Travelify but this doesn't appear in the client facing
 *      area." Travelify sends the WHOLE menu for a flight in
 *      dataObject.extraGroups — 109 seats on the outbound alone — and marks
 *      what was chosen with qtySelected. Nothing read it, so four seats and
 *      two hold bags never reached the customer.
 *
 * The extraGroups and the voucher below are verbatim from the payload Andy
 * sent. The item prices are stand-ins, chosen so the arithmetic reproduces the
 * reported £30.
 *
 * Run: node test/mybooking-seats-luggage-smoke.mjs  (npm run test:mybooking-seats)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { trimFlightExtras } from '../api/_lib/travelify-items.js';
import { moneyOf } from '../api/_lib/order-money.js';
import { renderPdfHtml } from '../public/_pdf-template.js';
import { renderBookingEmail } from '../public/_booking-email-template.js';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ── The feed, as Travelify sends it ──────────────────────────────────────────

const TRAVELLERS = [
  { type: 'Adult', title: 'Mrs', firstname: 'Gillian', middleNames: 'Tracey', surname: 'Clark' },
  { type: 'Adult', title: 'Mr', firstname: 'Michael', middleNames: 'Ian', surname: 'Clark' },
];

// A cut of dataObject.extraGroups: the two placeholder rows that must never
// show, two unchosen menu items, and the five real selections.
const EXTRA_GROUPS = [
  {
    gid: '1', type: 'Luggage', travellerTypes: [], name: 'Add Luggage', maxSelectable: 1, isAvailable: true,
    extras: [
      { eid: '0', type: 'Luggage', name: "I don't want to add any optional baggage upgrades", isPayAtPickup: false, maxQty: 1, qtySelected: 1, pricing: { currency: 'GBP', price: 0 } },
      { eid: '1', bookingData: { Code: 'LUG:WGT:WGT:WGT', Supplier: 'EZJ' }, type: 'Luggage', name: 'Each hold bag includes 32kg of weight', isPayAtPickup: false, maxQty: 6, pricing: { currency: 'GBP', price: 132.98 } },
      { eid: '3', bookingData: { Code: 'LUG', Supplier: 'EZJ' }, type: 'Luggage', name: 'Each hold bag includes 23kg of weight', isPayAtPickup: false, maxQty: 6, qtySelected: 2, pricing: { currency: 'GBP', price: 105.98 } },
    ],
  },
  {
    gid: '2', type: 'Seat', travellerTypes: ['Adult'], name: 'Seats: LTN-LTN EZY2381',
    bookingData: { FlightNumber: 'EZY2381', AircraftType: '320B', Currency: 'GBP', Supplier: 'EZJ', DeparturePoint: 'LTN' },
    extras: [
      { eid: '0', bookingData: { SEATID: 'NONE' }, type: 'Seat', name: 'I do not want to pre-book my seat for this flight', isPayAtPickup: false, maxQty: 1, qtySelected: 1 },
      { eid: '1', bookingData: { SeatBandID: '1', Num: '1A', BandId: '1', Block: '1', row: '1' }, type: 'Generic', name: 'Window Seat 1A (Extra legroom)', seat: { col: 'A', row: 1 }, maxQty: 1, pricing: { currency: 'GBP', price: 24.99 } },
      { eid: '6', bookingData: { SeatBandID: '2', Num: '2B', BandId: '2', Block: '1', row: '2', PaxID: '1' }, type: 'Generic', name: 'Middle Seat 2B (Up Front) Block 1 Row 2', seat: { col: 'B', row: 2 }, isPayAtPickup: false, maxQty: 1, qtySelected: 1, pricing: { currency: 'GBP', price: 18.49 } },
      { eid: '7', bookingData: { SeatBandID: '2', Num: '2C', BandId: '2', Block: '1', row: '2', PaxID: '0' }, type: 'Generic', name: 'Aisle Seat 2C (Up Front) Block 1 Row 2', seat: { col: 'C', row: 2 }, isPayAtPickup: false, maxQty: 1, qtySelected: 1, pricing: { currency: 'GBP', price: 18.49 } },
    ],
  },
  {
    gid: '3', type: 'Seat', travellerTypes: ['Adult'], name: 'Seats: RHO-RHO EZY2382',
    bookingData: { FlightNumber: 'EZY2382', AircraftType: '320B', Currency: 'GBP', Supplier: 'EZJ', DeparturePoint: 'RHO' },
    extras: [
      { eid: '10', bookingData: { SeatBandID: '2', Num: '3B', BandId: '2', Block: '1', row: '3', PaxID: '1' }, type: 'Generic', name: 'Middle Seat 3B (Up Front) Block 1 Row 3', seat: { col: 'B', row: 3 }, isPayAtPickup: false, maxQty: 1, qtySelected: 1, pricing: { currency: 'GBP', price: 18.99 } },
      { eid: '11', bookingData: { SeatBandID: '2', Num: '3C', BandId: '2', Block: '1', row: '3', PaxID: '0' }, type: 'Generic', name: 'Aisle Seat 3C (Up Front) Block 1 Row 3', seat: { col: 'C', row: 3 }, isPayAtPickup: false, maxQty: 1, qtySelected: 1, pricing: { currency: 'GBP', price: 18.99 } },
    ],
  },
];

const VOUCHER = { id: 979, code: 'SUNSHINE30', name: '30 GBP DISCOUNT ON ACCOMMODATION', value: -30.0, isPercent: false, isGift: false };

// ── The trimmed order the browser, the PDF and the email all receive ─────────

const people = TRAVELLERS.map(t => ({ type: t.type, title: t.title, firstname: t.firstname, surname: t.surname }));
const EXTRAS = trimFlightExtras({ extraGroups: EXTRA_GROUPS }, people);

const seg = (from, fromName, to, toName, depart, arrive, flightNo) => ({
  origin: { iataCode: from, name: fromName, country: from === 'RHO' ? 'GR' : 'GB' },
  destination: { iataCode: to, name: toName, country: to === 'RHO' ? 'GR' : 'GB' },
  depart, arrive, duration: 255, cabinClass: 'Economy', fareName: 'Standard',
  marketingCarrier: { code: 'EZY', name: 'easyJet' }, operatingCarrier: { code: 'EZY', name: 'easyJet' },
  flightNo, touchdowns: 0, baggage: null,
});

const ORDER = {
  id: 122149, status: 'Confirmed', bookingReference: 'ET122149',
  customerTitle: 'Mrs', customerFirstname: 'Gillian', customerSurname: 'Clark',
  customerEmail: 'gill.clark@example.com', currency: 'GBP', created: '2026-09-20T08:25:00Z',
  vouchers: [VOUCHER], paidToDate: 1170,
  summary: {
    totalPrice: 1200, hasAccommodation: true, hasFlights: true,
    earliestStart: '2026-10-02T00:00:00', travellers: people,
  },
  items: [
    {
      id: 1, status: 'Confirmed', product: 'Accommodation', bookingReference: 'ET122149',
      price: 608, currency: 'GBP', startDate: '2026-10-02T00:00:00', duration: 14,
      accommodation: {
        name: 'Leonidas Studios', propertyType: 'Hotel', rating: 3,
        location: { address1: 'Pefkos', city: 'Rhodes', country: 'GR' },
        units: [{ name: 'Studio', roomType: 'Studio', checkin: '2026-10-02T00:00:00', nights: 14, rates: [{ board: 'RoomOnly' }], sleepsAdults: 2, sleepsChildren: 0 }],
        pricing: { price: 608, currency: 'GBP', isRefundable: false },
        guests: people, media: [], descriptions: [], amenities: [], goodFor: [],
      },
    },
    {
      id: 111089, status: 'Confirmed', product: 'Flights', bookingReference: '',
      price: 592, currency: 'GBP', startDate: '2026-10-02T00:00:00', duration: 14,
      flights: {
        fareType: 'LowCost', openJaw: false, pricing: { currency: 'GBP', price: 592 },
        routes: [
          { legID: 0, direction: 'Outbound', duration: 255, segments: [seg('LTN', 'Luton (LTN)', 'RHO', 'Diagoras (RHO)', '2026-10-02T12:55:00Z', '2026-10-02T19:10:00Z', 'EZY2381')] },
          { legID: 1, direction: 'Inbound', duration: 265, segments: [seg('RHO', 'Diagoras (RHO)', 'LTN', 'Luton (LTN)', '2026-10-16T19:55:00Z', '2026-10-16T22:20:00Z', 'EZY2382')] },
        ],
        fareInformation: [], travellers: people, extras: EXTRAS,
      },
    },
  ],
  payments: [{ status: 'Success', amount: 1170, date: '2026-09-20T08:30:00Z' }], documents: [],
};

// ══ 1. The trim keeps only what was chosen ═══════════════════════════════════

console.log('Only the chosen seats and bags survive the trim');
{
  ok('five selections out of a menu of nine', EXTRAS.length === 5, JSON.stringify(EXTRAS.map(x => x.name)));
  ok('the "I don\'t want any baggage upgrades" placeholder is dropped',
    !EXTRAS.some(x => /don't want/i.test(x.name || '')));
  ok('the "I do not want to pre-book my seat" placeholder is dropped (SEATID NONE)',
    !EXTRAS.some(x => /do not want to pre-book/i.test(x.name || '')));
  ok('an unchosen seat on the same aircraft is not carried', !EXTRAS.some(x => x.seat === '1A'));
  ok('an unchosen bag weight is not carried', !EXTRAS.some(x => /32kg/.test(x.name || '')));

  const seats = EXTRAS.filter(x => x.seat);
  ok('four seats, in flight order then traveller order',
    seats.map(x => x.seat).join(',') === '2C,2B,3C,3B', seats.map(x => x.seat).join(','));
  ok('PaxID 0 is Gillian and PaxID 1 is Michael',
    seats[0].traveller === 'Gillian Clark' && seats[1].traveller === 'Michael Clark',
    seats.map(x => `${x.seat}=${x.traveller}`).join(' '));
  ok('each seat knows its flight', seats[0].flightNo === 'EZY2381' && seats[2].flightNo === 'EZY2382');

  const bags = EXTRAS.filter(x => !x.seat);
  ok('two 23kg hold bags, as one row with a quantity',
    bags.length === 1 && bags[0].qty === 2 && bags[0].name === 'Each hold bag includes 23kg of weight');
  ok('a bag has no seat and no traveller', bags[0].seat === null && bags[0].traveller === null);

  // A per-unit supplier price does not reconcile with the item total, so it is
  // never carried and can never be printed beside a figure it does not match.
  ok('no price reaches the customer-facing shape',
    !JSON.stringify(EXTRAS).includes('18.49') && !JSON.stringify(EXTRAS).includes('105.98')
    && !EXTRAS.some(x => 'price' in x || 'pricing' in x));
}

console.log('The trim holds up against junk');
{
  ok('no extraGroups at all', trimFlightExtras({}, people).length === 0);
  ok('a string where the groups should be', trimFlightExtras({ extraGroups: 'nope' }, people).length === 0);
  ok('null entries in the list', trimFlightExtras({ extraGroups: [null, undefined] }, people).length === 0);
  ok('no travellers to resolve a PaxID against',
    trimFlightExtras({ extraGroups: EXTRA_GROUPS }, []).filter(x => x.seat).every(x => x.traveller === null));
  ok('a PaxID beyond the party resolves to nobody rather than throwing',
    trimFlightExtras({ extraGroups: [{ type: 'Seat', extras: [{ bookingData: { Num: '9F', PaxID: '99' }, name: 'Seat 9F', qtySelected: 1 }] }], people }, people)[0].traveller === null);
  ok('a seat with no Num falls back to its row and column',
    trimFlightExtras({ extraGroups: [{ type: 'Seat', extras: [{ bookingData: { SeatBandID: '2' }, seat: { row: 4, col: 'D' }, name: 'Seat', qtySelected: 1 }] }] }, people)[0].seat === '4D');
  ok('qtySelected of 0 is not a selection',
    trimFlightExtras({ extraGroups: [{ type: 'Luggage', extras: [{ bookingData: { Code: 'LUG' }, name: 'A bag', qtySelected: 0 }] }] }, people).length === 0);
}

// ══ 2. The page ══════════════════════════════════════════════════════════════

console.log('The My Booking page shows them');
const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>',
  { runScripts: 'outside-only', url: 'https://client.test/booking', pretendToBeVisual: true });
const { window } = dom;
window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
window.eval(R('public/widget-mybooking.js'));
const host = window.document.getElementById('host');
const inst = new window.TGMyBookingWidget(host, {});
inst.lookup = { email: ORDER.customerEmail, date: '2026-10-02', ref: 'ET122149' };
inst.state = { stage: 'found', order: ORDER, error: null };
inst._render();
const page = host.shadowRoot.innerHTML;
{
  ok('the booking rendered', /Leonidas Studios/.test(page) && /EZY2381/.test(page), page.slice(0, 160));
  ok('all four seats are on the page', ['2B', '2C', '3B', '3C'].every(n => page.includes('Seat ' + n)));
  ok('each seat names its traveller', /Seat 2C · Gillian Clark/.test(page) && /Seat 3B · Michael Clark/.test(page));
  ok('the outbound seats sit under the outbound leg, not the return',
    page.indexOf('Seat 2C') < page.indexOf('EZY2382') && page.indexOf('Seat 3C') > page.indexOf('EZY2382'));
  ok('the hold bags show, with the quantity', /2 x Each hold bag includes 23kg of weight/.test(page));
  ok('the captions are there', /Seats you chose/.test(page) && /Baggage and extras/.test(page));
  ok('an unchosen seat from the menu is nowhere on the page', !page.includes('Seat 1A'));
  ok('no per-unit supplier price is printed', !/18\.49/.test(page) && !/105\.98/.test(page));
}

console.log('The page settles the balance the promo code paid off');
{
  const money = moneyOf(ORDER);
  ok('the calculation reads zero, like Travelify', money.balance === 0 && money.settled === true && money.payable === 0);
  ok('the discount is shown as a credit, by name', money.vouchers.length === 1 && money.vouchers[0].credit === 30);
  ok('the page shows the discount as a credit, not as money owed', /-£30\.00/.test(page));
  ok('the page offers no Pay button', !page.includes('data-tgm-pay-open'));
  ok('the page says it is paid in full', /paid in full/i.test(page));
  ok('the discount is named on the payment card', /30 GBP DISCOUNT ON ACCOMMODATION/.test(page));
  ok('the raw voucher code never reaches the browser', !page.includes('SUNSHINE30'));
}

// ══ 3. The paperwork ═════════════════════════════════════════════════════════

const WITH_MONEY = { ...ORDER, money: moneyOf(ORDER) };

console.log('The PDF says the same');
{
  const pdf = renderPdfHtml(WITH_MONEY, { brandName: 'Exclusively Travel' });
  ok('all four seats, each with its traveller',
    ['2B', '2C', '3B', '3C'].every(n => pdf.includes('Seat ' + n))
    && /Seat 2C · Gillian Clark/.test(pdf));
  ok('the outbound seats print under the outbound leg',
    pdf.indexOf('Seat 2C') < pdf.indexOf('Inbound') && pdf.indexOf('Seat 3C') > pdf.indexOf('Inbound'));
  ok('the hold bags print, with the quantity', /2 x Each hold bag includes 23kg of weight/.test(pdf));
  ok('the captions are there', /Seats you chose/.test(pdf) && /Baggage and extras/.test(pdf));
  ok('an unchosen seat is not printed', !pdf.includes('Seat 1A'));
  ok('no per-unit supplier price is printed', !/18\.49/.test(pdf) && !/105\.98/.test(pdf));
  ok('the balance is zero and the code is masked', /£0\.00/.test(pdf) && !pdf.includes('SUNSHINE30'));
}

console.log('The confirmation email says the same');
{
  const email = renderBookingEmail({ order: WITH_MONEY, orderRef: 'ET122149', brand: { name: 'Exclusively Travel' } });
  const html = email.html;
  const text = email.text || '';
  ok('all four seats are in the email', ['2B', '2C', '3B', '3C'].every(n => html.includes(n)));
  ok('the seats name their travellers', /2C Gillian Clark/.test(html) && /3B Michael Clark/.test(html));
  ok('the hold bags are in the email', /2 x Each hold bag includes 23kg of weight/.test(html));
  ok('an unchosen seat is not in the email', !html.includes('Window Seat 1A'));
  ok('no per-unit supplier price is in the email', !/18\.49/.test(html) && !/105\.98/.test(html));
  ok('the email says paid in full and masks the code',
    /paid in full/i.test(html) && !html.includes('SUNSHINE30') && !text.includes('SUNSHINE30'));
}

// ══ 4. Drift ═════════════════════════════════════════════════════════════════

console.log('There is ONE trim, and every order endpoint calls it');
{
  const SHARED = R('api/_lib/travelify-items.js');
  ok('the trim lives in the shared module', /export function trimFlightExtras\(/.test(SHARED));
  for (const f of ['api/retrieve-order.js', 'api/internal/retrieve-order-by-client.js', 'api/booking-pdf.js']) {
    const src = R(f);
    ok(f + ' imports it and hangs it off the flights item',
      /trimFlightExtras[^\n]*from '[^']*travelify-items\.js'/.test(src)
      && /extras: trimFlightExtras\(d, travellers\)/.test(src));
    ok(f + ' has no second copy of its own', src.split('function trimFlightExtras(').length === 1);
  }
  ok('the page and the PDF split the extras the same way',
    /function splitFlightExtras\(f\)/.test(R('public/widget-mybooking.js'))
    && /const splitPdfFlightExtras = \(f\)/.test(R('public/_pdf-template.js')));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
