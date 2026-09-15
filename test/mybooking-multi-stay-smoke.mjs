/**
 * A booking with more than one hotel shows every hotel (15 Sep 2026).
 *
 * Exclusively Travel, booking ET121109. Mrs Whitaker booked six nights at
 * Lambis Studios and then three at a second property. The documents showed
 * Lambis only: the second stay was absent altogether, while the total still
 * covered both, so the paperwork read £1,158 for six nights.
 *
 * One word, repeated in three files:
 *
 *     const accItem = items.find(i => i.product === 'Accommodation' ...)
 *
 * Every other product was selected with .filter() and rendered as a list.
 * Accommodation alone used .find(), which keeps the first and discards the
 * rest, and nothing held the three copies in step.
 *
 * This runs the REAL templates and the REAL widget over a two-hotel booking
 * and asserts both properties reach the reader, on all three outputs. It also
 * asserts a single-hotel booking is unchanged, because that is almost every
 * booking and a regression there would be far worse than the bug.
 *
 * Run: TGS_CHROMIUM=/opt/pw-browsers/chromium node test/mybooking-multi-stay-smoke.mjs
 *      (npm run test:mybooking-multi-stay)
 */
import { readFileSync } from 'node:fs';
import { renderPdfHtml } from '../public/_pdf-template.js';
import { renderBookingEmail } from '../public/_booking-email-template.js';
import { listStays, isMultiStay } from '../public/_order-stays.js';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const stay = (id, name, city, checkin, nights, price, room) => ({
  id, status: 'Confirmed', product: 'Accommodation', bookingReference: 'ET121109',
  price, currency: 'GBP', startDate: checkin, duration: nights,
  accommodation: {
    name, propertyType: 'Hotel', rating: 3,
    location: { address1: 'Krana', city, state: 'Rhodes', country: 'GR' },
    units: [{ name: room, roomType: room, checkin, nights, rates: [{ board: 'RoomOnly' }], sleepsAdults: 2, sleepsChildren: 0 }],
    pricing: { price, currency: 'GBP', isRefundable: false },
    descriptions: [{ title: 'Description', text: name + ' sits above the bay in ' + city + '.' }],
    amenities: ['Pool', 'Wi-Fi', 'Bar'],
    guests: [{ type: 'Lead', title: 'Mrs', firstname: 'Gemma', surname: 'Whitaker' }],
    media: [],
  },
});

const base = {
  id: 64026875, status: 'Confirmed', customerTitle: 'Mrs', customerFirstname: 'Gemma',
  customerSurname: 'Whitaker', customerEmail: 'gemwhitaker@icloud.com',
  created: '2026-09-13', currency: 'GBP',
  summary: { totalPrice: 1158, hasAccommodation: true, travellers: [{ type: 'Lead', title: 'Mrs', firstname: 'Gemma', surname: 'Whitaker' }] },
};
const TWO = Object.assign({}, base, { items: [
  // Dates as Travelify sends them: a date wearing a time, with no zone. The
  // tidy '2026-09-26' this suite used at first is not what arrives, and the
  // difference hid a day's error on the screen for a week (see
  // test/booking-dates-timezone-smoke.mjs).
  stay(1, 'Lambis Studios', 'Lindos', '2026-09-26T00:00:00', 6, 772, 'Suite'),
  stay(2, 'Anthos Apartments', 'Pefkos', '2026-10-02T00:00:00', 3, 386, 'Studio'),
] });
const ONE = Object.assign({}, base, { items: [stay(1, 'Lambis Studios', 'Lindos', '2026-09-26', 6, 1158, 'Suite')] });

console.log('The booking really does hold two stays');
{
  const s = listStays(TWO);
  ok('both are found', s.length === 2, String(s.length));
  ok('in trip order', s[0].name === 'Lambis Studios' && s[1].name === 'Anthos Apartments', s.map((x) => x.name).join(' then '));
  ok('the first runs 26 Sept to 2 Oct', s[0].checkin === '2026-09-26' && s[0].checkout === '2026-10-02', s[0].checkout);
  ok('the second picks up where it left off', s[1].checkin === '2026-10-02' && s[1].checkout === '2026-10-05', s[1].checkout);
  ok('a trip that moves between properties is recognised as such', isMultiStay(TWO) === true);
  ok('a one-hotel booking is not', isMultiStay(ONE) === false);
  // Out of order in the feed, right way round on the page.
  const shuffled = Object.assign({}, base, { items: [TWO.items[1], TWO.items[0]] });
  ok('a feed that lists them out of order still reads in trip order',
    listStays(shuffled).map((x) => x.name).join('|') === 'Lambis Studios|Anthos Apartments');
}

const pdfOpts = { brandName: 'Exclusively Travel', orderRef: 'ET121109', colors: {}, radius: 12, display: {} };

console.log('The PDF shows both');
{
  const html = renderPdfHtml(TWO, pdfOpts);
  ok('the first hotel is there', html.includes('Lambis Studios'));
  ok('the SECOND hotel is there', html.includes('Anthos Apartments'),
    'this is the stay the customer lost');
  ok('its town is there', html.includes('Pefkos'));
  ok('both durations are shown', /6 night/.test(html) && /3 night/.test(html));
  ok('both rooms are shown', html.includes('Suite') && html.includes('Studio'));
  ok('the stays are numbered so the trip reads in order',
    html.includes('Stay 1 of 2') && html.includes('Stay 2 of 2'));
  ok('the write-up covers both properties',
    html.includes('sits above the bay in Lindos') && html.includes('sits above the bay in Pefkos'));
  ok('the heading says hotels, plural', html.includes('Your Hotels'));
}

console.log('The email shows both');
{
  const mail = renderBookingEmail({ order: TWO, message: '', brand: { name: 'Exclusively Travel' }, colors: {}, orderRef: 'ET121109' });
  const html = typeof mail === 'string' ? mail : (mail.html || '');
  ok('the first hotel is there', html.includes('Lambis Studios'));
  ok('the SECOND hotel is there', html.includes('Anthos Apartments'));
  ok('both sets of dates are there', html.includes('2 Oct') && html.includes('5 Oct'), 'checkouts 2 Oct and 5 Oct');
  ok('they are numbered', html.includes('Stay 1 of 2') && html.includes('Stay 2 of 2'));
}

console.log('The widget shows both');
{
  const WIDGET = readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8');
  ok('it selects every stay rather than the first',
    /const stays = listStays\(order\);/.test(WIDGET));
  ok('it renders one card per stay, the way flights already did',
    /stays\.map\(\(st, i\) => renderStayCard\(st, i, stays\.length, c\)\)/.test(WIDGET));
  ok('the old single-accommodation block is gone',
    !/\$\{\(checkin \|\| checkout \|\| nights \|\| acc\?\.units\?\.\[0\]\) \? `/.test(WIDGET));
  ok('it carries the shared selector verbatim', /\/\/ >>> order-stays core/.test(WIDGET));
}

console.log('A one-hotel booking is untouched');
{
  const html = renderPdfHtml(ONE, pdfOpts);
  ok('the hotel is shown', html.includes('Lambis Studios'));
  ok('no stay numbering appears', !html.includes('Stay 1 of'), 'a single stay must not be labelled 1 of 1');
  ok('the heading stays singular', html.includes('Your Hotel') && !html.includes('Your Hotels'));
  ok('its dates are right', html.includes('6 night'));
}

console.log('The selector cannot quietly go back to picking one');
{
  const PDF = readFileSync(new URL('../public/_pdf-template.js', import.meta.url), 'utf8');
  const MAIL = readFileSync(new URL('../public/_booking-email-template.js', import.meta.url), 'utf8');
  const WIDGET = readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8');
  for (const [name, src] of [['the PDF', PDF], ['the email', MAIL], ['the widget', WIDGET]]) {
    ok(name + ' reads the shared list', /listStays\(/.test(src));
  }
  // The exact pattern that caused it, in a render path.
  ok('no document renders from a lone .find() for accommodation',
    !/const acc(om)?Item = (order\?\.)?items\??\.find\(/.test(PDF.replace(/\|\|[\s\S]{0,200}?fallback/g, '')),
    'the fallbacks may keep a find, but the render must come from listStays');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
