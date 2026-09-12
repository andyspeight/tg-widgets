/**
 * Hotel Offers (TTI) smoke tests.
 *
 * The Hotel Offers widget is the Travel Offers engine scoped to a list of
 * Travelify property codes instead of a list of places. Three files have to
 * agree on exactly one thing for it to work at all — how a pasted TTI code
 * becomes a Redis key — so that agreement is what most of this file checks.
 *
 * Run: npm run test:hotel-offers
 */

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import {
  canonTti,
  codesFromConfig,
  searchFromConfig,
  buildTtiPayload,
  offerIsProperty,
} from '../api/_lib/offers/tti.js';

const WIDGET = readFileSync(new URL('../public/widget-offers.js', import.meta.url), 'utf8');
const CACHED = readFileSync(new URL('../api/cached-offers.js', import.meta.url), 'utf8');
const CRON = readFileSync(new URL('../api/cron/refresh-tti-offers.js', import.meta.url), 'utf8');
const TTI_LIB = readFileSync(new URL('../api/_lib/offers/tti.js', import.meta.url), 'utf8');
const VERCEL = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const WIDGET_CONFIG = readFileSync(new URL('../api/widget-config.js', import.meta.url), 'utf8');
const DASHBOARD = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const EDITOR = readFileSync(new URL('../public/editor-hotel-offers.html', import.meta.url), 'utf8');
const DEMO = readFileSync(new URL('../public/demo-hotel-offers.html', import.meta.url), 'utf8');
const TOUR = readFileSync(new URL('../public/tour-hotel-offers.js', import.meta.url), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { failures.push(`${name}\n    ${err.message}`); }
}

// ── The one invariant that matters most ────────────────────────────────────
// The cron WRITES offers:tti:{appId}:{code}; the endpoint READS it; the widget
// asks for {code}. All three canonicalise the pasted token themselves, so a
// difference in any one of them is not a bug that degrades — it is a total,
// silent miss on every Hotel Offers widget in the estate.

test('the TTI code regex is identical in all three files', () => {
  const RE = /\^\[A-Z0-9\]\[A-Z0-9\._-\]\{0,31\}\$/;
  for (const [label, src] of [['widget', WIDGET], ['cached-offers', CACHED], ['tti lib', TTI_LIB]]) {
    assert.ok(RE.test(src), `${label} does not carry the shared TTI code pattern`);
    assert.ok(
      /replace\(\/\^TTI:\/, ''\)/.test(src),
      `${label} does not strip the TTI: prefix, so a prefixed and a bare code would key differently`,
    );
  }
});

test('canonTti folds the prefixed and bare spellings together', () => {
  assert.equal(canonTti('TTI:10946397'), '10946397');
  assert.equal(canonTti('10946397'), '10946397');
  assert.equal(canonTti(' tti:76853197 '), '76853197');
  assert.equal(canonTti('ABC-123.4'), 'ABC-123.4');
});

test('canonTti rejects anything that could escape the key namespace', () => {
  for (const bad of ['', null, undefined, 'a b', 'x:y', '../../etc', 'a/b', '*', 'TTI:', '#1', 'a'.repeat(33)]) {
    assert.equal(canonTti(bad), '', `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

// ── Reading the property list off a saved config ───────────────────────────

test('codesFromConfig reads the three shapes an editor or a paste can produce', () => {
  const asObjects = codesFromConfig({ ttiCodes: [{ code: 'TTI:111', name: 'Hotel One', ctry: 'es' }] });
  assert.deepEqual(asObjects, [{ code: '111', name: 'Hotel One', ctry: 'ES' }]);

  const asStrings = codesFromConfig({ ttiCodes: ['TTI:222', '333'] });
  assert.deepEqual(asStrings.map((p) => p.code), ['222', '333']);

  // One property per line, commas separating code, name and country — the
  // column order of our own hotel spreadsheets.
  const asText = codesFromConfig({ ttiCodes: 'TTI:444, Vida Beach Resort, AE\nTTI:555, Cocobay Resort, AG' });
  assert.deepEqual(asText, [
    { code: '444', name: 'Vida Beach Resort', ctry: 'AE' },
    { code: '555', name: 'Cocobay Resort', ctry: 'AG' },
  ]);
});

test('codesFromConfig dedupes across spellings and drops junk', () => {
  const out = codesFromConfig({ ttiCodes: ['TTI:999', '999', 'not a code!', '', 'TTI:888'] });
  assert.deepEqual(out.map((p) => p.code), ['999', '888']);
});

test('codesFromConfig caps the list so one paste cannot become a thousand searches', () => {
  const many = Array.from({ length: 250 }, (_, i) => `TTI:${100000 + i}`);
  assert.equal(codesFromConfig({ ttiCodes: many }).length, 100);
});

test('codesFromConfig strips control characters and markup out of a pasted name', () => {
  const [p] = codesFromConfig({ ttiCodes: [{ code: '1', name: 'Ho<script>tel' }] });
  assert.ok(!p.name.includes('<'), 'a pasted name must not carry markup upstream');
});

test('an empty or unreadable config yields no work rather than a broad search', () => {
  assert.deepEqual(codesFromConfig({}), []);
  assert.deepEqual(codesFromConfig({ ttiCodes: '' }), []);
  assert.deepEqual(codesFromConfig(null), []);
});

// ── The search shape one widget implies ────────────────────────────────────

test('only the hotel and the dynamic package are ever swept', () => {
  // Andy, 12 Sep 2026. A flight has no hotel to pin, and an operator package
  // holiday is a pre-bundled product whose hotel is not inventory we can
  // anchor on. Whatever a config says, the ask narrows to those two.
  for (const t of ['Flights', 'DynamicPackages', 'PackageHolidays', 'BothPackages', 'Any', 'nonsense']) {
    const sr = searchFromConfig({ type: t });
    if (sr.type === 'Accommodation') continue;
    assert.equal(sr.type, 'Packages', `${t} should sweep the packages family`);
    assert.equal(sr.packageType, 'DynamicPackages',
      `${t} must narrow to dynamic packages, never to Any (which lets operator packages in)`);
  }
  const acc = searchFromConfig({ type: 'Accommodation' });
  assert.equal(acc.type, 'Accommodation');
  assert.equal(acc.packageType, null);
});

test('the swept type stays the FAMILY name so the read side can sort DP from operator', () => {
  // normaliseOffers stamps search.type onto the stored offer, and
  // cached-offers.js expects the packages family there — it separates a
  // dynamic package from an operator one with packageKindOf at read time.
  // Stamping 'DynamicPackages' would make every stored package invisible.
  assert.equal(searchFromConfig({ type: 'DynamicPackages' }).type, 'Packages');
  assert.ok(
    /normaliseOffers\(Array\.isArray\(raw\) \? raw : \[\], search\.type\)/.test(CRON),
    'the parser must be stamped with the family type, not the narrowed one',
  );
});

test('a property asked for as both types is swept as both, and pooled', () => {
  assert.ok(/item\.searches\.map\(\(sr\) => fetchProperty\(item, sr\)\)/.test(CRON),
    'each product type a property was asked for needs its own request');
  assert.ok(/verified: ok\.flatMap\(\(r\) => r\.verified\)/.test(CRON),
    'both types share one cache key, so their offers pool');
  assert.ok(/if \(budget < item\.searches\.length\) break;/.test(CRON),
    'the per-run ceiling must count requests, not properties');
});

test('the engine never asks the cache for a type the sweep cannot store', () => {
  assert.ok(
    /if \(type !== 'Accommodation'\) q\.set\('type', 'DynamicPackages'\)/.test(WIDGET),
    'a legacy or hand-edited type must be coerced, not trusted',
  );
});

test('the editor and demo offer only the two supported types', () => {
  for (const [label, src] of [['editor', EDITOR], ['demo', DEMO]]) {
    const sel = /<select id="c(?:fg|trl)Type">([\s\S]*?)<\/select>/.exec(src);
    assert.ok(sel, `${label}: type picker not found`);
    const values = [...sel[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(values, ['Accommodation', 'DynamicPackages'],
      `${label} offers types the sweep never stores`);
  }
});

test('searchFromConfig clamps the date window and falls back to sane defaults', () => {
  const wild = searchFromConfig({ DatesMin: -50, DatesMax: 99999, currency: 'nonsense', nationality: 'x' });
  assert.equal(wild.DatesMin, 0);
  assert.equal(wild.DatesMax, 700);
  assert.equal(wild.currency, 'GBP');
  assert.equal(wild.nationality, 'GB');
});

// ── Building the upstream ask ──────────────────────────────────────────────

test('no configured property parameter means NO search is built', () => {
  // The whole point: until Travelify names the parameter, this job must fire
  // nothing rather than fire a broad search per code and bin the results.
  assert.equal(process.env.TTI_PROPERTY_PARAM, undefined, 'test env must leave the param unset');
  assert.equal(buildTtiPayload('250', { code: '111', name: 'Hotel One' }, searchFromConfig({})), null);
});

test('an overridden parameter builds a single-value ask', () => {
  const p = buildTtiPayload('250', { code: '111' }, searchFromConfig({}),
    { param: 'refn', array: false, prefixed: true });
  assert.equal(p.refn, 'TTI:111');
  assert.equal(p.appId, '250');
  assert.equal(p.type, 'Accommodation');
  assert.equal(p.sort, 'price:asc');
  assert.ok(!('destinations' in p), 'a property ask must never carry a destination scope');
});

test('an array-shaped parameter and a bare-code shape are both buildable', () => {
  const arr = buildTtiPayload('250', { code: '111' }, searchFromConfig({}),
    { param: 'uniqueRefs', array: true, prefixed: false });
  assert.deepEqual(arr.uniqueRefs, ['111']);
});

test("the documented loct=Property shape needs the hotel's name", () => {
  const spec = { shape: 'loct' };
  const withName = buildTtiPayload('250', { code: '111', name: 'Vida Beach Resort', ctry: 'AE' },
    searchFromConfig({}), spec);
  assert.equal(withName.loct, 'Property');
  assert.equal(withName.loc, 'Vida Beach Resort');
  assert.equal(withName.ctry, 'AE');

  // Without a name there is nothing to anchor on, and a nameless ask would come
  // back as the whole country. Skip, do not guess.
  assert.equal(buildTtiPayload('250', { code: '111' }, searchFromConfig({}), spec), null);
});

test('a payload without a code is never built', () => {
  assert.equal(buildTtiPayload('250', { code: '' }, searchFromConfig({}),
    { param: 'refn', array: false, prefixed: false }), null);
});

// ── The verify gate ────────────────────────────────────────────────────────

test('only offers for the requested property survive the verify gate', () => {
  // Travelify ignores parameters it does not recognise, so a wrong param comes
  // back 200 with unrelated inventory. Without this gate a client's "our twelve
  // hotels" widget would quietly fill with somebody else's rooms.
  assert.equal(offerIsProperty({ accommodationUniqueRef: 'TTI:111' }, '111'), true);
  assert.equal(offerIsProperty({ accommodationUniqueRef: '111' }, '111'), true);
  assert.equal(offerIsProperty({ accommodationUniqueRef: 'TTI:222' }, '111'), false);
  assert.equal(offerIsProperty({ accommodationUniqueRef: null }, '111'), false);
  assert.equal(offerIsProperty({}, '111'), false);
});

test('the verify gate is wired into the fetch path, not merely defined', () => {
  assert.ok(
    /const verified = parsed\.filter\(\(o\) => offerIsProperty\(o, item\.code\)\)/.test(CRON),
    'fetchProperty must filter every parsed offer through the verify gate',
  );
  assert.ok(/storeProperty\(item, r\.verified/.test(CRON), 'only verified offers may be stored');
});

// ── The endpoint ───────────────────────────────────────────────────────────

test('TTI mode replaces the destination scope rather than joining it', () => {
  assert.ok(
    /const dest = ttiMode \? \{ codes: \[\], names: \[\], invalid: false \} : parseDestinations/.test(CACHED),
    'destinations must be ignored entirely in TTI mode',
  );
  assert.ok(
    /keyGroups = tti\.codes\.map\(\(code\) => \[ttiKey\(ttiAppId, code\)\]\)/.test(CACHED),
    'TTI mode must read the per-property keys',
  );
});

test('an unusable code or App ID is an honest miss, never a widened read', () => {
  assert.ok(
    /if \(ttiMode && \(tti\.invalid \|\| !tti\.codes\.length \|\| !ttiAppId\)\)[\s\S]{0,220}unresolvedFilters: true/.test(CACHED),
    'a bad TTI query must return an empty result flagged unresolvedFilters',
  );
});

test('the TTI pool is keyed by App ID so clients cannot be served each others rates', () => {
  assert.ok(/const ttiKey = \(appId, code\) => `\$\{TTI_PREFIX\}\$\{appId\}:\$\{code\}`/.test(CACHED));
  assert.ok(/const ttiKey = \(appId, code\) => `\$\{TTI_PREFIX\}\$\{appId\}:\$\{code\}`/.test(CRON));
});

test('Hotel Offers reads are attributed to their own widget type', () => {
  assert.ok(/servedWidgetType/.test(CACHED) && /'Hotel Offers' : 'Travel Offers'/.test(CACHED));
});

// ── The widget ─────────────────────────────────────────────────────────────

test('the engine sends tti and appId, and omits destinations, when codes are set', () => {
  assert.ok(/q\.set\('tti', ttiCodes\.join\(','\)\)/.test(WIDGET));
  assert.ok(/q\.set\('appId', String\(this\.cfg\.appId\)\)/.test(WIDGET));
  assert.ok(
    /if \(ttiCodes\.length\) \{[\s\S]{0,1500}\} else if \(Array\.isArray\(payload\.destinations\)/.test(WIDGET),
    'a TTI widget must not also send a destination filter',
  );
});

test('the engine auto-inits on both widget tags and aliases the class', () => {
  assert.ok(/\[data-tg-widget="offers"\], \[data-tg-widget="hotel-offers"\]/.test(WIDGET));
  assert.ok(/window\.TGHotelOffersWidget = TGOffersWidget/.test(WIDGET));
});

test('the cache-only rule still holds on the new path', () => {
  // No live-Travelify fallback may creep back in behind an empty TTI cache.
  // An empty answer is the calm empty state, not a visitor-triggered search.
  assert.ok(
    !/ttiCodes[\s\S]{0,400}\/api\/offers/.test(WIDGET),
    'the TTI path must never reach the live offers proxy',
  );
});

// ── Registration ───────────────────────────────────────────────────────────

test('Hotel Offers is registered everywhere a widget type has to be', () => {
  assert.ok(/'Hotel Offers'/.test(WIDGET_CONFIG), 'missing from ALLOWED_WIDGET_TYPES');
  assert.ok(
    /'Hotel Offers':\s*\{[^}]*Spark[^}]*\}/.test(WIDGET_CONFIG),
    'missing from PLAN_WIDGET_LIMITS',
  );
  assert.ok(
    /NEEDS_APP_ID = \[[^\]]*'Hotel Offers'/.test(WIDGET_CONFIG),
    'Hotel Offers must receive the owning client App ID, or its cache key cannot be built',
  );
  assert.ok(/airtableType: 'Hotel Offers'/.test(DASHBOARD), 'missing from the dashboard registry');
});

test('the plan map and the dashboard registry agree', () => {
  const api = /'Hotel Offers':\s*\{([^}]*)\}/.exec(WIDGET_CONFIG);
  const reg = /airtableType: 'Hotel Offers'[\s\S]*?access: \{([^}]*)\}/.exec(DASHBOARD);
  assert.ok(api && reg, 'could not read both plan maps');
  const norm = (s) => s.replace(/\s|'/g, '').split(',').filter(Boolean).sort().join('|');
  assert.equal(norm(api[1]), norm(reg[1]),
    'PLAN_WIDGET_LIMITS and the registry access field have drifted');
});

test('a widget available on a plan is unlimited there', () => {
  // Andy, 8 Sep 2026: never a positive count in a plan map.
  const api = /'Hotel Offers':\s*\{([^}]*)\}/.exec(WIDGET_CONFIG);
  for (const pair of api[1].split(',')) {
    if (!pair.trim()) continue;
    const v = Number(pair.split(':')[1]);
    assert.ok(v === -1 || v === 0, `plan limits must be -1 or 0, found ${v}`);
  }
});

test('vercel.json serves the widget, the editor and the demo', () => {
  const rewrites = VERCEL.rewrites || [];
  const has = (src) => rewrites.some((r) => r.source === src);
  assert.ok(has('/editor-hotel-offers'), 'missing editor rewrite — the clean URL would 404');
  assert.ok(has('/demo-hotel-offers'), 'missing demo rewrite');
  assert.ok(
    rewrites.some((r) => r.source === '/widget-hotel-offers.js' && r.destination === '/widget-offers.js'),
    'the widget script must rewrite onto the shared engine',
  );
  const headers = (VERCEL.headers || []).find((h) => h.source === '/widget-hotel-offers.js');
  assert.ok(headers, 'missing CORS/cache headers for the widget script');
  const keys = headers.headers.map((h) => h.key);
  assert.ok(keys.includes('Access-Control-Allow-Origin'), 'widget script must be CORS-open');
});

test('the nightly sweep is scheduled', () => {
  const cron = (VERCEL.crons || []).find((c) => c.path === '/api/cron/refresh-tti-offers');
  assert.ok(cron, 'the TTI refresh cron is not scheduled');
  assert.ok(/^\d+ \d+ \* \* \*$/.test(cron.schedule), `expected a nightly schedule, got ${cron.schedule}`);
});

// ── The editor ─────────────────────────────────────────────────────────────

test('the editor saves as Hotel Offers and embeds the right script', () => {
  assert.ok(/const WIDGET_TYPE = 'Hotel Offers';/.test(EDITOR));
  assert.ok(/widgetTag: 'hotel-offers'/.test(EDITOR));
  assert.ok(/scriptFile: 'widget-hotel-offers\.js'/.test(EDITOR));
  assert.ok(/widget-hotel-offers\.js"><\\\/script>/.test(EDITOR), 'embed snippet must name the new script');
});

test('the editor canonicalises TTI codes the same way as everything else', () => {
  const RE = /\^\[A-Z0-9\]\[A-Z0-9\._-\]\{0,31\}\$/;
  assert.ok(RE.test(EDITOR), 'the editor must use the shared code pattern');
  assert.ok(/replace\(\/\^TTI:\/, ''\)/.test(EDITOR));
});

test('the editor has no dead destination controls left behind', () => {
  assert.ok(!/destChips|destInput/.test(EDITOR), 'retired destination chips must be gone');
  assert.ok(/id="cfgTtiCodes"/.test(EDITOR), 'the property list field is missing');
});

test('the editor availability strip counts the property pool, not a place', () => {
  assert.ok(/q\.set\('tti', codes\.join\(','\)\)/.test(EDITOR));
  assert.ok(!/q\.set\('destinations'/.test(EDITOR),
    'counting a destination pool would promise offers the widget never reads');
});

test('the editor never rewrites the property field while it is focused', () => {
  // The preview re-renders on every keystroke. Rewriting the textarea under the
  // cursor is the focus-stealing the suite's render rules forbid.
  assert.ok(
    /document\.activeElement !== ttiTa/.test(EDITOR),
    'hydration must skip the field the agent is typing into',
  );
});

test('the editor templates are layout presets, not dead destination filters', () => {
  const block = /const TEMPLATES = \[([\s\S]*?)\n    \];/.exec(EDITOR);
  assert.ok(block, 'templates not found');
  assert.ok(!/destinations:/.test(block[1]),
    'a destination filter in a property-scoped widget is config that does nothing');
});

// ── The demo and the tour ──────────────────────────────────────────────────

test('the demo mounts the shared engine and loads the rewritten script', () => {
  assert.ok(/widget-hotel-offers\.js/.test(DEMO));
  assert.ok(/new window\.TGHotelOffersWidget\(/.test(DEMO));
  assert.ok(/ttiCodes:/.test(DEMO) && !/ctrlDest/.test(DEMO));
});

test('the tour points at the property list, not the retired destination input', () => {
  assert.ok(/#cfgTtiCodes/.test(TOUR));
  assert.ok(!/#destInput/.test(TOUR));
  assert.ok(/openSectionByTitle\('Your properties'\)/.test(TOUR));
  // Its own id, so dismissing one tour does not silently dismiss the other.
  assert.ok(/'hotel-offers'/.test(TOUR) && !/tourLauncher\(\{ id: 'offers'/.test(TOUR));
});

// ── Report ─────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error(`\nhotel-offers: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`hotel-offers: ${passed} passed`);
