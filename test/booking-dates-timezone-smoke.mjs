/**
 * A booking date says the same thing in every timezone (15 Sep 2026).
 *
 * Exclusively Travel, booking ET121109, reported by Andy: "when you look at the
 * booking on the screen, it shows as 6 nights with check-out on 1 October, but
 * it is 2 October". The PDF, from the same shared calculation, said 2 October
 * and was right.
 *
 * Travelify writes a check-in as "2026-09-26T00:00:00": a date wearing a time,
 * with no zone on it. That is a wall clock, not an instant. new Date() parses
 * it in the READER's timezone, so in British Summer Time it lands at 23:00 on
 * the 25th in UTC, and counting six days in UTC reads back 1 Oct. On the
 * server the clock IS UTC, which is exactly why the paperwork was right and
 * the screen was wrong, and why no test caught it: every fixture in the suite
 * used tidy date-only strings, and the test runner runs in UTC.
 *
 * Two more of the same family were found with it: a date-only value read a day
 * early for anyone behind UTC (New York saw 1 Oct for 2026-10-02), and a
 * flight time written as 14:00 printed 13:00 in British Summer Time and 18:00
 * in New York.
 *
 * A second client hit the same thing the same day: Your Ticket Genie, seven
 * nights at Universal's Cabana Bay Beach Resort from Wed 21 Oct, shown checking
 * out Tue 27 Oct instead of Wed 28 Oct. That stay runs through the weekend the
 * British clocks go back, so it is kept here as its own case: the arithmetic is
 * calendar days now and a clock change cannot reach it.
 *
 * So this suite re-runs itself in four timezones and asserts the same answers
 * in each, from the shared calculation, the REAL widget rendered in jsdom, and
 * the REAL PDF and email templates.
 *
 * Run: node test/booking-dates-timezone-smoke.mjs  (npm run test:booking-dates-tz)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ZONES = ['UTC', 'Europe/London', 'America/New_York', 'Australia/Sydney'];
const HERE = fileURLToPath(import.meta.url);

// ── Parent: run the checks once per zone ─────────────────────────────────────
if (!process.env.TG_TZ_CHILD) {
  let failed = 0, passed = 0;
  for (const tz of ZONES) {
    console.log('\n── ' + tz + ' ' + '─'.repeat(Math.max(0, 60 - tz.length)));
    const run = spawnSync(process.execPath, [HERE], {
      encoding: 'utf8',
      env: { ...process.env, TZ: tz, TG_TZ_CHILD: '1' },
    });
    process.stdout.write(run.stdout || '');
    process.stderr.write(run.stderr || '');
    const m = /(\d+) passed, (\d+) failed/.exec(run.stdout || '');
    if (m) { passed += Number(m[1]); failed += Number(m[2]); }
    else { failed += 1; console.error('  ✗ ' + tz + ' did not report a result'); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed across ' + ZONES.length + ' timezones');
  process.exit(failed ? 1 : 0);
}

// ── Child: one timezone ──────────────────────────────────────────────────────
const { JSDOM } = await import('jsdom');
const { listStays, stayCheckout, stayDay, bookingMoment } = await import('../public/_order-stays.js');
const { renderPdfHtml } = await import('../public/_pdf-template.js');
const { renderBookingEmail } = await import('../public/_booking-email-template.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

// ET121109 as Travelify actually sends it: a date wearing a time, no zone.
const stay = (name, checkin, nights, price, room) => ({
  id: name.length, status: 'Confirmed', product: 'Accommodation', bookingReference: 'ET121109',
  price, currency: 'GBP', startDate: checkin, duration: nights,
  accommodation: {
    name, propertyType: 'Hotel', rating: 3,
    location: { address1: 'Krana', city: 'Lindos', state: 'Rhodes', country: 'GR' },
    units: [{ name: room, roomType: room, checkin, nights, rates: [{ board: 'RoomOnly' }], sleepsAdults: 1, sleepsChildren: 0 }],
    pricing: { price, currency: 'GBP', isRefundable: false },
    guests: [{ type: 'Lead', title: 'Mrs', firstname: 'Gemma', surname: 'Whitaker' }],
    media: [],
  },
});
const ORDER = {
  id: 64026875, status: 'Confirmed', customerTitle: 'Mrs', customerFirstname: 'Gemma',
  customerSurname: 'Whitaker', customerEmail: 'gemwhitaker@icloud.com',
  created: '2026-09-13T00:00:00', currency: 'GBP', bookingReference: 'ET121109',
  summary: { totalPrice: 1158, hasAccommodation: true,
    travellers: [{ type: 'Lead', title: 'Mrs', firstname: 'Gemma', surname: 'Whitaker' }] },
  items: [
    stay('Lambis Studios', '2026-09-26T00:00:00', 6, 772, 'Suite'),
    stay('Lambis Studios', '2026-10-02T00:00:00', 3, 386, 'Family Apartment'),
    { id: 9, status: 'Confirmed', product: 'Flights', price: 0, currency: 'GBP',
      startDate: '2026-09-26T00:00:00', duration: 9,
      flights: {
        fareType: 'Return', pricing: { currency: 'GBP', price: 0 },
        routes: [{
          direction: 'Outbound', duration: 240,
          segments: [{
            origin: { iataCode: 'MAN', name: 'Manchester' },
            destination: { iataCode: 'RHO', name: 'Rhodes' },
            depart: '2026-09-26T14:00:00', arrive: '2026-09-26T19:30:00',
            marketingCarrier: { code: 'LS', name: 'Jet2' }, flightNo: 'LS123',
          }],
        }],
        travellers: [{ type: 'Adult', title: 'Mrs', firstname: 'Gemma', surname: 'Whitaker' }],
        fareInformation: [],
      } },
  ],
};

console.log('The calculation counts calendar days, not clock time');
{
  const stays = listStays(ORDER);
  ok('six nights from 26 Sept check out on 2 Oct', stays[0].checkout === '2026-10-02', stays[0].checkout);
  ok('three nights from 2 Oct check out on 5 Oct', stays[1].checkout === '2026-10-05', stays[1].checkout);
  ok('a date-only check-in answers the same', stayCheckout('2026-09-26', 6) === '2026-10-02');
  ok('a check-in with a real zone answers the same', stayCheckout('2026-09-26T23:30:00+03:00', 6) === '2026-10-02');
  ok('the calendar day is read off the string', stayDay('2026-09-26T00:00:00') === '2026-09-26' && stayDay('') === '');
  ok('a stay that runs through the October clock change still counts right',
    stayCheckout('2026-10-24T00:00:00', 3) === '2026-10-27', stayCheckout('2026-10-24T00:00:00', 3));
  ok('nonsense is still nothing', stayCheckout('not a date', 3) === null && bookingMoment('nope') === null);
}

console.log('The widget prints what the supplier wrote');
{
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://client.test/booking', pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  window.eval(readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8'));
  const host = window.document.getElementById('host');
  const inst = new window.TGMyBookingWidget(host, {});
  inst.lookup = { email: ORDER.customerEmail, date: '2026-09-26', ref: 'ET121109' };
  inst.state = { stage: 'found', order: ORDER, error: null };
  inst._render();
  const html = host.shadowRoot.innerHTML;

  ok('the widget rendered the booking', /Lambis Studios/.test(html), html.slice(0, 120));
  ok('the first stay checks out on 2 Oct, not 1 Oct', /2 Oct/.test(html) && !/>1 Oct</.test(html));
  ok('the second stay checks out on 5 Oct, not 4 Oct', /5 Oct/.test(html) && !/>4 Oct</.test(html));
  ok('the check-in is still 26 Sept', /26 Sept/.test(html));
  ok('the weekday matches the date it is printed beside', /Fri/.test(html) && /Sat/.test(html));
  ok('a 14:00 flight prints as 14:00', /14:00/.test(html) && !/13:00/.test(html) && !/18:00/.test(html));
}

console.log('The second client, through the weekend the clocks go back');
{
  // Your Ticket Genie, reported 15 Sep 2026: "exactly the same issue on another
  // booking with a different client". Check-in Wed 21 Oct, seven nights, shown
  // checking out Tue 27 Oct. British clocks go back on Sunday 25 Oct 2026, in
  // the middle of the stay.
  const YTG = {
    id: 64099001, status: 'Confirmed', customerTitle: 'Mrs', customerFirstname: 'Katherine',
    customerSurname: 'GHIO', customerEmail: 'k.ghio@example.com', bookingReference: 'YTG44021',
    created: '2026-08-02T00:00:00', currency: 'GBP',
    summary: { totalPrice: 721.73, hasAccommodation: true,
      travellers: [{ type: 'Lead', title: 'Mrs', firstname: 'Katherine', surname: 'GHIO' }] },
    items: [{
      id: 1, status: 'Confirmed', product: 'Accommodation', bookingReference: 'YTG44021',
      price: 721.73, currency: 'GBP', startDate: '2026-10-21T00:00:00', duration: 7,
      accommodation: {
        name: "Universal's Cabana Bay Beach Resort", propertyType: 'Hotel', rating: 3,
        location: { address1: '6550 Adventure Way', city: 'Orlando', state: 'FL', country: 'US' },
        units: [{ name: 'Standard Quadruple room', roomType: 'Standard Quadruple',
          checkin: '2026-10-21T00:00:00', nights: 7, rates: [{ board: 'RoomOnly' }],
          sleepsAdults: 2, sleepsChildren: 2 }],
        pricing: { price: 721.73, currency: 'GBP', isRefundable: false },
        guests: [{ type: 'Lead', title: 'Mrs', firstname: 'Katherine', surname: 'GHIO' }], media: [],
      },
    }],
  };
  const st = listStays(YTG)[0];
  ok('seven nights from 21 Oct check out on 28 Oct', st.checkout === '2026-10-28', st.checkout);
  ok('the check-in is a Wednesday and so is the check-out',
    new Date(st.checkin + 'T00:00:00Z').getUTCDay() === 3 && new Date(st.checkout + 'T00:00:00Z').getUTCDay() === 3);

  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://yourticketgenie.com/my-booking', pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  window.eval(readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8'));
  const host = window.document.getElementById('host');
  const inst = new window.TGMyBookingWidget(host, {});
  inst.lookup = { email: YTG.customerEmail, date: '2026-10-21', ref: 'YTG44021' };
  inst.state = { stage: 'found', order: YTG, error: null };
  inst._render();
  const html = host.shadowRoot.innerHTML;
  ok('the page says 28 Oct, not 27 Oct', /28 Oct/.test(html) && !/>27 Oct</.test(html));
  ok('and still says seven nights', /7/.test(html) && /1 week|7 nights/.test(html));

  const pdf = renderPdfHtml(YTG, { brandName: 'Your Ticket Genie' });
  ok('the PDF agrees', /28 October 2026/.test(pdf) && !/27 October 2026/.test(pdf));
}

console.log('The paperwork says the same as the screen');
{
  const pdf = renderPdfHtml(ORDER, { brandName: 'Exclusively Travel' });
  ok('the PDF checks out on 2 October and 5 October',
    /2 October 2026/.test(pdf) && /5 October 2026/.test(pdf));
  ok('and never on the day before', !/1 October 2026/.test(pdf) && !/4 October 2026/.test(pdf));
  const mail = renderBookingEmail({ order: ORDER, orderRef: 'ET121109', brand: { name: 'Exclusively Travel' } }).html;
  ok('the email agrees', /2 Oct 2026/.test(mail) && /5 Oct 2026/.test(mail));
  ok('and the flight time is the one on the ticket', /14:00/.test(pdf) && !/13:00/.test(pdf));
}

console.log('A leg says the same length and the same day in every timezone');
{
  // ET122149, Exclusively Travel, 21 Sep 2026. Travelify dresses airport-local
  // times as UTC, so the outbound reads 12:55 at LTN to 19:10 at RHO: 6h15m
  // apart on the face of it, and 255 minutes in the feed, because Rhodes is
  // two hours ahead. Two things came out of that. The duration must be the one
  // the supplier states, not our own arithmetic on two clocks in different
  // places. And the "+1" marker must compare the two CALENDAR dates the
  // supplier wrote: read as instants in the visitor's zone, this same-day
  // flight wore a "+1" for anyone in Sydney.
  const leg = (direction, from, to, depart, arrive, flightNo, duration) => ({
    legID: 0, direction, duration,
    segments: [{
      origin: { iataCode: from, name: from }, destination: { iataCode: to, name: to },
      depart, arrive, duration, cabinClass: 'Economy', fareName: 'Standard',
      marketingCarrier: { code: 'U2', name: 'Easyjet' }, flightNo, touchdowns: 0,
    }],
  });
  const ET122149 = {
    id: 122149, status: 'Confirmed', bookingReference: 'ET122149',
    customerTitle: 'Mrs', customerFirstname: 'Gillian', customerSurname: 'Clark',
    customerEmail: 'gill.clark@example.com', currency: 'GBP', created: '2026-09-20T08:25:00Z',
    summary: { totalPrice: 592, hasFlights: true, travellers: [{ type: 'Adult', title: 'Mrs', firstname: 'Gillian', surname: 'Clark' }] },
    items: [{
      id: 111089, status: 'Confirmed', product: 'Flights', price: 592, currency: 'GBP',
      startDate: '2026-10-02T00:00:00', duration: 14,
      flights: {
        fareType: 'LowCost', pricing: { currency: 'GBP', price: 592 },
        routes: [
          leg('Outbound', 'LTN', 'RHO', '2026-10-02T12:55:00Z', '2026-10-02T19:10:00Z', 'EZY2381', 255),
          leg('Inbound', 'RHO', 'LTN', '2026-10-16T19:55:00Z', '2026-10-16T22:20:00Z', 'EZY2382', 265),
        ],
        travellers: [{ type: 'Adult', title: 'Mrs', firstname: 'Gillian', surname: 'Clark' }],
        fareInformation: [],
      },
    }],
  };

  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://client.test/booking', pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  window.eval(readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8'));
  const host = window.document.getElementById('host');
  const inst = new window.TGMyBookingWidget(host, {});
  inst.lookup = { email: ET122149.customerEmail, date: '2026-10-02', ref: 'ET122149' };
  inst.state = { stage: 'found', order: ET122149, error: null };
  inst._render();
  const html = host.shadowRoot.innerHTML;

  ok('the outbound reads 4h 15m, the duration Travelify states', /4h 15m/.test(html) && !/6h 15m/.test(html));
  ok('the return reads 4h 25m', /4h 25m/.test(html) && !/2h 25m/.test(html));
  ok('the times are the ones on the ticket', /12:55/.test(html) && /19:10/.test(html) && /19:55/.test(html) && /22:20/.test(html));
  ok('neither same-day leg wears a "+1"', !/tgm-leg-plus">\+/.test(html));

  const pdf = renderPdfHtml(ET122149, { brandName: 'Exclusively Travel' });
  ok('the PDF prints the same two durations', /4h 15m/.test(pdf) && /4h 25m/.test(pdf) && !/6h 15m/.test(pdf));
  ok('and no "+1" on it either', !/\+1<\/sup>/.test(pdf));

  // A real overnight must still be marked, in every zone.
  const red = JSON.parse(JSON.stringify(ET122149));
  red.items[0].flights.routes = [leg('Outbound', 'LHR', 'SIN', '2026-10-02T21:30:00Z', '2026-10-03T17:05:00Z', 'SQ317', 785)];
  inst.state = { stage: 'found', order: red, error: null };
  inst._render();
  const redHtml = host.shadowRoot.innerHTML;
  ok('an arrival on the next day is marked "+1"', /tgm-leg-plus">\+1</.test(redHtml));
  ok('and it reads 13h 5m, as stated', /13h 5m/.test(redHtml));
  ok('the PDF marks the overnight too', /\+1<\/sup>/.test(renderPdfHtml(red, { brandName: 'Exclusively Travel' })));

  // No duration on the route: fall back to adding the segments up rather than
  // printing nothing.
  const noDur = JSON.parse(JSON.stringify(ET122149));
  noDur.items[0].flights.routes[0].duration = null;
  inst.state = { stage: 'found', order: noDur, error: null };
  inst._render();
  ok('a route with no duration falls back to its segments', /4h 15m/.test(host.shadowRoot.innerHTML));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
