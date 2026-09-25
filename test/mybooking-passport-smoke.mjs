/**
 * My Booking: passport details (FOID) on a flight (25 Sep 2026).
 *
 * From the spec "My Booking widget: passenger FOID (passport) capture for
 * flights". Its twelve acceptance criteria, against its own example order
 * (id 122410, key 140E0F96-..., flight item 111371, outbound 2027-04-09,
 * return 2027-04-16, today 2026-09-25), are numbered [1] to [12] below, and
 * run at three levels:
 *   - the rules module, with today pinned, so the spec's own dates hold;
 *   - the real /api/retrieve-order and /api/update-passport handlers, against
 *     a stand-in Travelify, with dates counted from the real today so the
 *     suite does not age;
 *   - the real widget in jsdom, from what retrieve-order actually returns.
 *
 * Run: node test/mybooking-passport-smoke.mjs   (npm run test:mybooking-passport)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
process.env.AIRTABLE_KEY = 'test-airtable-key';

const rules = await import('../public/_passport-rules.js');
const { passportState, passengerBody } = await import('../api/_lib/passport-foid.js');
const retrieve = (await import('../api/retrieve-order.js')).default;
const update = (await import('../api/update-passport.js')).default;

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The spec's example order, as Travelify sends it ─────────────────────────
const ORDER_ID = 122410;
const ORDER_KEY = '140E0F96-38C2-495E-B5F3-F1C5C7B49622';
const FLIGHT_ID = 111371;
const HOTEL_ID = 111370;
const DANIEL = {
  type: 'Adult', title: 'Mr', firstname: 'Daniel', middleNames: '', surname: 'Reilly',
  dateOfBirth: '1987-02-24T00:00:00Z', gender: 'Male', nationality: 'GB',
};
const SARAH = {
  type: 'Adult', title: 'Mrs', firstname: 'Sarah', middleNames: 'Anne', surname: 'Reilly',
  dateOfBirth: '1989-06-11T00:00:00Z', gender: 'Female', nationality: 'GB',
};
const BABY = { type: 'Infant', title: 'Miss', firstname: 'Ella', middleNames: '', surname: 'Reilly', dateOfBirth: '2026-01-02T00:00:00Z', gender: 'Female', nationality: 'GB' };

const seg = (from, to, depart, arrive) => ({ origin: { iataCode: from }, destination: { iataCode: to }, depart, arrive, duration: 150 });
function flightData({ out = '2027-04-09', back = '2027-04-16', travellers = [DANIEL], canEditFOID = true, oneWay = false } = {}) {
  const d = {
    travellers,
    routes: [{ direction: 'Outbound', segments: [seg('LGW', 'PMI', out + 'T06:30:00', out + 'T09:40:00')] }]
      .concat(oneWay ? [] : [{ direction: 'Inbound', segments: [seg('PMI', 'LGW', back + 'T10:20:00', back + 'T11:45:00')] }]),
  };
  // 'omit' leaves the flag off entirely (a plain undefined would take the default).
  if (canEditFOID !== 'omit') d.canEditFOID = canEditFOID;
  return d;
}
function rawOrder(flight, extra = []) {
  return {
    id: ORDER_ID, key: ORDER_KEY, orderRef: 'DEMO122410',
    customer: { email: 'daniel@example.com', firstname: 'Daniel', surname: 'Reilly' },
    items: [
      { id: HOTEL_ID, product: 'Accommodation', status: 'Booked', price: 900, startDate: flight.routes[0].segments[0].depart.slice(0, 10) + 'T00:00:00', duration: 7,
        dataObject: { name: 'Hotel Sol', location: { city: 'Palma', country: 'ES' }, units: [{ checkin: flight.routes[0].segments[0].depart.slice(0, 10), nights: 7 }], guests: flight.travellers } },
      { id: FLIGHT_ID, product: 'Flights', status: 'Booked', price: 400, startDate: flight.routes[0].segments[0].depart, dataObject: flight },
    ].concat(extra),
  };
}

// Days counted from the real today, for the handlers (which read the clock).
const TODAY = new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.UTC(+TODAY.slice(0, 4), +TODAY.slice(5, 7) - 1, +TODAY.slice(8, 10) + n)).toISOString().slice(0, 10);

// ── A stand-in Travelify and a response object ───────────────────────────────
function net({ order, update: upd = { status: 200, body: { success: true } } }) {
  const calls = [];
  const logs = [];
  const real = { fetch: globalThis.fetch, log: console.log, warn: console.warn, error: console.error };
  const capture = (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  console.log = capture; console.warn = capture; console.error = capture;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    if (u.startsWith('https://redis.test.invalid')) return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
    if (u.includes('/updatepaxfoid/')) {
      if (upd.throws) throw new Error('The operation was aborted due to timeout');
      return new Response(typeof upd.body === 'string' ? upd.body : JSON.stringify(upd.body), { status: upd.status });
    }
    if (u.includes('api.travelify.io')) return new Response(JSON.stringify(order), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  return {
    calls, logs,
    restore() { Object.assign(console, { log: real.log, warn: real.warn, error: real.error }); globalThis.fetch = real.fetch; },
  };
}
let ipSeq = 0;
function reqRes(body) {
  const ip = '198.51.100.' + (++ipSeq % 250);
  const out = { code: 0, body: null, headers: {} };
  const res = {
    status(c) { out.code = c; return res; },
    json(b) { out.body = b; return res; },
    end() { return res; },
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; return res; },
  };
  return { req: { method: 'POST', headers: { 'x-forwarded-for': ip }, body }, res, out };
}
const LOOKUP = { widgetId: 'DEMO_WIDGET_ID', emailAddress: 'daniel@example.com', departDate: '2027-04-09', orderRef: 'DEMO122410' };
const retrieveLogs = [];
async function runRetrieve(order) {
  const n = net({ order });
  const { req, res, out } = reqRes(Object.assign({}, LOOKUP));
  try { await retrieve(req, res); } finally { n.restore(); }
  retrieveLogs.push(...n.logs);
  return out;
}
async function runUpdate(order, passengers, opts = {}) {
  const n = net({ order, update: opts.update });
  const { req, res, out } = reqRes(Object.assign({}, LOOKUP, { itemId: opts.itemId || FLIGHT_ID, passengers }));
  try { await update(req, res); } finally { n.restore(); }
  const call = n.calls.find((c) => c.url.includes('/updatepaxfoid/'));
  return { out, call, calls: n.calls, logs: n.logs };
}

const GOOD = { number: 'X1234567', country: 'GB', issued: '2020-10-01', expires: '2030-09-30' };

console.log('\nThe rules, on the spec\'s own dates');
{
  const d = flightData();
  const e = rules.ppEligibility(d, '2026-09-25');
  ok('[1] canEditFOID true and departure months away: editable', e.editable && e.people.length === 1 && e.people[0].traveller.firstname === 'Daniel');
  ok('the outbound departure is 2027-04-09 and the trip ends 2027-04-16', e.departDay === '2027-04-09' && e.lastDay === '2027-04-16');
  ok('[3] on 2027-04-08, the day before: still editable', rules.ppEligibility(d, '2027-04-08').editable);
  ok('[3] on 2027-04-09, departure day: not', !rules.ppEligibility(d, '2027-04-09').editable);
  ok('[3] and not after', !rules.ppEligibility(d, '2027-04-10').editable);
  ok('[4] canEditFOID missing: not editable', !rules.ppEligibility(flightData({ canEditFOID: 'omit' }), '2026-09-25').editable);
  ok('[4] canEditFOID false: not editable', !rules.ppEligibility(flightData({ canEditFOID: false }), '2026-09-25').editable);
  ok('[4] canEditFOID the string "true": not editable (boolean true only)', !rules.ppEligibility(flightData({ canEditFOID: 'true' }), '2026-09-25').editable);
  ok('[4] canEditFOID null or 1: not editable', !rules.ppEligibility(flightData({ canEditFOID: null }), '2026-09-25').editable
    && !rules.ppEligibility(flightData({ canEditFOID: 1 }), '2026-09-25').editable);
  const v = (x) => rules.ppValidate(Object.assign({}, GOOD, x), '2027-04-16', '2026-09-25');
  ok('a good passport passes', Object.keys(v({}).errors).length === 0);
  ok('[5] an issue date of today is rejected', v({ issued: '2026-09-25' }).errors.issued === 'notPast');
  ok('[5] and of any later day', v({ issued: '2026-10-01' }).errors.issued === 'notPast');
  ok('[6] an expiry of 2027-04-16, the day they fly home, is rejected', v({ expires: '2027-04-16' }).errors.expires === 'tooSoon');
  ok('[6] and anything before it', v({ expires: '2027-01-01' }).errors.expires === 'tooSoon');
  ok('[6] 2027-04-17 is accepted', !v({ expires: '2027-04-17' }).errors.expires);
  ok('expiry must follow the issue date too', v({ issued: '2025-01-01', expires: '2027-04-17' }).errors.expires === undefined
    && rules.ppValidate(Object.assign({}, GOOD, { issued: '2026-09-01', expires: '2026-08-01' }), '', '2026-09-25').errors.expires === 'beforeIssue');
  ok('a one-way flight: the passport must outlast the last outbound arrival',
    rules.ppFlightDays(flightData({ oneWay: true })).lastDay === '2027-04-09');
  ok('the number: letters and digits only, 5 to 20, stored upper case',
    v({ number: ' ab12345 ' }).value.number === 'AB12345' && !v({ number: ' ab12345 ' }).errors.number
    && v({ number: 'AB 12345' }).errors.number === 'format' && v({ number: 'AB12' }).errors.number === 'format'
    && v({ number: 'A'.repeat(21) }).errors.number === 'format' && v({ number: 'AB-12345' }).errors.number === 'format');
  ok('the country must be a real ISO code', v({ country: 'UK' }).errors.country === 'country' && v({ country: 'gb' }).value.country === 'GB');
  ok('all four are required', ['number', 'country', 'issued', 'expires'].every((f) => v({ [f]: '' }).errors[f] === 'required'));
  ok('a date that does not exist is not a date', v({ issued: '2021-02-30' }).errors.issued === 'date');
  ok('[12] an infant never gets a block', rules.ppEligibility(flightData({ travellers: [DANIEL, BABY] }), '2026-09-25').people.map((p) => p.index).join() === '0');
  ok('[12] a flight of infants only offers nothing', !rules.ppEligibility(flightData({ travellers: [BABY] }), '2026-09-25').editable);
  ok('Infant is read case-insensitively', rules.ppIsInfant({ Type: 'INFANT' }));
  ok('fields are read in either case (CanEditFOID, Travellers, FOIDNumber)',
    rules.ppEligibility({ CanEditFOID: true, Travellers: [{ Type: 'Adult', FOIDNumber: 'x1234567' }], Routes: [{ Direction: 'Outbound', Segments: [{ Depart: '2027-04-09T06:30:00', Arrive: '2027-04-09T09:00:00' }] }] }, '2026-09-25').editable
    && rules.ppExisting({ FOIDNumber: 'x1234567', foidissuingcountry: 'gb', FoidStartDate: '2020-10-01T00:00:00', FOIDExpiryDate: '2030-09-30' }).number === 'X1234567');
  ok('missing, null or empty FOID values count as not yet added', !rules.ppComplete(rules.ppExisting({ foidNumber: null, foidIssuingCountry: '' })));
  ok('the number shows only its last four once editing has closed', rules.ppMask('X1234567') === '••••4567');
}

console.log('\nThe request body: every order field as the order holds it, plus the passport');
{
  const body = passengerBody(DANIEL, { number: '12345678', country: 'GB', issued: '2020-10-01', expires: '2030-09-30' });
  const want = {
    Type: 'Adult', Title: 'Mr', Firstname: 'Daniel', MiddleNames: '', Surname: 'Reilly',
    DateOfBirth: '1987-02-24T00:00:00Z', Gender: 'Male', Nationality: 'GB',
    FOIDType: 'Passport', FOIDNumber: '12345678', FOIDIssuingCountry: 'GB', FOIDStartDate: '2020-10-01', FOIDExpiryDate: '2030-09-30',
  };
  ok('the spec\'s own example body, exactly', JSON.stringify(body) === JSON.stringify(want), JSON.stringify(body));
  const extra = passengerBody(Object.assign({ id: 77, paxRef: 'P1', foidNumber: 'OLD123', FOIDType: 'Passport' }, DANIEL), GOOD);
  ok('a field the spec does not list is carried too, not dropped', extra.Id === 77 && extra.PaxRef === 'P1');
  ok('an old passport value is replaced, never sent twice', !('FoidNumber' in extra) && extra.FOIDNumber === 'X1234567' && Object.keys(extra).filter((k) => /^foidnumber$/i.test(k)).length === 1);
  ok('one naming convention for the whole passenger (PascalCase)', Object.keys(extra).every((k) => /^[A-Z]/.test(k)));
}

console.log('\nWhat /api/retrieve-order hands the page');
let trimmed = null;
{
  const out = await runRetrieve(rawOrder(flightData({ out: day(30), back: day(37), travellers: [DANIEL, SARAH, BABY] })));
  trimmed = out.body && out.body.order;
  const flight = trimmed && trimmed.items.find((i) => i.id === FLIGHT_ID);
  const hotel = trimmed && trimmed.items.find((i) => i.id === HOTEL_ID);
  ok('the booking comes back', out.code === 200 && !!flight, JSON.stringify(out.body).slice(0, 200));
  ok('the flight carries a passport block, editable', !!(flight && flight.passports && flight.passports.editable));
  ok('[2] the accommodation carries none', !!hotel && !hotel.passports);
  ok('[12] two adults on it, the infant left out', flight && flight.passports.travellers.map((t) => t.firstname).join() === 'Daniel,Sarah');
  ok('each with its place in the flight\'s own list', flight && flight.passports.travellers.map((t) => t.index).join() === '0,1');
  ok('the days the page needs', flight && flight.passports.departDay === day(30) && flight.passports.lastDay === day(37));
  ok('and nothing on the way may keep a copy', out.headers['cache-control'] === 'no-store');

  const withPass = Object.assign({}, DANIEL, { foidType: 'Passport', foidNumber: 'P9988776', foidIssuingCountry: 'IE', foidStartDate: '2019-05-01T00:00:00', foidExpiryDate: '2029-04-30T00:00:00' });
  const pre = (await runRetrieve(rawOrder(flightData({ out: day(30), back: day(37), travellers: [withPass] })))).body.order.items.find((i) => i.id === FLIGHT_ID);
  ok('[9] a passport on file comes back in full while it can be edited, to fill the form',
    JSON.stringify(pre.passports.travellers[0].passport) === JSON.stringify({ number: 'P9988776', country: 'IE', issued: '2019-05-01', expires: '2029-04-30' }));
  const closed = (await runRetrieve(rawOrder(flightData({ out: TODAY, back: day(7), travellers: [withPass] })))).body.order.items.find((i) => i.id === FLIGHT_ID);
  ok('on departure day it comes back read-only, the number masked', closed.passports && !closed.passports.editable
    && closed.passports.travellers[0].passport.masked === '••••8776' && !('number' in closed.passports.travellers[0].passport));
  ok('and the full number is nowhere in the answer', !JSON.stringify(closed).includes('P9988776'));
  ok('nor in any log line, the demo account\'s debug preview of the raw order included', retrieveLogs.length > 0 && !retrieveLogs.some((l) => l.includes('P9988776')),
    retrieveLogs.filter((l) => l.includes('P9988776')).join(' | ').slice(0, 300));
  const nothing = (await runRetrieve(rawOrder(flightData({ out: day(30), back: day(37), canEditFOID: false })))).body.order.items.find((i) => i.id === FLIGHT_ID);
  ok('[4] canEditFOID false and nothing on file: no block at all', !nothing.passports);
  const pkgOrder = rawOrder(flightData({ out: day(30), back: day(37) }));
  pkgOrder.items.push({ id: 111399, product: 'Packages', price: 1, dataObject: Object.assign({ name: 'Pkg', units: [] }, flightData({ out: day(30), back: day(37) })) });
  const pkg = (await runRetrieve(pkgOrder)).body.order.items.find((i) => i.id === 111399);
  ok('a package\'s flights are not a Flights item: no block', pkg && !pkg.passports);
}

console.log('\nWhat /api/update-passport sends, and when it refuses');
{
  const order = rawOrder(flightData({ out: day(30), back: day(37), travellers: [DANIEL, SARAH, BABY] }));
  const r = await runUpdate(order, [{ index: 0, number: '12345678', country: 'GB', issued: '2020-10-01', expires: day(60) }]);
  ok('accepted', r.out.body && r.out.body.success === true && r.out.body.saved === 1, JSON.stringify(r.out.body));
  ok('[8] to https://api.travelify.io/updatepaxfoid/122410/140E0F96-.../111371',
    r.call && r.call.url === 'https://api.travelify.io/updatepaxfoid/122410/140E0F96-38C2-495E-B5F3-F1C5C7B49622/111371', r.call && r.call.url);
  ok('as a POST with our credentials and the server-side Referer', r.call && r.call.method === 'POST'
    && /^Token 250:/.test(r.call.headers.Authorization) && r.call.headers.Referer === 'https://localhost/' && r.call.headers['Content-Type'] === 'application/json');
  const p = r.call && r.call.body.Passengers;
  ok('[11] only the passenger who changed', Array.isArray(p) && p.length === 1 && p[0].Firstname === 'Daniel');
  ok('[8] with every non-passport field exactly as the order holds it',
    p && p[0].Type === 'Adult' && p[0].Title === 'Mr' && p[0].MiddleNames === '' && p[0].Surname === 'Reilly'
    && p[0].DateOfBirth === '1987-02-24T00:00:00Z' && p[0].Gender === 'Male' && p[0].Nationality === 'GB');
  ok('[7] the country as its code, GB', p && p[0].FOIDIssuingCountry === 'GB' && p[0].FOIDType === 'Passport');
  ok('the dates as plain days, unshifted', p && p[0].FOIDStartDate === '2020-10-01' && p[0].FOIDExpiryDate === day(60));
  ok('the passport number is in no log line', !r.logs.some((l) => l.includes('12345678')), r.logs.join(' | '));

  const tamper = await runUpdate(order, [{ index: 0, number: '12345678', country: 'GB', issued: '2020-10-01', expires: day(60), firstname: 'Mallory', Surname: 'Hacker', dateOfBirth: '2000-01-01' }]);
  const tp = tamper.call && tamper.call.body.Passengers[0];
  ok('a name or birth date sent by the page is ignored: the order\'s own go', tp && tp.Firstname === 'Daniel' && tp.Surname === 'Reilly' && tp.DateOfBirth === '1987-02-24T00:00:00Z');

  const inf = await runUpdate(order, [{ index: 2, number: 'INF12345', country: 'GB', issued: '2026-02-01', expires: day(90) }]);
  ok('[12] an infant is never sent, even when asked', !inf.call && inf.out.body.nothing === true);

  const twoOrder = rawOrder(flightData({ out: day(30), back: day(37), travellers: [Object.assign({}, DANIEL, { foidNumber: 'X1234567', foidIssuingCountry: 'GB', foidStartDate: '2020-10-01', foidExpiryDate: '2030-09-30' }), SARAH] }));
  const same = await runUpdate(twoOrder, [{ index: 0, number: 'x1234567 ', country: 'gb', issued: '2020-10-01', expires: '2030-09-30' }]);
  ok('[9] resubmitting what is already held calls nothing', !same.call && same.out.body.nothing === true && same.out.body.success === false);
  const one = await runUpdate(twoOrder, [
    { index: 0, number: 'X1234567', country: 'GB', issued: '2020-10-01', expires: '2030-09-30' },
    { index: 1, number: 'S7654321', country: 'GB', issued: '2021-03-03', expires: day(400) },
  ]);
  ok('[11] two sent, one unchanged: only the changed one goes', one.call && one.call.body.Passengers.length === 1 && one.call.body.Passengers[0].Firstname === 'Sarah');

  const refused = await runUpdate(order, [{ index: 0, ...GOOD, expires: day(60) }], { update: { status: 200, body: { success: false, error: 'Could not update order' } } });
  ok('[10] Travelify\'s own error comes back to show', refused.out.body.success === false && refused.out.body.error === 'Could not update order');
  const five = await runUpdate(order, [{ index: 0, ...GOOD, expires: day(60) }], { update: { status: 502, body: '<html>bad gateway</html>' } });
  ok('a 5xx becomes our own words, not a stack of HTML', five.out.body.success === false && /couldn't save/.test(five.out.body.error));
  const junk = await runUpdate(order, [{ index: 0, ...GOOD, expires: day(60) }], { update: { status: 200, body: 'not json' } });
  ok('so does a body that is not JSON', junk.out.body.success === false && /couldn't save/.test(junk.out.body.error));
  const timeout = await runUpdate(order, [{ index: 0, ...GOOD, expires: day(60) }], { update: { throws: true } });
  ok('and a timeout', timeout.out.body.success === false && /couldn't save/.test(timeout.out.body.error));
  ok('none of which logs the number', ![refused, five, junk, timeout].some((x) => x.logs.some((l) => l.includes('X1234567'))));

  const bad = await runUpdate(order, [{ index: 0, number: 'X1234567', country: 'GB', issued: TODAY, expires: day(37) }]);
  ok('[5][6] the server checks the fields again: issue today and expiry on the last day are refused',
    !bad.call && bad.out.body.fields && bad.out.body.fields[0].issued === 'notPast' && bad.out.body.fields[0].expires === 'tooSoon', JSON.stringify(bad.out.body));

  const dday = rawOrder(flightData({ out: TODAY, back: day(7) }));
  const late = await runUpdate(dday, [{ index: 0, ...GOOD, expires: day(60) }]);
  ok('[3] on departure day the server refuses, whatever the page thought', !late.call && late.out.body.closed === true);
  const tomorrow = rawOrder(flightData({ out: day(1), back: day(7) }));
  const inTime = await runUpdate(tomorrow, [{ index: 0, ...GOOD, expires: day(60) }]);
  ok('[3] the day before departure is still in time', !!inTime.call && inTime.out.body.success === true);
  const noFlag = await runUpdate(rawOrder(flightData({ out: day(30), back: day(37), canEditFOID: 'omit' })), [{ index: 0, ...GOOD }]);
  ok('[4] without canEditFOID the server refuses too', !noFlag.call && noFlag.out.body.closed === true);
  const hotel = await runUpdate(order, [{ index: 0, ...GOOD }], { itemId: HOTEL_ID });
  ok('[2] the accommodation item is not a flight: refused', !hotel.call && hotel.out.body.success === false);
  const notOurs = await runUpdate(order, [{ index: 0, ...GOOD }], { itemId: 999999 });
  ok('an item that is not on this order: refused', !notOurs.call && notOurs.out.body.success === false);
  const pascal = rawOrder({ CanEditFOID: true, Travellers: [{ Type: 'Adult', Title: 'Mr', Firstname: 'Daniel', Surname: 'Reilly', DateOfBirth: '1987-02-24T00:00:00Z' }],
    Routes: [{ Direction: 'Outbound', Segments: [seg('LGW', 'PMI', day(30) + 'T06:30:00', day(30) + 'T09:40:00')] }, { Direction: 'Inbound', Segments: [seg('PMI', 'LGW', day(37) + 'T10:00:00', day(37) + 'T11:30:00')] }],
    routes: [{ direction: 'Outbound', segments: [seg('LGW', 'PMI', day(30) + 'T06:30:00', day(30) + 'T09:40:00')] }] });
  const pr = await runUpdate(pascal, [{ index: 0, ...GOOD, expires: day(60) }]);
  ok('an order written in PascalCase is read just the same', !!pr.call && pr.call.body.Passengers[0].Firstname === 'Daniel');
}

console.log('\nThe page: the form in the flight card');
{
  const WIDGET = readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8');
  const withPass = Object.assign({}, DANIEL, { foidType: 'Passport', foidNumber: 'P9988776', foidIssuingCountry: 'IE', foidStartDate: '2019-05-01', foidExpiryDate: '2029-04-30' });
  const orderFor = async (travellers, out = day(30), back = day(37)) => (await runRetrieve(rawOrder(flightData({ out, back, travellers })))).body.order;

  async function mount(order) {
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'https://client.example/booking', runScripts: 'dangerously', pretendToBeVisual: true });
    const { window } = dom;
    const posts = [];
    const stored = [];
    // Every write to localStorage or sessionStorage, whoever makes it.
    const origSet = window.Storage.prototype.setItem;
    window.Storage.prototype.setItem = function (k, v) { stored.push(k + '=' + v); return origSet.call(this, k, v); };
    let answer = { success: true, saved: 1 };
    let refreshOrder = order;
    window.fetch = async (url, init = {}) => {
      const u = String(url);
      const body = init.body ? JSON.parse(init.body) : null;
      posts.push({ url: u, body });
      if (u.includes('/api/update-passport')) return { ok: true, status: typeof answer.__status === 'number' ? answer.__status : 200, json: async () => answer };
      if (u.includes('/api/retrieve-order')) return { ok: true, status: 200, json: async () => ({ order: refreshOrder, upsell: [] }) };
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };
    const s = window.document.createElement('script'); s.textContent = WIDGET; window.document.body.appendChild(s);
    const host = window.document.getElementById('host');
    const events = [];
    host.addEventListener('tg-mybooking:booking-loaded', (e) => events.push(e.detail));
    const inst = new window.TGMyBookingWidget(host, { widgetId: 'tgw_passport_test' });
    inst.lookup = { email: 'daniel@example.com', date: day(30), ref: 'DEMO122410' };
    inst.state = { stage: 'found', order, error: null };
    inst._render();
    const $ = (sel) => inst.shadow.querySelector(sel);
    const $$ = (sel) => [...inst.shadow.querySelectorAll(sel)];
    const set = (index, f, v) => {
      const el = $(`[data-pp-index="${index}"] [data-pp-f="${f}"]`);
      el.value = v;
      el.dispatchEvent(new window.Event(f === 'country' ? 'change' : 'input', { bubbles: true }));
    };
    const save = async () => { $('[data-tgm-pp-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await sleep(20); };
    return { window, inst, $, $$, set, save, posts, stored, events,
      answer: (a) => { answer = a; }, refreshWith: (o) => { refreshOrder = o; } };
  }

  const order = await orderFor([DANIEL, SARAH, BABY]);
  const w = await mount(order);
  ok('[1] the flight card offers passport details', w.$$('.tgm-flight-card .tgm-pp').length === 1 && !!w.$('[data-tgm-pp-open]'));
  ok('[2] and it sits in the flight card only', w.$$('.tgm-pp').every((n) => n.closest('.tgm-flight-card')));
  ok('[12] one block per adult, none for the infant', w.$$('.tgm-pp-person').length === 2 && !w.$$('legend').some((l) => /Ella/.test(l.textContent)));
  ok('each block names the person', w.$$('.tgm-pp-person legend').map((l) => l.textContent).join('|') === 'Mr Daniel Reilly|Mrs Sarah Anne Reilly'.replace(' Anne', ''));
  ok('the form waits behind its button', w.$('[data-tgm-pp-form]').hidden === true);
  w.$('[data-tgm-pp-open]').click();
  ok('which opens it', w.$('[data-tgm-pp-form]').hidden === false);
  ok('and the summary it replaces steps aside', w.$('.tgm-pp-people').hidden === true);
  const gb = w.$$('[data-pp-index="0"] [data-pp-f="country"] option').find((o) => o.value === 'GB');
  ok('[7] the country list shows names, and United Kingdom is GB', !!gb && gb.textContent === 'United Kingdom');
  ok('the list has every country and a prompt', w.$$('[data-pp-index="0"] [data-pp-f="country"] option').length === 250);

  await w.save();
  ok('[9] pressing Save with nothing entered calls nothing and says so', !w.posts.some((p) => p.url.includes('update-passport')) && /Nothing has changed/.test(w.$('[data-tgm-pp-msg]').textContent));

  w.set(0, 'number', 'ab 123');
  w.set(0, 'issued', TODAY);
  w.set(0, 'expires', day(37));
  await w.save();
  ok('[5][6] mistakes are marked against the field and the person', /letters and numbers/.test(w.$('[data-pp-index="0"] [data-pp-err="number"]').textContent)
    && /before today/.test(w.$('[data-pp-index="0"] [data-pp-err="issued"]').textContent)
    && /still be valid after/.test(w.$('[data-pp-index="0"] [data-pp-err="expires"]').textContent)
    && /Please fill this in/.test(w.$('[data-pp-index="0"] [data-pp-err="country"]').textContent));
  ok('marked for assistive tech too', w.$('[data-pp-index="0"] [data-pp-f="number"]').getAttribute('aria-invalid') === 'true');
  ok('and nothing is sent while any are wrong', !w.posts.some((p) => p.url.includes('update-passport')));
  ok('Sarah, untouched, is not asked for anything', !w.$('[data-pp-index="1"] [aria-invalid="true"]'));

  w.set(0, 'number', 'ab123456');
  w.set(0, 'country', 'GB');
  w.set(0, 'issued', '2020-10-01');
  w.set(0, 'expires', day(38));
  w.answer({ success: false, error: 'Could not update order' });
  await w.save();
  const sent = w.posts.find((p) => p.url.includes('update-passport'));
  ok('[11] a good entry goes, for Daniel only', sent && sent.body.passengers.length === 1 && sent.body.passengers[0].index === 0);
  ok('[7] tidied: upper case, the country as GB, the dates as typed', sent && sent.body.passengers[0].number === 'AB123456' && sent.body.passengers[0].country === 'GB'
    && sent.body.passengers[0].issued === '2020-10-01' && sent.body.passengers[0].expires === day(38));
  ok('with the flight item and the customer\'s own three details, never the order key', sent && sent.body.itemId === String(FLIGHT_ID) && sent.body.orderRef === 'DEMO122410'
    && !JSON.stringify(sent.body).includes(ORDER_KEY));
  ok('[10] Travelify\'s error is shown against the flight', /Could not update order/.test(w.$('[data-tgm-pp-msg]').textContent));
  ok('[10] and what was typed is kept', w.$('[data-pp-index="0"] [data-pp-f="number"]').value === 'ab123456' && w.$('[data-pp-index="0"] [data-pp-f="country"]').value === 'GB');
  ok('the Save button is usable again', w.$('[data-tgm-pp-save]').disabled === false);

  w.inst._render();   // anything else re-drawing the page
  ok('a re-render for another reason keeps the open form and what was typed',
    w.$('[data-tgm-pp-form]').hidden === false && w.$('[data-pp-index="0"] [data-pp-f="number"]').value === 'ab123456');

  // A slow answer: Save is disabled while it is in flight.
  let release;
  const slow = new Promise((r) => { release = r; });
  const realFetch = w.window.fetch;
  w.window.fetch = async (url, init) => { if (String(url).includes('update-passport')) { await slow; } return realFetch(url, init); };
  w.answer({ success: true, saved: 1 });
  const saved = Object.assign({}, DANIEL, { foidType: 'Passport', foidNumber: 'AB123456', foidIssuingCountry: 'GB', foidStartDate: '2020-10-01', foidExpiryDate: day(38) });
  w.refreshWith(await orderFor([saved, SARAH, BABY]));
  w.$('[data-tgm-pp-form]').dispatchEvent(new w.window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(5);
  ok('Save is disabled while the request is in flight', w.$('[data-tgm-pp-save]').disabled === true && /Saving/.test(w.$('[data-tgm-pp-save]').textContent));
  const before = w.posts.filter((p) => p.url.includes('update-passport')).length;
  w.$('[data-tgm-pp-form]').dispatchEvent(new w.window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(5);
  ok('and a second press sends nothing more', w.posts.filter((p) => p.url.includes('update-passport')).length === before);
  release();
  await sleep(40);
  ok('on success the booking is fetched again', w.posts.some((p) => p.url.includes('/api/retrieve-order')));
  ok('and shows what the platform now holds', /••••3456/.test(w.$('.tgm-pp-people').textContent) && /United Kingdom/.test(w.$('.tgm-pp-people').textContent));
  ok('with a confirmation against the flight', /Passport details saved/.test(w.$('[data-tgm-pp-result]').textContent));
  ok('the form is closed and its typed values are gone from memory', w.$('[data-tgm-pp-form]').hidden === true
    && JSON.stringify(w.inst._pp).indexOf('AB123456') === -1 && JSON.stringify(w.inst._pp).indexOf('ab123456') === -1);
  ok('nothing about a passport was ever written to browser storage', !w.stored.some((x) => /AB123456|ab123456|P9988776|passport/i.test(x)), w.stored.join(' | '));

  // A save that lands while the read-back fails still clears what was typed.
  const lost = await mount(await orderFor([DANIEL]));
  lost.$('[data-tgm-pp-open]').click();
  lost.set(0, 'number', 'ZZ998877'); lost.set(0, 'country', 'GB'); lost.set(0, 'issued', '2020-10-01'); lost.set(0, 'expires', day(60));
  lost.answer({ success: true, saved: 1 });
  lost.refreshWith(null);   // the re-fetch answers without a booking
  await lost.save();
  await sleep(20);
  ok('a save whose read-back fails still confirms, and clears the typed number from the page',
    /Passport details saved/.test(lost.$('[data-tgm-pp-result]').textContent) && lost.$('[data-pp-f="number"]').value === ''
    && JSON.stringify(lost.inst._pp).indexOf('ZZ998877') === -1);

  const pre = await mount(await orderFor([withPass]));
  pre.$('[data-tgm-pp-open]').click();
  ok('[9] a passport on file opens the form pre-filled', pre.$('[data-pp-f="number"]').value === 'P9988776' && pre.$('[data-pp-f="country"]').value === 'IE'
    && pre.$('[data-pp-f="issued"]').value === '2019-05-01' && pre.$('[data-pp-f="expires"]').value === '2029-04-30');
  ok('the button says update, not add', /Update passport details/.test(pre.$('[data-tgm-pp-open]').textContent));
  await pre.save();
  ok('[9] saving it unchanged calls nothing', !pre.posts.some((p) => p.url.includes('update-passport')) && /Nothing has changed/.test(pre.$('[data-tgm-pp-msg]').textContent));
  pre.$('[data-tgm-pp-cancel]').click();
  ok('Cancel closes the form', pre.$('[data-tgm-pp-form]').hidden === true);

  const closed = await mount(await orderFor([withPass], TODAY, day(7)));
  ok('[3] on departure day there is no form and no button', !closed.$('[data-tgm-pp-form]') && !closed.$('[data-tgm-pp-open]'));
  ok('what is on file shows read-only, the number masked', /••••8776/.test(closed.$('.tgm-pp-people').textContent) && !closed.$('.tgm-pp').innerHTML.includes('P9988776'));

  const stale = await mount(await orderFor([DANIEL], day(1), day(7)));
  stale.inst.state.order.items.find((i) => i.id === FLIGHT_ID).passports.departDay = TODAY;   // the page was left open into departure day
  stale.$('[data-tgm-pp-open]') && stale.$('[data-tgm-pp-open]').click();
  stale.set(0, 'number', 'AB123456'); stale.set(0, 'country', 'GB'); stale.set(0, 'issued', '2020-10-01'); stale.set(0, 'expires', day(60));
  await stale.save();
  ok('[3] a page left open past the cut-off cannot submit', !stale.posts.some((p) => p.url.includes('update-passport')) && /can no longer be changed/.test(stale.$('[data-tgm-pp-msg]').textContent));

  ok('the host page\'s booking-loaded event never carries a passport block',
    (() => { const src = WIDGET; return /this\._fireEvent\('booking-loaded', \{ order: orderForHostPage\(data\.order\) \}\)/.test(src); })());
  const vm = new JSDOM('<!doctype html><body></body>', { url: 'https://client.example/booking', runScripts: 'dangerously' });
  const sc = vm.window.document.createElement('script'); sc.textContent = WIDGET; vm.window.document.body.appendChild(sc);
  const passOrder = await orderFor([withPass]);
  const inst2 = new vm.window.TGMyBookingWidget(vm.window.document.body.appendChild(vm.window.document.createElement('div')), {});
  const got = [];
  inst2.el.addEventListener('tg-mybooking:booking-loaded', (e) => got.push(e.detail));
  vm.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ order: passOrder, upsell: [] }) });
  inst2.c.widgetId = 'tgw_x';
  await inst2._lookupBooking({ email: 'daniel@example.com', date: day(30), ref: 'DEMO122410' });
  ok('checked live: the event\'s order has no passport block, and no passport number', got.length === 1
    && !got[0].order.items.some((i) => i.passports) && !JSON.stringify(got[0]).includes('P9988776'));
  ok('while the widget itself still has it', inst2.state.order.items.some((i) => i.passports));
}

console.log('\nThe staff inspector answers the spec\'s first open point, without the numbers');
{
  const { buildOrderShapeReport } = await import('../api/admin/order-shape.js');
  const withPass = Object.assign({}, DANIEL, { foidType: 'Passport', foidNumber: 'P9988776', FOIDIssuingCountry: 'IE', foidStartDate: '2019-05-01', foidExpiryDate: '2029-04-30' });
  const report = buildOrderShapeReport(rawOrder(flightData({ travellers: [withPass, SARAH, BABY] })), {});
  const f = report.passports && report.passports[0];
  ok('it reports each flight\'s passport field names as Travelify wrote them', f && f.itemId === String(FLIGHT_ID)
    && f.foidKeys.join() === 'FOIDIssuingCountry,foidExpiryDate,foidNumber,foidStartDate,foidType', f && f.foidKeys.join());
  ok('canEditFOID as it came, and who has a number on file', f && f.canEditFOID === true && f.withPassportValue.join() === 'true,false,false');
  ok('only flights are reported', report.passports.length === 1);
  ok('and no passport value appears anywhere in the report', !JSON.stringify(report).includes('P9988776') && !JSON.stringify(report).includes('2029-04-30'));
  const odd = buildOrderShapeReport(rawOrder(flightData({ canEditFOID: 'yes' })), {}).passports[0];
  ok('a canEditFOID that is not a boolean says so, since the form needs boolean true', odd.canEditFOID === '(string)');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
