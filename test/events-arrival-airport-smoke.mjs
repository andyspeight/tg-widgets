/**
 * An agent chooses which airport their customers fly into (15 Sep 2026).
 *
 * Andy, on the event listers: "For each team, we automatically choose the
 * closest airport for offers where a flight appears in the search. That is
 * fine for most teams, but when clients are coming from overseas there is
 * quite often no direct flight to the closest airport ... As an example for
 * Liverpool, the closest airport is Liverpool, but when coming from most of
 * Europe the next airport is Manchester as there are cheaper direct flights."
 *
 * So the flight leg's arrival airport can be named per widget, for a ground or
 * for a club, and everything without an override keeps the nearest airport it
 * has always had.
 *
 * TWO RULES THAT MATTER, both asserted below against the real snapshot:
 *
 *   A GROUND BEATS A CLUB. "Anything at Anfield flies into Manchester" means
 *   it whoever is playing there.
 *
 *   A CLUB APPLIES TO ITS HOME GAMES ONLY. Liverpool away at Arsenal is a trip
 *   to London. Flying that customer to Manchester would be worse than the
 *   default, not better.
 *
 * Run: node test/events-arrival-airport-smoke.mjs
 *      (npm run test:events-arrival-airport)
 */
import { readFileSync } from 'node:fs';
import handler from '../api/events-feed.js';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const ask = (query) => new Promise((resolve) => {
  const res = {
    statusCode: 0, setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(b) { resolve(b); return this; },
    end() { resolve(null); return this; },
  };
  handler({ method: 'GET', query, headers: {} }, res);
});

const FLIGHT = 'ticket-flight-hotel';
const dstFor = (events, test) => {
  const e = (events || []).find(test);
  if (!e) return null;
  const opt = (e.bookingOptions || []).find((o) => o.kind === FLIGHT);
  return { title: e.title, venue: e.venue && e.venue.name, dst: opt ? opt.dst : null };
};
const base = { view: 'team', key: 'liverpool', booking: FLIGHT, limit: '12' };
const atAnfield = (e) => e.venue && /Anfield/i.test(e.venue.name);
const away = (e) => e.venue && !/Anfield/i.test(e.venue.name);

console.log('Nothing set: the nearest airport, exactly as before');
{
  const d = await ask(base);
  const home = dstFor(d.events, atAnfield);
  const trip = dstFor(d.events, away);
  ok('a home game flies into Liverpool', home && home.dst === 'LPL', JSON.stringify(home));
  ok('an away game flies to the other city', trip && trip.dst && trip.dst !== 'LPL', JSON.stringify(trip));
}

console.log('The club is overridden');
{
  const d = await ask({ ...base, dst: 'liverpool:MAN' });
  const home = dstFor(d.events, atAnfield);
  const trip = dstFor(d.events, away);
  ok('a home game now flies into Manchester', home && home.dst === 'MAN', JSON.stringify(home));
  ok('an AWAY game is untouched, because the trip is to the other city',
    trip && trip.dst !== 'MAN', JSON.stringify(trip) + ' — this is the rule that stops a London trip flying to Manchester');
}

console.log('The ground is overridden, and beats the club');
{
  const plain = await ask({ ...base, dst: 'anfield:LBA' });
  ok('a ground key works on its own', dstFor(plain.events, atAnfield).dst === 'LBA');
  const both = await ask({ ...base, dst: 'liverpool:MAN,anfield:LBA' });
  ok('and wins when both are set', dstFor(both.events, atAnfield).dst === 'LBA',
    'the ground is where the match is, whoever is playing');
}

console.log('Bad input changes nothing');
for (const [label, value] of [
  ['a two-letter code', 'liverpool:XX'],
  ['an empty key', ':MAN'],
  ['no colon', 'liverpool-MAN'],
  ['a key that does not exist', 'not-a-real-club:MAN'],
  ['junk', ',,,:::'],
]) {
  const d = await ask({ ...base, dst: value });
  ok(label + ' is ignored', dstFor(d.events, atAnfield).dst === 'LPL', value);
}
{
  const many = Array.from({ length: 60 }, (_, i) => 'club-' + i + ':MAN').concat('liverpool:MAN').join(',');
  const d = await ask({ ...base, dst: many });
  ok('a list longer than the cap is truncated rather than failing the request',
    dstFor(d.events, atAnfield) !== null, 'the request still answers');
}

console.log('It only applies where a flight is actually booked');
{
  const d = await ask({ ...base, booking: 'ticket', dst: 'liverpool:MAN' });
  const e = (d.events || []).find(atAnfield);
  ok('a ticket-only widget builds no flight leg at all',
    !(e.bookingOptions || []).some((o) => o.kind === FLIGHT));
}

console.log('The airport list can be searched, for the editor');
{
  const d = await ask({ view: 'airports', q: 'manchester' });
  ok('a name search finds the airport', (d.items || []).some((a) => a.iata === 'MAN'),
    (d.items || []).map((a) => a.iata).join(','));
  const code = await ask({ view: 'airports', q: 'MAN' });
  ok('an exact code comes first', code.items[0] && code.items[0].iata === 'MAN', code.items[0] && code.items[0].iata);
  const all = await ask({ view: 'airports' });
  ok('and with no search the old full list is unchanged, for the widgets',
    Array.isArray(all.airports) && all.airports.length > 3000, String(all.airports && all.airports.length));
}

console.log('Every surface sends it, and the editor can set it');
{
  const widgets = ['tickets', 'eventmenu', 'clubpicker', 'nextevent', 'ticketmonth', 'ticketsearch'];
  for (const w of widgets) {
    const src = readFileSync(new URL('../public/widget-' + w + '.js', import.meta.url), 'utf8');
    ok(w + ' sends its overrides to the feed',
      /function airportOverrideParam/.test(src) && /if \(dstMap\) q\.dst = dstMap;/.test(src));
  }
  const kit = readFileSync(new URL('../public/editor-events-kit.js', import.meta.url), 'utf8');
  ok('the shared editor kit offers the control once', /function arrivalAirports\(/.test(kit));
  ok('and exports it', /arrivalAirports: arrivalAirports,/.test(kit));
  ok('a bare three-letter code is accepted without waiting for a list',
    /\^\[A-Za-z\]\{3\}\$/.test(kit));

  const editors = ['tickets', 'eventmenu', 'clubpicker', 'nextevent', 'ticketmonth', 'ticketsearch', 'venueguide'];
  for (const e of editors) {
    const src = readFileSync(new URL('../public/editor-' + e + '.html', import.meta.url), 'utf8');
    ok(e + ' editor mounts the control and hides it without a flight',
      /K\.arrivalAirports\('arv-airports'/.test(src)
      && /function syncArrivalField/.test(src)
      && /arrivalAirports: \[\],/.test(src));
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
