/**
 * No emoji in the booking outputs (24 Sep 2026).
 *
 * Andy, on the email's "Add to your trip" rows: "You've used Emojis on the
 * upsells, which are not acceptable in our designs." The upsell rows copied the
 * documents list, which already carried one, and so did the booking pack note
 * and the PDF's Flights heading. All four are gone. A page draws the house SVG
 * icons; an email, where Gmail strips SVG, uses words alone.
 *
 * Checked two ways: the source of every booking output, and what the email and
 * the PDF actually render for a booking that uses every block, so an emoji cannot
 * come back through a template string, a label or a fallback.
 *
 * Scope is the booking outputs. Other widgets still carry emoji (38 files on
 * 24 Sep 2026); widening this guard is the natural end of sweeping them.
 *
 * Run: node test/booking-no-emoji-smoke.mjs   (npm run test:booking-no-emoji)
 */
import { readFileSync } from 'node:fs';
import { renderBookingEmail, EMAIL_BLOCKS } from '../public/_booking-email-template.js';
import { renderPdfHtml } from '../public/_pdf-template.js';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const EMOJI = /\p{Extended_Pictographic}/gu;
const found = (s) => [...new Set(String(s).match(EMOJI) || [])].join(' ');

console.log('\nNo emoji in the booking outputs\n');
for (const f of ['public/_booking-email-template.js', 'public/_pdf-template.js', 'public/widget-mybooking.js', 'public/_order-upsell.js']) {
  const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  ok(f + ' carries none', !EMOJI.test(src), found(src));
  EMOJI.lastIndex = 0;
}

const people = [
  { type: 'Lead', title: 'Mr', firstname: 'Luke', surname: 'Livsey' },
  { type: 'Child', title: 'Miss', firstname: 'Ella', surname: 'Livsey', age: 9 }];
const seg = (from, to, depart, arrive) => ({ origin: { iataCode: from, name: from }, destination: { iataCode: to, name: to },
  depart, arrive, marketingCarrier: { code: 'EK', name: 'Emirates' }, flightNo: 'EK002' });
const ORDER = {
  id: 81376, status: 'Confirmed', customerTitle: 'Mr', customerFirstname: 'Luke', customerSurname: 'Livsey', currency: 'GBP',
  summary: { totalPrice: 4104, travellers: people },
  payments: [{ amount: 800, date: '2026-09-24T10:00:00', status: 'Success' }],
  documents: [{ name: 'ATOL certificate', ext: 'pdf', url: 'https://static.travelify.io/docs/atol.pdf' }],
  items: [
    { id: 1, product: 'Flights', bookingReference: 'EK7Q2KX', price: 2342, currency: 'GBP', startDate: '2027-02-10T00:00:00',
      flights: { routes: [
        { direction: 'Outbound', segments: [seg('LHR', 'DXB', '2027-02-10T09:40:00Z', '2027-02-10T20:35:00Z')] },
        { direction: 'Inbound', segments: [seg('DXB', 'LHR', '2027-02-17T07:45:00Z', '2027-02-17T11:55:00Z')] }] } },
    { id: 2, product: 'Accommodation', bookingReference: 'DEMO81376', price: 1762, currency: 'GBP', startDate: '2027-02-10T00:00:00',
      accommodation: { name: 'Address Downtown', rating: 5, location: { city: 'Dubai', country: 'AE' },
        units: [{ name: 'Deluxe Room', checkin: '2027-02-10', nights: 7, rates: [{ board: 'BedAndBreakfast' }] }], guests: people } }],
};
const upsell = ['TicketsAttractions', 'CarRental', 'Transfers', 'AirportExtras'].map((product) => ({
  product, label: product, hint: 'A hint.', url: 'https://dl.tvllnk.com/deeplink/250?st=' + product + '&orderRef=81376/0CB5D0BC-0000' }));

// Every block in the palette at once, so nothing escapes by not being in the
// built-in layout.
const everything = EMAIL_BLOCKS.map((b) => ({ type: b.type, text: 'Some words', url: 'https://example.com/x.jpg' }));
const email = renderBookingEmail({ order: ORDER, message: 'A note', brand: { name: 'Sample Travel' }, orderRef: 'DEMO81376',
  baseUrl: 'https://widgets.travelify.io', layout: everything, upsell });
ok('the email, with every block in it, renders none', !EMOJI.test(email.html), found(email.html));
EMOJI.lastIndex = 0;
ok('nor does its plain-text version', !EMOJI.test(email.text), found(email.text));
EMOJI.lastIndex = 0;
ok('and the upsell rows still name all four', upsell.every((t) => email.html.includes(t.label)));
ok('with the documents still listed by name', email.html.includes('ATOL certificate'));

const pdf = renderPdfHtml(ORDER, { brandName: 'Sample Travel' });
ok('the PDF renders none', !EMOJI.test(pdf), found(pdf));
EMOJI.lastIndex = 0;
ok('and its Flights heading is still there', />\s*Flights\s*</.test(pdf));

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
