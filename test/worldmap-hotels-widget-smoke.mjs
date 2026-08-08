/**
 * World Map — Hotels mode WIDGET (Andy, 08 Aug 2026).
 *
 * The World Map can now be set to show hotels rather than holidays. It is the
 * SAME map reading the parallel accommodation cache: the widget appends
 * ?mode=hotels to every data fetch (summary, resorts, deals), swaps the visitor
 * filters to board basis + nights (on top of the shared budget + star rating)
 * and drops the flight-shaped controls (departure routes, supplier gating)
 * which don't apply to a hotel-only stay.
 *
 * Exercises the REAL filter logic (extracted from the widget source and
 * evaluated against a mock instance) plus source guards pinning the mode=hotels
 * wiring on all three fetch paths, the departure-route skip and the editor
 * toggle. Default (no mode) must stay the unchanged holidays behaviour.
 *
 * Run: node test/worldmap-hotels-widget-smoke.mjs  (also: npm run test:worldmap-hotels-widget)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const widget = readFileSync(new URL('../public/widget-worldmap.js', import.meta.url), 'utf8');

// ── Extract and evaluate the real methods from the widget source ─────────────
// Each method reads `this._filter*` / `this.cfg`, so we evaluate the body as a
// plain function and call it with a mock `this` carrying the filter state.
const methodBody = (src, signature) => {
  const i = src.indexOf(signature);
  if (i === -1) throw new Error('method not found: ' + signature);
  // Walk braces from the first { after the signature to its match.
  const open = src.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(open + 1, j);
};

const applyFilters = new Function('offers', methodBody(widget, '_applyFilters(offers) {'));
const isFiltering = new Function(methodBody(widget, '_isFiltering() {'));
const isHotels = new Function(methodBody(widget, '_isHotels() {'));

const call = (fn, self, ...args) => fn.call(self, ...args);

// ── _isHotels: reads config ──────────────────────────────────────────────────
ok(call(isHotels, { cfg: { dataMode: 'hotels' } }) === true, '_isHotels true when dataMode=hotels');
ok(call(isHotels, { cfg: { dataMode: 'holidays' } }) === false, '_isHotels false for holidays');
ok(call(isHotels, { cfg: {} }) === false, '_isHotels false when unset (default holidays)');

// ── _applyFilters: shared budget/rating + hotel board/nights ─────────────────
const HOTELS = [
  { id: 'h1', pricePP: 260, rating: 4, boardBasis: 'All inclusive', nights: 7 },
  { id: 'h2', pricePP: 450, rating: 5, boardBasis: 'Bed & breakfast', nights: 10 },
  { id: 'h3', pricePP: 150, rating: 3, boardBasis: 'Room only', nights: 7 },
];
const base = () => ({ _filterMaxPrice: null, _filterMinRating: null, _filterBoard: null, _filterNights: null });

ok(call(applyFilters, base(), HOTELS).length === 3, 'no filters → all offers');
{
  const self = Object.assign(base(), { _filterMaxPrice: 200 });
  const r = call(applyFilters, self, HOTELS);
  ok(r.length === 1 && r[0].id === 'h3', 'budget filter (≤£200pp) keeps only h3');
}
{
  const self = Object.assign(base(), { _filterMinRating: 5 });
  const r = call(applyFilters, self, HOTELS);
  ok(r.length === 1 && r[0].id === 'h2', 'star-rating filter (5★) keeps only h2');
}
{
  // Board is stored normalised (lowercased, alpha-only) in filter state.
  const self = Object.assign(base(), { _filterBoard: 'allinclusive' });
  const r = call(applyFilters, self, HOTELS);
  ok(r.length === 1 && r[0].id === 'h1', 'board filter matches on the normalised boardBasis');
}
{
  const self = Object.assign(base(), { _filterNights: 7 });
  const r = call(applyFilters, self, HOTELS);
  ok(r.length === 2 && r.every(o => o.nights === 7), 'nights filter keeps the 7-night stays');
}
{
  // Combined: 7 nights AND ≤£200pp AND all-inclusive → nothing (h3 is room only).
  const self = Object.assign(base(), { _filterNights: 7, _filterMaxPrice: 200, _filterBoard: 'allinclusive' });
  ok(call(applyFilters, self, HOTELS).length === 0, 'filters compose (all must pass)');
}
ok(call(applyFilters, base(), 'not-an-array').length === 0, 'non-array input → [] (never throws)');

// ── _isFiltering: true if ANY of the four filters is set ─────────────────────
ok(call(isFiltering, base()) === false, '_isFiltering false when all Any');
ok(call(isFiltering, Object.assign(base(), { _filterBoard: 'roomonly' })) === true, '_isFiltering true when board set');
ok(call(isFiltering, Object.assign(base(), { _filterNights: 7 })) === true, '_isFiltering true when nights set');
ok(call(isFiltering, Object.assign(base(), { _filterMaxPrice: 300 })) === true, '_isFiltering true when budget set');

// ── Source guards: mode=hotels wiring on all three fetch paths ────────────────
ok(/dataMode: 'holidays'/.test(widget), 'DEFAULTS carry dataMode holidays (default unchanged)');
ok(/_isHotels\(\)\s*\{\s*return this\.cfg\.dataMode === 'hotels'/.test(widget), '_isHotels reads cfg.dataMode');

// Summary (offers) fetch
ok(/OFFERS_URL \+ \(this\._isHotels\(\) \? '\?mode=hotels' : ''\)/.test(widget), 'summary fetch appends ?mode=hotels');
// Resorts fetch
ok(/RESORTS_URL \+ '\?country=' \+ encodeURIComponent\(cc\) \+ \(this\._isHotels\(\) \? '&mode=hotels' : ''\)/.test(widget), 'resorts fetch appends &mode=hotels');
// Deals fetch (country load): mode appended AND supplier param gated off in hotels
ok(/DEALS_URL \+ '\?country=' \+ encodeURIComponent\(cc\) \+ sfParam \+ \(hotels \? '&mode=hotels' : ''\)/.test(widget), 'deals country fetch appends &mode=hotels');
ok(/const sfParam = \(!hotels && sf/.test(widget), 'supplier whitelist param suppressed in hotels mode');

// Resort drill-down: hotels drill by country accommodation set, holidays by airport
ok(/const drillUrl = hotels/.test(widget) && /'&mode=hotels&limit=200'/.test(widget), 'resort drill-down uses a hotels-aware URL');

// Departure routes are a flight-shaped concept — skipped entirely in hotels mode
{
  const block = widget.slice(widget.indexOf('_drawDepartureRoutes(country, offers) {'));
  ok(/if \(this\._isHotels\(\)\) \{ this\._clearDepartureRoutes\(\); return; \}/.test(block.slice(0, 400)),
    'departure routes are skipped in hotels mode');
}

// Supplier/departure gates on the deals filter are bypassed in hotels mode
ok(/\.filter\(o => hotels \|\| mapSupplierAllows\(o, this\.cfg\.supplierFilter\)\)/.test(widget), 'supplier gate bypassed for hotels');
ok(/\.filter\(o => hotels \|\| !this\._depAllow/.test(widget), 'departure gate bypassed for hotels');

// Filter UI strings + markup exist for board and nights
ok(/board: 'Board'/.test(widget) && /nights: 'Nights'/.test(widget), 'board + nights labels present in MESSAGES');
ok(/data-ov-filter-board/.test(widget) && /data-ov-board-seg/.test(widget), 'board filter group in the overlay markup');
ok(/data-ov-filter-nights/.test(widget) && /data-ov-nights-seg/.test(widget), 'nights filter group in the overlay markup');
ok(/if \(this\._isHotels\(\) && boardGroup && nightsGroup/.test(widget), 'board + nights controls only populate in hotels mode');

// Version bump
{
  const vm = widget.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok(vm && (+vm[1] > 3 || (+vm[1] === 3 && +vm[2] >= 14)), 'widget version at or beyond 3.14');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
