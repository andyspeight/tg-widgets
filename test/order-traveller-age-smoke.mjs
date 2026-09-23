/**
 * A child's age comes from the booking, not from a guess (23 Sep 2026).
 *
 * Andy: "you do get either the date of birth or the age of any child or infant,
 * recheck please." He is right, and the first version of the upsell did not
 * look: it read a traveller's `age` only, and the order trimmers were not even
 * carrying that, so every child was searched at the assumed age.
 *
 * Travelify states an AGE on some products and a DATE OF BIRTH on others — its
 * own order model documents the car rental driver as `Driver.DOB` — and the
 * casing moves about the way `iataCode` and `flightNo` do in the same JSON. So
 * the key is matched without caring about case or spelling.
 *
 * Three rules this pins down:
 *
 *   - the age is counted ON THE DAY THEY TRAVEL, not today. A lap infant who
 *     turns two before departure is not a lap infant, and a child's age is what
 *     a search is priced on;
 *   - both dates are read as calendar dates from their UTC fields, per
 *     CLAUDE.md. A local parse of "2019-04-11T00:00:00" is a day out in a
 *     British browser, and a day either side of a birthday is a whole year;
 *   - the date of birth itself never leaves the server. The age is the number
 *     every consumer wants, and a birth date is worth more to a stranger than
 *     it is to us.
 *
 * Run: node test/order-traveller-age-smoke.mjs   (npm run test:traveller-age)
 */
import { readFileSync } from 'node:fs';
import { partySize, upsellTiles, upsellUrl, CHILD_AGE_WHEN_UNKNOWN } from '../public/_order-upsell.js';
import { aggregateTravellers } from '../api/_lib/travelify-items.js';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};

// retrieve-order.js is a Vercel handler, so its helpers are exercised through a
// tiny harness that pulls the two pure functions out of the source rather than
// booting the endpoint.
const SRC = readFileSync(new URL('../api/retrieve-order.js', import.meta.url), 'utf8');
const grab = (name) => {
  const at = SRC.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('no ' + name);
  let depth = 0, i = SRC.indexOf('{', at);
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error('unbalanced ' + name);
};
const harness = `
import { bookingMoment } from '${new URL('../public/_order-stays.js', import.meta.url).href}';
const safeStr = (v, n) => (v == null ? null : String(v).slice(0, n));
${grab('safeAge')}
${SRC.slice(SRC.indexOf('const AGE_KEYS'), SRC.indexOf('function ageOnDate('))}
${grab('ageOnDate')}
${grab('ageTravellers')}
export { rawAgeFields, ageOnDate, ageTravellers };
`;
const mod = await import('data:text/javascript;base64,' + Buffer.from(harness).toString('base64'));

console.log('\nWhat the supplier said, however they said it\n');
{
  const r = mod.rawAgeFields;
  ok('a plain age is read', r({ age: 9 }).age === 9);
  ok('a numeric string age is read', r({ age: '9' }).age === 9);
  ok('DOB in capitals, as Travelify\'s own model writes it', r({ DOB: '2019-04-11' }).dob === '2019-04-11');
  ok('dob in lower case', r({ dob: '2019-04-11' }).dob === '2019-04-11');
  ok('dateOfBirth, camel cased', r({ dateOfBirth: '2019-04-11' }).dob === '2019-04-11');
  ok('birthDate', r({ birthDate: '2019-04-11' }).dob === '2019-04-11');
  ok('a traveller with neither yields neither',
    r({ title: 'Mr', firstname: 'A' }).age === null && r({}).dob === null);
  ok('nothing else on the traveller is picked up by accident',
    r({ agent: 'x', dobbin: 'y' }).age === null && r({ agent: 'x', dobbin: 'y' }).dob === null);
}

console.log('\nCounted on the day they travel');
{
  const a = mod.ageOnDate;
  ok('a birthday already passed counts the full year', a('2019-04-11', '2027-04-17') === 8);
  ok('a birthday still to come does not', a('2019-04-20', '2027-04-17') === 7);
  ok('a birthday ON the travel date counts', a('2019-04-17', '2027-04-17') === 8);
  // The whole point of counting at the trip and not at the booking.
  ok('an infant who turns two before departure is two', a('2025-03-01', '2027-04-10') === 2);
  ok('and is still one the month before', a('2025-05-01', '2027-04-10') === 1);
  // CLAUDE.md: a date wearing a time, read from UTC fields, not parsed locally.
  ok('a date wearing a time reads the same', a('2019-04-11T00:00:00', '2027-04-17T00:00:00') === 8);
  ok('nonsense in, nothing out', a('', '2027-04-17') === null && a('not a date', '2027-04-17') === null);
}

console.log('\nThe date of birth does not leave the server');
{
  const items = [{
    product: 'Flights', startDate: '2027-04-10T00:00:00',
    flights: { travellers: [
      { type: 'Adult', firstname: 'Claire', surname: 'Bennett', dob: '1990-01-05' },
      { type: 'Child', firstname: 'Ella', surname: 'Bennett', dob: '2019-04-11', age: null },
      { type: 'Infant', firstname: 'Tom', surname: 'Bennett', dob: '2025-03-01' },
    ] },
  }, {
    product: 'Accommodation', startDate: '2027-04-10T00:00:00',
    accommodation: { guests: [{ type: 'Child', firstname: 'Ella', surname: 'Bennett', age: 9 }] },
  }];
  mod.ageTravellers(items);
  const flight = items[0].flights.travellers;
  ok('the child\'s age is worked out from the date of birth', flight[1].age === 7, JSON.stringify(flight[1]));
  ok('the infant\'s too, at the travel date', flight[2].age === 2, JSON.stringify(flight[2]));
  ok('and no traveller still carries a date of birth',
    flight.every((t) => !('dob' in t)) && items[1].accommodation.guests.every((g) => !('dob' in g)));
  ok('an age the supplier stated is left exactly as it was', items[1].accommodation.guests[0].age === 9);
  ok('a traveller with nothing to go on carries no age key at all',
    !('age' in mod.ageTravellers([{ startDate: '', flights: { travellers: [{ type: 'Adult' }] } }])[0].flights.travellers[0]));

  // The hotel often lists a guest with no age where the flight lists the same
  // child with one. De-duping must keep the half that can price a search.
  const merged = aggregateTravellers([
    { accommodation: { guests: [{ type: 'Child', firstname: 'Ella', surname: 'Bennett' }] } },
    { flights: { travellers: [{ type: 'Child', title: 'Miss', firstname: 'Ella', surname: 'Bennett', age: 7 }] } },
  ]);
  ok('one child, not two', merged.length === 1);
  ok('and the age from the flight is carried onto her', merged[0].age === 7, JSON.stringify(merged[0]));
}

console.log('\nWhat the search then asks for');
{
  const leg = (from, to, depart, arrive) => ({ segments: [{ origin: { iataCode: from }, destination: { iataCode: to }, depart, arrive }] });
  const order = {
    items: [
      { product: 'Flights', legs: [leg('LHR', 'CDG', '2027-04-10T07:00:00', '2027-04-10T09:20:00'),
        leg('CDG', 'LHR', '2027-04-17T18:00:00', '2027-04-17T18:20:00')] },
      { product: 'Accommodation', startDate: '2027-04-10T00:00:00',
        accommodation: { location: { city: 'Paris', country: 'FR' }, units: [{ checkin: '2027-04-10', nights: 7 }] } },
    ],
    summary: { travellers: [
      { type: 'Adult' }, { type: 'Adult' },
      { type: 'Child', age: 7 }, { type: 'Child', age: 12 }, { type: 'Infant' }] },
  };
  const party = partySize(order);
  ok('the real ages are used, in order', party.childAges.join(',') === '7,12', JSON.stringify(party));
  ok('and nothing is assumed', !party.childAges.includes(CHILD_AGE_WHEN_UNKNOWN));
  const url = upsellUrl(upsellTiles(order)[0], '474');
  ok('the link carries an age per child', /chdage=7/.test(url) && /chdage=12/.test(url), url);
  ok('and the infant, which needs none', /inf=1/.test(url) && !/infage/.test(url), url);

  const noAge = { ...order, summary: { travellers: [{ type: 'Adult' }, { type: 'Child' }] } };
  ok('only a child the booking says nothing about falls back',
    partySize(noAge).childAges[0] === CHILD_AGE_WHEN_UNKNOWN);
}

// ── Checking the guess against a real order ──────────────────────────────────
// The case-insensitive net above is a reasonable read of Travelify's model, not
// a certainty. The staff inspector reports which key names a real order's
// traveller lists carry, so it can be settled from a live booking — names only,
// never a value, because an age on a support report is the thing we are trying
// not to hand around.
console.log('\nThe staff inspector can settle it against a live booking');
{
  const { buildOrderShapeReport } = await import('../api/admin/order-shape.js');
  const report = buildOrderShapeReport({
    id: 1, currency: 'GBP', items: [
      { product: 'Flights', dataObject: { travellers: [
        { type: 'Adult', title: 'Ms', firstname: 'Claire', surname: 'Bennett' },
        { type: 'Child', firstname: 'Ella', surname: 'Bennett', DOB: '2019-04-11' }] } },
      { product: 'CarRental', dataObject: { driver: { type: 'Adult', firstname: 'James', DOB: '1988-02-02' } } },
    ],
  }, {});
  const p = report.party;
  ok('it reports how many people and of which type',
    p.people === 3 && p.byType.Adult === 2 && p.byType.Child === 1, JSON.stringify(p));
  ok('it names the date of birth key it found', p.dobKeys.join(',') === 'DOB', JSON.stringify(p.dobKeys));
  // Two lists: the flight's travellers, and the car rental's lone driver, which
  // has no list of its own and is where Travelify's model documents DOB.
  ok('the car rental driver is counted too, being where Travelify documents DOB',
    p.lists === 2 && p.people === 3, JSON.stringify(p));
  ok('and it reports names only, never a value',
    !JSON.stringify(p).includes('2019-04-11') && !JSON.stringify(p).includes('Bennett'),
    JSON.stringify(p));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
