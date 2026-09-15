/**
 * A competition's clubs are listed A to Z (15 Sep 2026).
 *
 * Andy, on the event listers: "When listing teams (for example, the Premier
 * League), the teams should be in alphabetical order."
 *
 * They came back ranked by how many fixtures each side has. That ranking is
 * what makes an unfiltered "popular clubs" menu useful, because A to Z across
 * every team on earth opens with 1899 Hoffenheim and never reaches a club
 * anyone searched for. Narrowed to ONE competition it is a closed set of
 * twenty-odd clubs, all of them shown, and fixture count reads as no order at
 * all: Ipswich, Leeds, Forest, Sunderland, Brentford.
 *
 * So a narrowed list goes A to Z and an open one keeps its ranking, and
 * ?sort=name / ?sort=events force either.
 *
 * TWO SEPARATE QUESTIONS, and the first version of this answered them with one
 * line. WHICH rows survive the limit is decided by how busy each one is. What
 * ORDER they are then read in is A to Z. Sorting the pool before the cut
 * answered both with the alphabet, so the Event Menu's Popular clubs section on
 * a football-only menu came back as the clubs nearest the front of the
 * alphabet: 1899 Hoffenheim, Aarhus on one fixture, AC Omonia on none. That is
 * what the "a narrowed page is the busiest, read A to Z" block below guards.
 *
 * Runs against the REAL snapshot in api/_data, so it is the clubs a visitor
 * actually sees.
 *
 * Run: node test/events-team-order-smoke.mjs  (npm run test:events-team-order)
 */
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
    json(b) { resolve({ status: this.statusCode, body: b }); return this; },
    end() { resolve({ status: this.statusCode, body: null }); return this; },
  };
  handler({ method: 'GET', query, headers: {} }, res);
});

const isAZ = (names) => names.every((n, i) =>
  i === 0 || names[i - 1].localeCompare(n, 'en', { sensitivity: 'base', numeric: true }) <= 0);

const PL = 'english-premier-league';

console.log('The Premier League reads A to Z');
{
  const { body } = await ask({ view: 'teams', competition: PL, limit: '50' });
  const names = body.items.map((t) => t.name);
  ok('the competition is in the snapshot', names.length >= 15, names.length + ' clubs');
  ok('and every club came back, not a page of them', names.length === body.total, names.length + ' of ' + body.total);
  ok('they are in alphabetical order', isAZ(names), names.join(', '));
  ok('the response says how it ordered them', body.sort === 'name', body.sort);
  // The two that actually move: the ranking used to open on whoever had most
  // fixtures, and bury the As.
  ok('an A club is at the top, not a busy one', /^a/i.test(names[0]), names[0]);
}

console.log('The competition view agrees with the directory');
{
  const { body } = await ask({ view: 'competition', slug: PL, limit: '1' });
  const names = (body.teams || []).map((t) => t.name);
  ok('it lists the same clubs', names.length >= 15, String(names.length));
  ok('also A to Z', isAZ(names), names.slice(0, 6).join(', '));
}

console.log('An open directory keeps its ranking, or a popular-clubs menu breaks');
{
  const { body } = await ask({ view: 'teams', limit: '8' });
  ok('it is still ranked by fixtures', body.sort === 'events', body.sort);
  const events = body.items.map((t) => t.events || 0);
  ok('busiest first', events.every((n, i) => i === 0 || events[i - 1] >= n), events.join(' '));
  ok('so it opens on a club someone has heard of', !/^1899/.test(body.items[0].name), body.items[0].name);
}

console.log('Either order can be asked for outright');
{
  const az = await ask({ view: 'teams', limit: '5', sort: 'name' });
  ok('?sort=name reads A to Z', az.body.sort === 'name' && isAZ(az.body.items.map((t) => t.name)),
    az.body.items.map((t) => t.name).join(', '));
  const ranked = await ask({ view: 'teams', competition: PL, limit: '5', sort: 'events' });
  ok('?sort=events overrides the narrowed default', ranked.body.sort === 'events', ranked.body.sort);
}

console.log('A narrowed PAGE is the busiest clubs, read A to Z');
{
  // This is the Event Menu's Popular clubs section on a football-only menu.
  const page = await ask({ view: 'teams', category: 'football', limit: '24' });
  const names = page.body.items.map((t) => t.name);
  ok('it is ordered A to Z', page.body.sort === 'name' && isAZ(names), names.slice(0, 4).join(', '));
  ok('it is a page of a much longer list', page.body.total > 500, String(page.body.total));

  const full = await ask({ view: 'teams', category: 'football', limit: '500', sort: 'events' });
  const busiest = full.body.items.slice(0, 24).map((t) => t.name).sort();
  ok('and it holds the busiest 24 football clubs, not the first 24 alphabetically',
    JSON.stringify(names.slice().sort()) === JSON.stringify(busiest),
    'got: ' + names.slice(0, 4).join(', '));
  ok('so no club with a single fixture is standing at the front',
    page.body.items.every((t) => (t.events || 0) > 1), String(page.body.items[0].events));

  // The case Andy asked about is a closed set, so it is untouched by the cut.
  const pl = await ask({ view: 'teams', competition: PL, limit: '200' });
  ok('a whole competition still lists every club A to Z',
    pl.body.items.length === pl.body.total && isAZ(pl.body.items.map((t) => t.name)),
    pl.body.items.length + ' of ' + pl.body.total);
}

console.log('A sport-narrowed grid of grounds reads A to Z too');
{
  const v = await ask({ view: 'venues', category: 'football', limit: '40', sort: 'name' });
  const names = v.body.items.map((x) => x.name);
  ok('the Club Picker grid is alphabetical', v.body.sort === 'name' && isAZ(names), names.slice(0, 3).join(', '));
  ok('and every ground in it is a football ground',
    v.body.items.every((x) => (x.categories || []).includes('football')), String(v.body.items.length));
}

console.log('Nothing else changed shape');
{
  const venues = await ask({ view: 'venues', limit: '5' });
  ok('the venue directory still ranks by fixtures', venues.body.sort === 'events', venues.body.sort);
  const performers = await ask({ view: 'performers', limit: '5' });
  ok('and so does the performer directory', performers.body.sort === 'events', performers.body.sort);
  ok('a team directory still reports its true total', typeof (await ask({ view: 'teams', competition: PL })).body.total === 'number');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
