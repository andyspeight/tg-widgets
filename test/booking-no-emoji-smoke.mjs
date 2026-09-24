/**
 * No emoji in the booking outputs, and real icons where they were (24 Sep 2026).
 *
 * Andy, on the email's "Add to your trip" rows: "You've used Emojis on the
 * upsells, which are not acceptable in our designs." The upsell rows copied the
 * documents list, which already carried one, and so did the booking pack note
 * and the PDF's Flights heading. All four are gone. Then: "There should still be
 * relevant icons, just not emojis." So a page draws the house SVG icons, the
 * PDF (which Chromium renders) draws them inline too, and the email, where
 * Gmail strips SVG, uses small PNGs built from the SAME paths by
 * scripts/build-email-icons.mjs.
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

// ── The icons that replaced them ─────────────────────────────────────────────
console.log('\nRelevant icons, not emoji');
{
  const { existsSync } = await import('node:fs');
  const want = { TicketsAttractions: 'upsell-tickets', CarRental: 'upsell-car', Transfers: 'upsell-transfers', AirportExtras: 'upsell-extras' };
  const rows = email.html.split('Search →');
  ok('every upsell row carries its own icon, the one its tile has on the page',
    Object.values(want).every((n) => email.html.includes('/email-icons/' + n + '.png')));
  ok('in the same order as the rows', Object.values(want)
    .map((n) => email.html.indexOf('/email-icons/' + n + '.png')).every((at, i, a) => i === 0 || at > a[i - 1]));
  ok('the documents list has a document icon', email.html.includes('/email-icons/doc-file.png'));
  ok('and the booking pack note a paperclip', email.html.includes('/email-icons/doc-paperclip.png'));

  const srcs = [...new Set([...email.html.matchAll(/<img src="([^"]+\/email-icons\/[^"]+)"/g)].map((m) => m[1]))];
  ok('every icon is on our own fixed domain, over https',
    srcs.length >= 6 && srcs.every((u) => u.startsWith('https://widgets.travelify.io/email-icons/')), srcs.join(' '));
  ok('and every one of them exists, so no email points at a missing picture',
    srcs.every((u) => existsSync(new URL('../public/email-icons/' + u.split('/').pop(), import.meta.url))));
  const imgs = [...email.html.matchAll(/<img src="[^"]+\/email-icons\/[^"]+"[^>]*>/g)].map((m) => m[0]);
  ok('each is decoration: empty alt, a fixed size, no border',
    imgs.length && imgs.every((t) => /alt=""/.test(t) && /width="\d+"/.test(t) && /height="\d+"/.test(t) && /border:0/.test(t)));

  // The PNGs are built from the widget's own icon paths, not a copy of them.
  const builder = readFileSync(new URL('../scripts/build-email-icons.mjs', import.meta.url), 'utf8');
  ok('the email icons are drawn from the booking page\'s own paths',
    /readFileSync\(new URL\('\.\.\/public\/widget-mybooking\.js'/.test(builder)
      && ["ic('ticket')", "ic('car')", "ic('van')", "ic('lounge')", "ic('file')"].every((c) => builder.includes(c)));
  // The first build read the word "Ticket" from the widget's translations as
  // the ticket drawing and made an empty chip; this test passed regardless.
  // So check what the builder actually resolves, not just that it asks.
  const { EMAIL_ICONS } = await import('../scripts/build-email-icons.mjs');
  const widget = readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8');
  const icBlock = widget.slice(widget.indexOf('const IC = {'), widget.indexOf('\n  };', widget.indexOf('const IC = {')));
  ok('every icon resolves to a real drawing, not a word',
    Object.values(EMAIL_ICONS).every(([, d]) => /^M[\d.]/.test(d)),
    Object.entries(EMAIL_ICONS).filter(([, [, d]]) => !/^M[\d.]/.test(d)).map(([n]) => n).join(', '));
  ok('and the upsell icons are the very paths the booking page draws',
    [['upsell-tickets', 'ticket'], ['upsell-car', 'car'], ['upsell-transfers', 'van'], ['upsell-extras', 'lounge']]
      .every(([n, k]) => icBlock.includes(k + ":") && icBlock.includes("'" + EMAIL_ICONS[n][1] + "'")));
  ok('and every icon the builder makes has been built',
    ['upsell-tickets', 'upsell-car', 'upsell-transfers', 'upsell-extras', 'doc-file', 'doc-paperclip']
      .every((n) => existsSync(new URL('../public/email-icons/' + n + '.png', import.meta.url))));
}

const pdf = renderPdfHtml(ORDER, { brandName: 'Sample Travel' });
ok('the PDF renders none', !EMOJI.test(pdf), found(pdf));
EMOJI.lastIndex = 0;
ok('and its Flights heading is still there', /<\/svg>Flights</.test(pdf));
ok('with the plane icon the booking page draws, as an icon', /<svg[^>]*aria-hidden="true"[^>]*>(<path[^>]*>)+<\/svg>Flights/.test(pdf));

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
