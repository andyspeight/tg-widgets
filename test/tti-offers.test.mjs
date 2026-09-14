/**
 * TTI Offers smoke tests.
 *
 * The TTI Offers widget is the Travel Offers engine scoped to a list of
 * Travelify property codes instead of a list of places. Three files have to
 * agree on exactly one thing for it to work at all — how a pasted TTI code
 * becomes a Redis key — so that agreement is what most of this file checks.
 *
 * Run: npm run test:tti-offers, or as part of `node --test test/*.test.mjs`,
 * which is what CI runs. This suite belongs in CI: unlike the *-smoke.mjs
 * files beside it, it makes no network calls and spends no API budget. It
 * reads source files and exercises pure functions, nothing more.
 */

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import {
  canonTti,
  codesFromConfig,
  searchFromConfig,
  buildTtiPayload,
  offerIsProperty,
  PROBE_CANDIDATES,
  buildAccommodationCriteria, resultIsProperty,
  parseDeeplink, rowIsSearchable, normaliseAccommodationResult,
  cleanIp,
  buildDynamicPackageCriteria,
  dpOrigins,
  cleanCoord,
  MIN_DP_LEAD_DAYS,
} from '../api/_lib/offers/tti.js';

const WIDGET = readFileSync(new URL('../public/widget-offers.js', import.meta.url), 'utf8');
import {
  resolveArrivalAirport, arrivalAirports, majorAirports, HUB_BONUS_KM,
} from '../api/_lib/offers/arrival-airport.js';

/** Just the two fields a caller acts on, so a distance tweak does not break
 *  an assertion about which airport was chosen. */
const pick = (r) => (r ? { code: r.code, source: r.source } : r);

const TTI_SRC = readFileSync(new URL('../api/_lib/offers/tti.js', import.meta.url), 'utf8');
const CACHED = readFileSync(new URL('../api/cached-offers.js', import.meta.url), 'utf8');
const CRON = readFileSync(new URL('../api/cron/refresh-tti-offers.js', import.meta.url), 'utf8');
const TTI_LIB = readFileSync(new URL('../api/_lib/offers/tti.js', import.meta.url), 'utf8');
const VERCEL = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const WIDGET_CONFIG = readFileSync(new URL('../api/widget-config.js', import.meta.url), 'utf8');
const DASHBOARD = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const EDITOR = readFileSync(new URL('../public/editor-tti-offers.html', import.meta.url), 'utf8');
const DEMO = readFileSync(new URL('../public/demo-tti-offers.html', import.meta.url), 'utf8');
const TOUR = readFileSync(new URL('../public/tour-tti-offers.js', import.meta.url), 'utf8');
const TEST_API = readFileSync(new URL('../api/tti-test.js', import.meta.url), 'utf8');
const RATELIMIT = readFileSync(new URL('../api/_lib/rate-limit-public.js', import.meta.url), 'utf8');

// ── The one invariant that matters most ────────────────────────────────────
// The cron WRITES offers:tti:{appId}:{code}; the endpoint READS it; the widget
// asks for {code}. All three canonicalise the pasted token themselves, so a
// difference in any one of them is not a bug that degrades — it is a total,
// silent miss on every TTI Offers widget in the estate.

test('the TTI code regex is identical in all three files', () => {
  const RE = /\^\[A-Z0-9\]\[A-Z0-9\._-\]\{0,31\}\$/;
  for (const [label, src] of [['widget', WIDGET], ['cached-offers', CACHED], ['tti lib', TTI_LIB]]) {
    assert.ok(RE.test(src), `${label} does not carry the shared TTI code pattern`);
    assert.ok(
      /replace\(\/\^\[A-Z\]\+:\/, ''\)/.test(src),
      `${label} does not strip the reference namespace, so a prefixed and a bare code would key differently`,
    );
  }
});

test('canonTti folds every reference namespace onto the bare code', () => {
  assert.equal(canonTti('TTI:10946397'), '10946397');
  assert.equal(canonTti('10946397'), '10946397');
  assert.equal(canonTti(' tti:76853197 '), '76853197');
  assert.equal(canonTti('ABC-123.4'), 'ABC-123.4');
  // Travelify does not only use TTI. A live GB search returned ID:30924133
  // alongside TTI: references (14 Sep 2026), and the old TTI-only strip
  // rejected those outright: a hotel whose reference came back under ID:
  // could never match, and the test reported it as "not this property".
  assert.equal(canonTti('ID:30924133'), '30924133');
  assert.equal(canonTti('ID:58612582'), canonTti('TTI:58612582'),
    'the same property must key the same whichever namespace it arrives under');
});

test('canonTti rejects anything that could escape the key namespace', () => {
  // Note 'x:y' is no longer here: any LETTERS: prefix is now stripped, so it
  // reads as the code 'Y'. The key segment is still validated by the pattern
  // below, which is what actually keeps the namespace safe.
  for (const bad of ['', null, undefined, 'a b', '../../etc', 'a/b', '*', 'TTI:', 'ID:', '#1', ':::', 'a'.repeat(33)]) {
    assert.equal(canonTti(bad), '', `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

// ── Reading the property list off a saved config ───────────────────────────

test('codesFromConfig reads the three shapes an editor or a paste can produce', () => {
  const asObjects = codesFromConfig({ ttiCodes: [{ code: 'TTI:111', name: 'Hotel One', ctry: 'es' }] });
  assert.deepEqual(asObjects, [{ code: '111', name: 'Hotel One', ctry: 'ES', lat: null, lng: null }]);

  const asStrings = codesFromConfig({ ttiCodes: ['TTI:222', '333'] });
  assert.deepEqual(asStrings.map((p) => p.code), ['222', '333']);

  // One property per line, commas separating code, name and country — the
  // column order of our own hotel spreadsheets.
  const asText = codesFromConfig({ ttiCodes: 'TTI:444, Vida Beach Resort, AE\nTTI:555, Cocobay Resort, AG' });
  assert.deepEqual(asText, [
    { code: '444', name: 'Vida Beach Resort', ctry: 'AE', lat: null, lng: null },
    { code: '555', name: 'Cocobay Resort', ctry: 'AG', lat: null, lng: null },
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

test('the cron asks for a package as a package, not a relabelled hotel', () => {
  // A dynamic package sends flight criteria alongside the hotel and prices the
  // two together. Running the hotel search and stamping it a package is what
  // put hotel-only prices under a package heading (Andy, 14 Sep 2026).
  assert.ok(/const isDp = search\.type !== 'Accommodation'/.test(CRON));
  assert.ok(/isDp\s*\n?\s*\? buildDynamicPackageCriteria\(item, opts\)/.test(CRON.replace(/\r/g, '')),
    'a package widget must get the package search');
  // What the price COVERS travels on the offer, not in its shelf label: the
  // cache key is per property and both searches return a property, so a stored
  // 'DynamicPackages' type matched nothing the widget ever asked for.
  assert.ok(/\.\.\.\(origin \? \{ origin \} : \{\}\)/.test(CRON),
    'a package offer must carry the airport it flies from');
});

test('a property asked for as both types is swept as both, and pooled', () => {
  assert.ok(/asks\.map\(\(\[sr, origin\]\) => fetchProperty\(item, sr, origin\)\)/.test(CRON),
    'each product type a property was asked for needs its own request');
  assert.ok(/for \(const origin of dpOrigins\(sr, CRON_MAX_ORIGINS\)\) asks\.push/.test(CRON),
    'and a package needs one per departure airport');
  assert.ok(/verified: ok\.flatMap\(\(r\) => r\.verified\)/.test(CRON),
    'both types share one cache key, so their offers pool');
  assert.ok(/if \(budget < item\.searches\.length\) break;/.test(CRON),
    'the per-run ceiling must count requests, not properties');
});

test('the engine never asks the cache for a type the sweep cannot store', () => {
  // The sweep stores exactly two types and the widget may ask for exactly
  // those two. The RULE, shared by the widget, both editor call sites and the
  // server's own searchFromConfig: a widget is selling a package unless its
  // type is exactly 'Accommodation'.
  //
  // Asserted as behaviour rather than as a spelling. Earlier versions of this
  // test matched a literal source string, so it broke on every refactor while
  // failing to notice a THIRD call site that was hard-coded (the read-back).
  assert.ok(/String\(this\.cfg\.type \|\| 'Accommodation'\) !== 'Accommodation'/.test(WIDGET),
    'the TTI branch must treat anything that is not Accommodation as a package');
  assert.ok(!/=== 'DynamicPackages' \? 'DynamicPackages'/.test(WIDGET),
    "matching the literal 'DynamicPackages' hides a config saved as 'Packages'");
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
// The shape comes from two real deep links (Andy, 14 Sep 2026): a city-scale
// area search (loct=City, a 28km radius) with the property pinned by
// refn=TTI:{code} alone. Not loct=Property, and not a tight pin.

const DUBAI = {
  code: '12345',
  loc: 'Dubai, United Arab Emirates',
  ctry: 'AE',
  lat: 25.0490889376,
  lng: 55.1180329667,
};

test('the accommodation ask mirrors the real accommodation deep link', () => {
  const p = buildTtiPayload('100', DUBAI, searchFromConfig({ type: 'Accommodation' }));
  assert.equal(p.type, 'Accommodation');
  assert.equal(p.loc, 'Dubai, United Arab Emirates');
  assert.equal(p.loct, 'City', 'the area is a CITY, not the property');
  assert.equal(p.lat, 25.0490889376);
  assert.equal(p.lng, 55.1180329667);
  assert.equal(p.rad, 28);
  assert.equal(p.refn, 'TTI:12345', 'the property is pinned by refn alone');
  assert.equal(p.curr, undefined);
  assert.equal(p.currency, 'GBP');
  assert.ok(!('origins' in p), 'a hotel on its own has no departure point');
});

test('the dynamic package ask adds a departure point and nothing else', () => {
  const p = buildTtiPayload('100', DUBAI,
    searchFromConfig({ type: 'DynamicPackages', origins: ['LGW'] }));
  assert.equal(p.type, 'Packages');
  assert.equal(p.packageType, 'DynamicPackages');
  assert.deepEqual(p.origins, ['LGW'], 'org on the deep link, origins on the feed');
  assert.equal(p.loct, 'City');
  assert.equal(p.refn, 'TTI:12345');
});

test('refn is the default pin, so the sweep runs without configuration', () => {
  // The whole point of the 14 Sep change: an area search plus the verify gate
  // is correct whether or not the feed honours refn, so there is nothing to
  // wait for. TTI_PROPERTY_PARAM only overrides the spelling.
  assert.equal(process.env.TTI_PROPERTY_PARAM, undefined, 'test env must leave it unset');
  const p = buildTtiPayload('100', DUBAI, searchFromConfig({}));
  assert.ok(p, 'a payload must be built with no env var set');
  assert.equal(p.refn, 'TTI:12345');
});

test('an ask with no area at all is never built', () => {
  // A worldwide search that the verify gate then threw away is exactly the
  // wasted Travelify capacity the cache-only rule exists to prevent.
  assert.equal(buildTtiPayload('100', { code: '12345' }, searchFromConfig({})), null);
  // Any ONE of the three is enough to scope it.
  assert.ok(buildTtiPayload('100', { code: '1', ctry: 'AE' }, searchFromConfig({})));
  assert.ok(buildTtiPayload('100', { code: '1', loc: 'Dubai' }, searchFromConfig({})));
  assert.ok(buildTtiPayload('100', { code: '1', lat: 25, lng: 55 }, searchFromConfig({})));
});

test('a payload without a code is never built', () => {
  assert.equal(buildTtiPayload('100', { ...DUBAI, code: '' }, searchFromConfig({})), null);
});

test('an overridden pin changes only the pin, never the area', () => {
  const base = buildTtiPayload('100', DUBAI, searchFromConfig({}));
  const arr = buildTtiPayload('100', DUBAI, searchFromConfig({}),
    { param: 'uniqueRefs', array: true, prefixed: false });
  assert.deepEqual(arr.uniqueRefs, ['12345']);
  assert.ok(!('refn' in arr), 'the default pin must be replaced, not joined');
  for (const k of ['loc', 'loct', 'lat', 'lng', 'rad', 'destinations']) {
    assert.deepEqual(arr[k], base[k], `${k} must be held constant across candidates`);
  }
});

test('the unpinned candidate is a real ask, and it is the control', () => {
  const none = buildTtiPayload('100', DUBAI, searchFromConfig({}), { shape: 'none' });
  assert.ok(none, 'the control must still be a valid search');
  assert.ok(!('refn' in none), 'the control carries no pin at all');
  assert.equal(none.loct, 'City', 'but keeps the same area');
  assert.ok(PROBE_CANDIDATES.some((c) => c.shape === 'none'),
    'the probe needs an unpinned run to read the others against');
  assert.equal(PROBE_CANDIDATES[0].param, 'refn',
    'the spelling the real links use should be tried first');
});

test('the search radius is the real links 28km, and is clamped', () => {
  assert.equal(searchFromConfig({}).radiusKm, 28);
  assert.equal(searchFromConfig({ ttiRadiusKm: 5 }).radiusKm, 5);
  assert.equal(searchFromConfig({ ttiRadiusKm: 9999 }).radiusKm, 200);
  assert.equal(searchFromConfig({ ttiRadiusKm: 0 }).radiusKm, 1);
});

test('a dynamic package carries a departure point, a hotel does not', () => {
  const dp = searchFromConfig({ type: 'DynamicPackages', origins: ['LGW', 'man', 'GB', 'nope!'] });
  assert.deepEqual(dp.origins, ['LGW', 'MAN', 'GB'], 'origins normalise and junk is dropped');
  assert.deepEqual(searchFromConfig({ type: 'Accommodation', origins: ['LGW'] }).origins, []);
});

test('coordinates are parsed and bounded, from a row or a pasted line', () => {
  const [row] = codesFromConfig({ ttiCodes: 'TTI:1, Dubai, AE, 25.049, 55.118' });
  assert.equal(row.lat, 25.049);
  assert.equal(row.lng, 55.118);
  // A mis-pasted column must not travel upstream as a location.
  const [bad] = codesFromConfig({ ttiCodes: [{ code: '2', lat: 999, lng: 'north' }] });
  assert.equal(bad.lat, null);
  assert.equal(bad.lng, null);
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
  // Every result is checked against the property that was asked for before it
  // is kept. Without this the sweep would cache whatever the area returned.
  assert.ok(/if \(!resultIsProperty\(one, item\.code\)\) continue;/.test(CRON),
    'fetchProperty must filter every result through the verify gate');
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

test('TTI Offers reads are attributed to their own widget type', () => {
  assert.ok(/servedWidgetType/.test(CACHED) && /'TTI Offers' : 'Travel Offers'/.test(CACHED));
});

// ── The widget ─────────────────────────────────────────────────────────────

test('the engine sends tti and appId, and omits destinations, when codes are set', () => {
  assert.ok(/q\.set\('tti', ttiCodes\.join\(','\)\)/.test(WIDGET));
  assert.ok(/q\.set\('appId', String\(this\.cfg\.appId\)\)/.test(WIDGET));
  assert.ok(
    /if \(ttiCodes\.length\) \{[\s\S]{0,2600}\} else if \(!this\._isTti && Array\.isArray\(payload\.destinations\)/.test(WIDGET),
    'destinations must stay in the else-branch, and be refused for a TTI widget outright',
  );
});

test('the engine auto-inits on both widget tags and aliases the class', () => {
  assert.ok(/\[data-tg-widget="offers"\], \[data-tg-widget="tti-offers"\]/.test(WIDGET));
  assert.ok(/window\.TGTtiOffersWidget = TGOffersWidget/.test(WIDGET));
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

test('TTI Offers is registered everywhere a widget type has to be', () => {
  assert.ok(/'TTI Offers'/.test(WIDGET_CONFIG), 'missing from ALLOWED_WIDGET_TYPES');
  assert.ok(
    /'TTI Offers':\s*\{[^}]*Spark[^}]*\}/.test(WIDGET_CONFIG),
    'missing from PLAN_WIDGET_LIMITS',
  );
  assert.ok(
    /NEEDS_APP_ID = \[[^\]]*'TTI Offers'/.test(WIDGET_CONFIG),
    'TTI Offers must receive the owning client App ID, or its cache key cannot be built',
  );
  assert.ok(/airtableType: 'TTI Offers'/.test(DASHBOARD), 'missing from the dashboard registry');
});

test('the plan map and the dashboard registry agree', () => {
  const api = /'TTI Offers':\s*\{([^}]*)\}/.exec(WIDGET_CONFIG);
  const reg = /airtableType: 'TTI Offers'[\s\S]*?access: \{([^}]*)\}/.exec(DASHBOARD);
  assert.ok(api && reg, 'could not read both plan maps');
  const norm = (s) => s.replace(/\s|'/g, '').split(',').filter(Boolean).sort().join('|');
  assert.equal(norm(api[1]), norm(reg[1]),
    'PLAN_WIDGET_LIMITS and the registry access field have drifted');
});

test('a widget available on a plan is unlimited there', () => {
  // Andy, 8 Sep 2026: never a positive count in a plan map.
  const api = /'TTI Offers':\s*\{([^}]*)\}/.exec(WIDGET_CONFIG);
  for (const pair of api[1].split(',')) {
    if (!pair.trim()) continue;
    const v = Number(pair.split(':')[1]);
    assert.ok(v === -1 || v === 0, `plan limits must be -1 or 0, found ${v}`);
  }
});

test('vercel.json serves the widget, the editor and the demo', () => {
  const rewrites = VERCEL.rewrites || [];
  const has = (src) => rewrites.some((r) => r.source === src);
  assert.ok(has('/editor-tti-offers'), 'missing editor rewrite — the clean URL would 404');
  assert.ok(has('/demo-tti-offers'), 'missing demo rewrite');
  assert.ok(
    rewrites.some((r) => r.source === '/widget-tti-offers.js' && r.destination === '/widget-offers.js'),
    'the widget script must rewrite onto the shared engine',
  );
  const headers = (VERCEL.headers || []).find((h) => h.source === '/widget-tti-offers.js');
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

test('the editor saves as TTI Offers and embeds the right script', () => {
  assert.ok(/const WIDGET_TYPE = 'TTI Offers';/.test(EDITOR));
  assert.ok(/widgetTag: 'tti-offers'/.test(EDITOR));
  assert.ok(/scriptFile: 'widget-tti-offers\.js'/.test(EDITOR));
  assert.ok(/widget-tti-offers\.js"><\\\/script>/.test(EDITOR), 'embed snippet must name the new script');
});

test('the editor canonicalises TTI codes the same way as everything else', () => {
  const RE = /\^\[A-Z0-9\]\[A-Z0-9\._-\]\{0,31\}\$/;
  assert.ok(RE.test(EDITOR), 'the editor must use the shared code pattern');
  assert.ok(/replace\(\/\^\[A-Z\]\+:\/, ''\)/.test(EDITOR));
  // The editor also strips the namespace when reading a saved config back,
  // or a hotel saved as ID: would show a mangled code in its input.
  assert.ok(!/\^TTI:/.test(EDITOR), 'no TTI-only strip may remain anywhere in the editor');
});


test('the editor has no dead destination controls left behind', () => {
  assert.ok(!/destChips|destInput/.test(EDITOR), 'retired destination chips must be gone');
  assert.ok(!/cfgTtiCodes|ttiTextOf|ttiCodesOf/.test(EDITOR), 'the retired textarea helpers must be gone');
  assert.ok(/id="ttiRows"/.test(EDITOR), 'the property row list is missing');
});



test('the editor availability strip counts the property pool, not a place', () => {
  assert.ok(/q\.set\('tti', codes\.join\(','\)\)/.test(EDITOR));
  assert.ok(!/q\.set\('destinations'/.test(EDITOR),
    'counting a destination pool would promise offers the widget never reads');
});

test('the editor never rebuilds the property rows while one is focused', () => {
  // The preview re-renders on every keystroke. Rebuilding the inputs under the
  // cursor is the focus-stealing the suite's render rules forbid.
  assert.ok(
    /host\.contains\(document\.activeElement\)/.test(EDITOR),
    'hydration must skip the rows while the agent is typing in one',
  );
  assert.ok(
    !/renderTtiRows\(\);\s*\}\);\s*code\.addEventListener/.test(EDITOR),
    'a keystroke handler must not redraw the row it is typing into',
  );
});

// ── The Test button ────────────────────────────────────────────────────────



test('the test endpoint keeps its rate limit even though the editor calls it', () => {
  // It is the only agent action that spends live Travelify searches, so the
  // trusted-preview relax must not switch its limit off.
  assert.ok(/case 'tti-test':/.test(RATELIMIT), 'tti-test needs its own window, not the null default');
  assert.ok(
    /NO_PREVIEW_RELAX = event === 'popup-lead' \|\| event === 'trip-enquiry'[\s\S]{0,80}event === 'tti-test'/.test(RATELIMIT),
    'the editor-preview relax must not apply to a live-search path',
  );
});




test('the editor templates are layout presets, not dead destination filters', () => {
  const block = /const TEMPLATES = \[([\s\S]*?)\n    \];/.exec(EDITOR);
  assert.ok(block, 'templates not found');
  assert.ok(!/destinations:/.test(block[1]),
    'a destination filter in a property-scoped widget is config that does nothing');
});

// ── Every function the editor calls must exist ─────────────────────────────
// The one class of bug the rest of this file cannot see. These tests read
// source text, so they happily confirm that a call is PRESENT while the thing
// it calls was never defined. That shipped: esc() was called six times in an
// editor that had no such helper, including inside the catch block, so the
// Test button threw, then threw again while reporting the throw, and froze on
// its own progress message with no error anywhere.

function inlineScriptOf(html) {
  const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const raw = blocks.reduce((a, b) => (b.length > a.length ? b : a), '');
  // Comments and strings are full of prose like "the config (see above)", which
  // looks exactly like a call, so neither can be scanned for real ones.
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const BROWSER_GLOBALS = new Set([
  'async', 'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await', 'new',
  'do', 'else', 'try', 'throw', 'delete', 'void', 'in', 'of', 'case', 'yield', 'with', 'super',
  'this', 'constructor',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'RegExp', 'Map', 'Set',
  'WeakMap', 'Promise', 'Error', 'Symbol', 'BigInt', 'Proxy', 'Reflect', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'structuredClone', 'queueMicrotask', 'btoa', 'atob',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'fetch', 'alert', 'confirm', 'prompt', 'console', 'document', 'window',
  'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'CustomEvent', 'Event',
  'URL', 'URLSearchParams', 'FormData', 'Blob', 'File', 'FileReader', 'Image', 'AbortController',
  'IntersectionObserver', 'MutationObserver', 'ResizeObserver', 'Node', 'Element', 'HTMLElement',
  'DOMParser', 'TextEncoder', 'TextDecoder', 'getComputedStyle', 'matchMedia', 'CSS',
]);

function undefinedCalls(html) {
  const src = inlineScriptOf(html);
  const defined = new Set();
  for (const re of [
    /\bfunction\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)+)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
  ]) {
    for (const m of src.matchAll(re)) for (const n of m[1].split(',')) defined.add(n.trim());
  }
  // Parameters and loop/catch bindings, so a callback is not mistaken for a
  // missing function. Coarse on purpose: over-collecting here only costs us a
  // missed warning, while under-collecting would cry wolf on every handler.
  for (const m of src.matchAll(/\(([^()]{0,200})\)\s*=>/g)) {
    for (const n of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) defined.add(n[0]);
  }
  for (const m of src.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^()]{0,300})\)/g)) {
    for (const n of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) defined.add(n[0]);
  }
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);

  const missing = new Set();
  // A bare NAME( — not preceded by a dot, so not a method call on something.
  for (const m of src.matchAll(/(^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const n = m[2];
    if (!defined.has(n) && !BROWSER_GLOBALS.has(n)) missing.add(n);
  }
  return [...missing];
}

test('every function the editor calls is actually defined', () => {
  assert.deepEqual(undefinedCalls(EDITOR), [],
    'the editor calls something that does not exist, which throws at runtime');
});

test('the detector really would catch a missing helper', () => {
  // A test that cannot fail is worse than no test, and this one is heuristic
  // enough to be worth proving. Take the helper out and it must complain.
  const without = EDITOR.replace(/ {4}function esc\(v\) \{[\s\S]*?\n {4}\}\n/, '');
  assert.notEqual(without, EDITOR, 'esc() should be defined in the editor');
  assert.ok(undefinedCalls(without).includes('esc'), 'removing esc must be detected');
});

test('esc is defined before anything calls it, and escapes the dangerous characters', () => {
  assert.ok(/function esc\(v\)/.test(EDITOR), 'the editor must define its own esc');
  for (const ch of ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;']) {
    assert.ok(EDITOR.includes(ch), `esc must produce ${ch}`);
  }
});

test('the Test button cannot sit on its progress message forever', () => {
  // The server can be slow, and a platform timeout returns nothing at all, so
  // the UI owns its own deadline rather than trusting a response to arrive.
  assert.ok(/new AbortController\(\)/.test(EDITOR), 'the request needs an abort signal');
  assert.ok(/setTimeout\(\(\) => ctl\.abort\(\)/.test(EDITOR), 'and a deadline that fires it');
  assert.ok(/err\.name === 'AbortError'/.test(EDITOR), 'a timeout must read as a timeout');
  assert.ok(/clearTimeout\(giveUp\)/.test(EDITOR), 'and be cleared when the answer arrives');
});


// ── The demo and the tour ──────────────────────────────────────────────────

test('the demo links to its OWN editor, not the Travel Offers one', () => {
  // The demo page was cloned from demo-offers.html and kept its editor link,
  // so "Open editor" took you to the wrong widget entirely.
  assert.ok(/href="\/editor-tti-offers"/.test(DEMO), 'the editor link must point at this widget');
  assert.ok(!/href="\/editor-offers"/.test(DEMO), 'the inherited Travel Offers link must be gone');
});

test('the demo mounts the shared engine and loads the rewritten script', () => {
  assert.ok(/widget-tti-offers\.js/.test(DEMO));
  assert.ok(/new window\.TGTtiOffersWidget\(/.test(DEMO));
  assert.ok(/ttiCodes:/.test(DEMO) && !/ctrlDest/.test(DEMO));
});

test('the tour points at the property list, not the retired destination input', () => {
  assert.ok(/#ttiRows/.test(TOUR));
  assert.ok(!/#destInput/.test(TOUR));
  assert.ok(/openSectionByTitle\('Your properties'\)/.test(TOUR));
  // Its own id, so dismissing one tour does not silently dismiss the other.
  assert.ok(/'tti-offers'/.test(TOUR) && !/tourLauncher\(\{ id: 'offers'/.test(TOUR));
});

/* ============================================================
   The pin probe: answering "why was my hotel not found?"
   ============================================================ */





/* ============================================================
   The real search criteria (worked example from Andy, 14 Sep 2026)
   ============================================================ */

const AT = { code: '58612582', lat: 50.71993, lng: -1.874885,
             locationName: 'Bournemouth, Dorset, United Kingdom', ctry: 'GB' };
const NOW = new Date('2026-09-14T10:00:00Z');
// CustomerIP is a property of the REQUEST, so every criteria fixture carries
// one. Travelify refuses a search without it.
const IP = { customerIp: '195.162.100.165' };

test('the criteria match the shape Travelify actually documented', () => {
  const b = buildAccommodationCriteria(AT, IP, NOW);
  assert.equal(b.SearchType, 'Accommodation');
  assert.equal(b.Environment, 'Website');
  assert.equal(b.DistanceUnit, 'Miles');
  assert.equal(b.TripType, 'Unspecified');
  const a = b.AccommodationSearchCriteria;
  assert.equal(a.Latitude, 50.71993);
  assert.equal(a.Longitude, -1.874885);
  assert.equal(a.LocationType, 'City');
  assert.equal(a.LocationCountry, 'GB');
  assert.equal(a.BoardBasis, 'Any');
  assert.equal(a.PropertyType, 'Any');
  assert.equal(a.RefundableOnly, false);
  assert.deepEqual(a.Rooms, [{ TypePreference: 'Any', Guests: [{ Type: 'Adult' }, { Type: 'Adult' }] }]);
});

test('Ref is the pin, and every spelling of a code produces the same one', () => {
  // The whole widget turns on this one field. The old path asked for a
  // country's worth of offers and sieved them, which could never find one
  // named hotel among the 250 cheapest in Great Britain.
  const ref = (code) => buildAccommodationCriteria({ ...AT, code }, IP, NOW)
    .AccommodationSearchCriteria.Ref;
  assert.equal(ref('58612582'), 'TTI:58612582');
  assert.equal(ref('TTI:58612582'), 'TTI:58612582');
  assert.equal(ref('ID:58612582'), 'TTI:58612582');
  assert.equal(ref(' tti:58612582 '), 'TTI:58612582');
});

test('a code and a country is a complete search on its own', () => {
  // Ref pins the property, so the property IS the location and the country
  // only says which part of the world. Coordinates were required here once,
  // on the strength of a 406 from a DEEPLINK carrying ctry and no coordinates
  // — a different surface from this API, and never tested against it. That
  // assumption made the editor ask for something it may not need.
  const a = buildAccommodationCriteria({ code: 'TTI:58612582', ctry: 'GB' }, IP, NOW)
    .AccommodationSearchCriteria;
  assert.equal(a.Ref, 'TTI:58612582');
  assert.equal(a.LocationCountry, 'GB');
  // Absent, not zeroed. 0,0 is a real place in the Atlantic.
  assert.equal('Latitude' in a, false);
  assert.equal('Longitude' in a, false);
  assert.equal('Radius' in a, false);
});

test('coordinates narrow the search when a row has them', () => {
  const a = buildAccommodationCriteria(AT, IP, NOW).AccommodationSearchCriteria;
  assert.equal(a.Latitude, 50.71993);
  assert.equal(a.Longitude, -1.874885);
  assert.equal(a.Radius, 11);
  assert.equal(a.LocationName, 'Bournemouth, Dorset, United Kingdom');
});

test('a search with no code and no area at all is refused', () => {
  // Somewhere to look is still required. An unscoped worldwide search is not
  // a broader question, it is a meaningless one.
  assert.equal(buildAccommodationCriteria({ ...AT, code: '' }, IP, NOW), null);
  assert.equal(buildAccommodationCriteria({ code: '58612582' }, IP, NOW), null);
  assert.equal(buildAccommodationCriteria(null, IP, NOW), null);
  // Out-of-range coordinates fall back to the country rather than being sent.
  const bad = buildAccommodationCriteria({ code: '58612582', ctry: 'GB', lat: 91, lng: 0 }, IP, NOW);
  assert.equal('Latitude' in bad.AccommodationSearchCriteria, false);
  assert.equal(bad.AccommodationSearchCriteria.LocationCountry, 'GB');
});

test('the stay is a month out and a week long, as the deeplinks already ask', () => {
  const a = buildAccommodationCriteria(AT, IP, NOW).AccommodationSearchCriteria;
  assert.equal(a.CheckinDate, '2026-10-14T00:00:00Z', '30 days from 14 Sep');
  assert.equal(a.CheckoutDate, '2026-10-21T00:00:00Z', 'seven nights later');
  // Both must be midnight UTC in the exact format the example uses.
  for (const d of [a.CheckinDate, a.CheckoutDate]) {
    assert.match(d, /^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
  }
});

test('the stay window is configurable and clamped to something sane', () => {
  const a = buildAccommodationCriteria(AT, { ...IP, ...{ leadDays: 90, nights: 3 } }, NOW).AccommodationSearchCriteria;
  assert.equal(a.CheckinDate, '2026-12-13T00:00:00Z');
  assert.equal(a.CheckoutDate, '2026-12-16T00:00:00Z');
  const silly = buildAccommodationCriteria(AT, { ...IP, ...{ leadDays: 9999, nights: 999 } }, NOW).AccommodationSearchCriteria;
  assert.ok(silly.CheckinDate < silly.CheckoutDate);
  assert.equal(buildAccommodationCriteria(AT, { ...IP, ...{ radius: 9999 } }, NOW).AccommodationSearchCriteria.Radius, 100);
});

test('occupancy carries children and infants with their ages', () => {
  const a = buildAccommodationCriteria(AT, { ...IP, ...{ adults: 2, childAges: [7, 1] } }, NOW).AccommodationSearchCriteria;
  assert.deepEqual(a.Rooms[0].Guests, [
    { Type: 'Adult' }, { Type: 'Adult' },
    { Type: 'Child', Age: 7 },
    { Type: 'Infant', Age: 1 },
  ]);
});

test('the verify gate reads whichever field the result carries the ref in', () => {
  // The booking API names this differently from the offers feed, and a gate
  // that silently matched nothing would empty every widget rather than fail.
  for (const shape of [
    { uniqueRef: 'TTI:58612582' },
    { accommodationUniqueRef: '58612582' },
    { Ref: 'ID:58612582' },
    { accommodation: { uniqueRef: 'TTI:58612582' } },
  ]) {
    assert.equal(resultIsProperty(shape, '58612582'), true, JSON.stringify(shape));
  }
  assert.equal(resultIsProperty({ uniqueRef: 'TTI:99999999' }, '58612582'), false);
  assert.equal(resultIsProperty({}, '58612582'), false);
  assert.equal(resultIsProperty({ uniqueRef: 'TTI:58612582' }, ''), false);
});

/* ============================================================
   The Test button, rebuilt on the booking API
   ============================================================ */

test('a deeplink fills in a whole hotel row', () => {
  // The agents already have working deeplinks. A working link carries every
  // field the criteria need, so pasting one cannot describe a search Travelify
  // would turn away — it came from one that works.
  const row = parseDeeplink('https://dl.tvllnk.com/deeplink/250?st=Accommodation'
    + '&loc=Bournemouth%2C+Dorset%2C+United+Kingdom&loct=City&ctry=GB'
    + '&lat=50.71993&lng=-1.874885&rad=18&refn=TTI%3A58612582&adt=2');
  assert.equal(row.code, '58612582');
  assert.equal(row.lat, 50.71993);
  assert.equal(row.lng, -1.874885);
  assert.equal(row.locationName, 'Bournemouth, Dorset, United Kingdom');
  assert.equal(row.ctry, 'GB');
  assert.equal(row.appId, '250');
  // Deeplinks carry km, the search criteria want miles.
  assert.equal(row.radius, 11, '18km is 11 miles, which is what the worked example uses');
  assert.ok(rowIsSearchable(row));
});

test('a deeplink without a property is not a hotel row', () => {
  for (const bad of ['', 'not a url', 'https://example.com/?refn=TTI:1',
                     'https://dl.tvllnk.com/deeplink/250?st=Accommodation&ctry=GB']) {
    assert.equal(parseDeeplink(bad), null, String(bad));
  }
});

test('a row is searchable with a country, with coordinates, or with both', () => {
  assert.equal(rowIsSearchable({ code: '58612582', ctry: 'GB' }), true);
  assert.equal(rowIsSearchable({ code: '58612582', lat: 50.7, lng: -1.87 }), true);
  assert.equal(rowIsSearchable({ code: '58612582' }), false, 'somewhere to look is still needed');
  assert.equal(rowIsSearchable({ ctry: 'GB' }), false, 'and so is a code');
});

test('the test endpoint runs the real search and never the old feed', () => {
  assert.ok(/from '\.\/_lib\/offers\/travelify-search\.js'/.test(TEST_API),
    'it must use the booking API client');
  assert.ok(/runSearch\(creds, job\.criteria/.test(TEST_API));
  // Match the CALL, not the word: the header comment explains why the feed
  // was abandoned, and an assertion that trips on its own documentation is a
  // bad assertion.
  assert.ok(!/^import .*refresh-map-offers/m.test(TEST_API),
    'the test endpoint must not import the offers-feed cron any more');
  assert.ok(!/callOffersProxy\(/.test(TEST_API),
    'the offers feed must not be called from the test endpoint');
  assert.ok(/pick: 'accommodationResults'/.test(TEST_API));
});

test('a successful test leaves a real cached offer behind', () => {
  // "It says it found something" and "the widget shows something" were two
  // different questions all week. The test collapses them into one.
  assert.ok(/setJson\(ttiKey\(creds\.appId, row\.code\)/.test(TEST_API));
  assert.ok(/offers, refreshedAt: new Date\(\)\.toISOString\(\)/.test(TEST_API));
  assert.ok(/offers:tti:\$\{appId\}:\$\{code\}/.test(TEST_API),
    'it must write the key api/cached-offers.js reads');
});

test('credentials are resolved server-side, never taken from the request', () => {
  // A client must never be able to test against another client's application:
  // the rates that come back are commercially theirs.
  assert.ok(/lookupClientCredentialsByRecordId|lookupClientCredentialsByEmail/.test(TEST_API));
  assert.ok(!/body\.appId|body\.apiKey/.test(TEST_API));
});

test('the test endpoint stays capped, authenticated and inside its route budget', () => {
  assert.ok(/requireAuth\(req\)/.test(TEST_API));
  assert.ok(/evaluatePublicRateLimit/.test(TEST_API));
  const max = Number(/MAX_CODES = (\d+)/.exec(TEST_API)[1]);
  assert.ok(max <= 10, 'one click must not become a bulk search');
  const deadline = Number(/DEADLINE_MS = (\d+)/.exec(TEST_API)[1]);
  const route = VERCEL.functions['api/tti-test.js'].maxDuration * 1000;
  assert.ok(deadline < route, `it stops starting work at ${deadline}ms, inside the ${route}ms route`);
});

test('a row without a location is refused rather than widened', () => {
  assert.ok(/status: 'incomplete'/.test(TEST_API));
  assert.ok(/if \(!criteria\)/.test(TEST_API), 'a null criteria must stop that row');
});

test('an offer with no price is never cached', () => {
  // The card would render a hotel with a blank price and a live booking link
  // behind it, which is worse than showing nothing. Price lives on `pricing`,
  // confirmed from a live result.
  assert.equal(normaliseAccommodationResult({ name: 'The Grand', uniqueRef: 'TTI:1' }), null);
  assert.equal(normaliseAccommodationResult({ name: 'The Grand', pricing: {} }), null);
  const ok = normaliseAccommodationResult({ name: 'The Grand', uniqueRef: 'TTI:1',
    pricing: { total: 420 } });
  assert.equal(ok.offer.price, 420);
});

test('the normaliser reports what it could not find', () => {
  // A cache quietly full of nulls looks identical to a supplier with thin
  // content, and sends the next person debugging the wrong thing. So a gap is
  // named rather than left silent.
  const thin = normaliseAccommodationResult({ pricing: { total: 420 } }, {});
  assert.ok(thin.unmapped.includes('hotel'), 'a nameless result must say so');
  assert.ok(thin.unmapped.includes('media'), 'and one with no photo');
  assert.ok(thin.unmapped.includes('nights'), 'and one with no stay length');
  // NOT url: the widget builds its own click-through, so a cached offer
  // without one is normal rather than broken.
  assert.ok(!thin.unmapped.includes('url'));
});

test('the editor asks for a code and a country, and takes coordinates as a bonus', () => {
  assert.ok(/function rowHasPlace/.test(EDITOR));
  assert.ok(/canonCtry\(r && r\.ctry\) \|\| rowHasCoords\(r\)/.test(EDITOR),
    'a country alone must make a row ready');
  assert.ok(/Add the country/.test(EDITOR), 'a row missing its country must say so');
  assert.ok(/function parseTtiDeeplink/.test(EDITOR), 'the paste box stays, as an optional extra');
  assert.ok(/Paste deeplinks \(optional\)/.test(EDITOR), 'and must read as optional');
  // Pasting a link for a hotel already typed in completes that row rather than
  // adding a duplicate.
  assert.ok(/ttiRows\.find\(r => canonTti\(r\.code\) === parsed\.code\)/.test(EDITOR));
});

test('the editor and the server parse a deeplink the same way', () => {
  // A difference here shows up as a row the server rejects after the editor
  // accepted it, which is the worst place to find out.
  for (const src of [['editor', EDITOR], ['lib', TTI_LIB]]) {
    const [label, text] = src;
    assert.ok(/tvllnk/.test(text), `${label}: must only accept Travelify links`);
    assert.ok(/refn/.test(text), `${label}: must read the code from refn`);
    assert.ok(/0\.621371/.test(text), `${label}: must convert the radius from km to miles`);
    assert.ok(/lat/.test(text) && /lng/.test(text), `${label}: must read the coordinates`);
  }
});

test('editor pages are never served stale', () => {
  // 14 Sep 2026: a fix was merged, deployed and live, and Andy still saw the
  // old editor — so he reported a bug that no longer existed and we lost a
  // round trip to it. An editor that lies about its own version is worse than
  // a slow one, so it revalidates on every load. no-cache rather than
  // no-store: a 304 is allowed, so a 200KB page is not re-sent unchanged.
  const block = VERCEL.headers.find((h) => /editor/.test(h.source || ''));
  assert.ok(block, 'the editor pages must have a header block');
  const cc = block.headers.find((x) => x.key === 'Cache-Control');
  assert.ok(cc, 'editor pages must set Cache-Control');
  assert.match(cc.value, /no-cache/);
});

test('CustomerIP is required, and never invented', () => {
  // Travelify's own words, 14 Sep 2026: "You must specify the customer IP
  // address (IPv4 or IPv6 supported)". It feeds geo and fraud checks, so a
  // made-up address is worse than none — it would run the search in the wrong
  // market and quietly return the wrong prices.
  assert.equal(buildAccommodationCriteria({ code: '58612582', ctry: 'GB' }, {}, NOW), null,
    'no IP means no search, rather than a request sent to be refused');
  assert.equal(buildAccommodationCriteria({ code: '58612582', ctry: 'GB' },
    { customerIp: 'nonsense' }, NOW), null, 'and neither does a bogus one');
  const c = buildAccommodationCriteria({ code: '58612582', ctry: 'GB' },
    { customerIp: '195.162.100.165' }, NOW);
  assert.equal(c.CustomerIP, '195.162.100.165');
});

test('an IP address is validated, not just passed through', () => {
  assert.equal(cleanIp('195.162.100.165'), '195.162.100.165');
  // Vercel hands back the mapped form behind a proxy, and it has to survive.
  assert.equal(cleanIp('::ffff:195.162.100.165'), '195.162.100.165');
  assert.equal(cleanIp('2a00:1450:4009:81f::200e'), '2a00:1450:4009:81f::200e');
  for (const bad of ['', null, undefined, 'unknown', '999.1.1.1', '1.2.3',
                     '::ffff:999.1.1.1', 'not an ip', '1.2.3.4.5']) {
    assert.equal(cleanIp(bad), '', `${bad} must not pass as an address`);
  }
});

test('the test endpoint uses the agent\'s real address', () => {
  assert.ok(/x-forwarded-for/.test(TEST_API), 'it must read the caller address');
  assert.ok(/customerIp,/.test(TEST_API), 'and pass it into the criteria');
  // If it cannot read one it says so, rather than sending a search it knows
  // will be refused or, worse, making an address up.
  assert.ok(/could not read your IP address/.test(TEST_API));
  assert.ok(!/CustomerIP: '\d/.test(TTI_LIB), 'no hardcoded address anywhere');
});

/* ============================================================
   A TTI widget must never widen to the destination pool
   ============================================================ */

test('a TTI widget is recognisable when its code list is EMPTY', () => {
  // The failure this prevents: with no codes, a TTI widget looked exactly like
  // a plain Offers widget, so it drew a country's worth of offers under a
  // heading promising a handful of chosen hotels. Andy, 14 Sep 2026: "it is
  // showing lots of random offers".
  assert.ok(/function isTtiWidget/.test(WIDGET));
  assert.ok(/hasOwnProperty\.call\(cfg, 'ttiCodes'\)/.test(WIDGET),
    'the config key alone must identify a TTI widget, empty list or not');
  assert.ok(/data-tg-widget'\) === 'tti-offers'/.test(WIDGET),
    'and so must the element tag');
  assert.ok(/this\._isTti = isTtiWidget\(config, container\)/.test(WIDGET),
    'decided once in the constructor, while the element is still to hand');
});

test('no codes means an empty widget, never a country', () => {
  assert.ok(/if \(this\._isTti && !ttiCodesOf\(this\.cfg\)\.length\)/.test(WIDGET),
    'the fetch must be skipped entirely');
  // And the query builder refuses too, so a template preset leaving
  // destinations behind cannot reach the cache by another route.
  assert.ok(/} else if \(!this\._isTti && Array\.isArray\(payload\.destinations\)/.test(WIDGET));
});

test('the editor previews against the client own App ID, not the demo one', () => {
  // This cache is keyed by App ID. The plain Offers editor hardcodes the demo
  // application harmlessly, because that cache is keyed by country; copied
  // here it pointed every client's preview at the demo pool, so codes that had
  // just been cached still previewed as empty.
  assert.ok(/\/api\/tti-appid/.test(EDITOR), 'the editor must ask for its own App ID');
  assert.ok(/appIdForPreview\(\)/.test(EDITOR));
  assert.ok(!/cfg\.appId = TG_TRAVELIFY_DEMO_APPID/.test(EDITOR),
    'the demo App ID must not be assigned directly');
  assert.ok(/data-tg-widget', 'tti-offers'/.test(EDITOR),
    'the preview element must claim the tti-offers tag');
});

test('the App ID endpoint returns the App ID and never the key', () => {
  const src = readFileSync(new URL('../api/tti-appid.js', import.meta.url), 'utf8');
  assert.ok(/requireAuth\(req\)/.test(src), 'it must be authenticated');
  assert.ok(/appId: creds && creds\.appId/.test(src));
  assert.ok(!/apiKey/.test(src), 'the API key must never leave the server');
  assert.ok(/Cache-Control', 'no-store'/.test(src),
    'credentials can be connected mid-session, so a stale miss must not stick');
});

test('the editor exposes how prices are shown', () => {
  // The engine has supported priceDisplay all along; this editor simply never
  // offered the control, so every TTI widget was stuck on auto.
  assert.ok(/id="cfgPriceDisplay"/.test(EDITOR));
  for (const mode of ['auto', 'total', 'perPerson', 'perNight', 'perPersonPerNight']) {
    assert.ok(new RegExp('value="' + mode + '"').test(EDITOR), `missing the ${mode} option`);
    assert.ok(new RegExp("'" + mode + "'", 'i').test(WIDGET) || new RegExp(mode.toLowerCase()).test(WIDGET),
      `the engine must understand ${mode}`);
  }
  assert.ok(/cfgPriceDisplay: 'priceDisplay'/.test(EDITOR), 'and it must be wired to the config');
  assert.ok(/priceDisplay: 'auto'/.test(EDITOR), 'with a default');
});

/* ============================================================
   The real result shape (confirmed from a live search, 14 Sep 2026)
   ============================================================ */

const LIVE = {
  rid: 42, resultType: 'Bookable', isAvailable: true, uniqueRef: 'TTI:58612582',
  name: 'The Grand', rating: 4, propertyType: 'Hotel', chain: 'Independent',
  pricing: { total: 640, perPerson: 320, currency: 'GBP' },
  location: { name: 'Bournemouth', countryCode: 'GB', latitude: 50.72, longitude: -1.87 },
  media: [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }, { url: 'https://x/3.jpg' }],
  units: [{ boardBasis: 'BedAndBreakfast', nights: 7, checkinDate: '2026-10-14T00:00:00Z' }],
};

test('images come from media, which is where they actually are', () => {
  // The first version guessed image/images/thumbnail and found none of them,
  // so every card rendered without a photo while every hotel had several.
  const { offer, unmapped } = normaliseAccommodationResult(LIVE, {});
  assert.equal(offer.image, 'https://x/1.jpg');
  assert.deepEqual(offer.images, ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg']);
  assert.ok(!unmapped.includes('media'));
});

test('a single photo costs no gallery, and no photos is reported', () => {
  // The cache key has a size ceiling, so a one-photo hotel must not carry a
  // one-item array as well.
  const one = normaliseAccommodationResult({ ...LIVE, media: [{ url: 'https://x/1.jpg' }] }, {});
  assert.equal(one.offer.image, 'https://x/1.jpg');
  assert.equal(one.offer.images, undefined);
  const none = normaliseAccommodationResult({ ...LIVE, media: [] }, {});
  assert.equal(none.offer.image, null);
  assert.ok(none.unmapped.includes('media'), 'a hotel with no photo must say so, not look fine');
});

test('the whole live result maps with nothing left over', () => {
  const { offer, unmapped } = normaliseAccommodationResult(LIVE, { deeplinkUrl: 'https://dl.tvllnk.com/x' });
  assert.equal(offer.hotel, 'The Grand');
  assert.equal(offer.resort, 'Bournemouth');
  assert.equal(offer.countryCode, 'GB');
  assert.equal(offer.price, 640);
  assert.equal(offer.pricePP, 320);
  assert.equal(offer.rating, 4);
  assert.equal(offer.boardBasis, 'BedAndBreakfast', 'the stay details sit on units[0]');
  assert.equal(offer.nights, 7);
  assert.equal(offer.checkinDate, '2026-10-14T00:00:00Z');
  assert.equal(offer.accommodationUniqueRef, 'TTI:58612582');
  assert.equal(offer.rid, '42');
  assert.equal(offer.resultType, 'Bookable');
  assert.deepEqual(unmapped, [], 'a complete result must report no gaps');
});

test('an unavailable result is never cached', () => {
  // Caching one puts a price and a booking link on a card that cannot be
  // booked, and the visitor finds that out at the payment page. It is the
  // worst failure this widget has, so it is refused at the parser.
  assert.equal(normaliseAccommodationResult({ ...LIVE, isAvailable: false }, {}), null);
  // isAvailable absent is not the same as false — an older shape must still map.
  const { isAvailable, ...noFlag } = LIVE;
  assert.ok(normaliseAccommodationResult(noFlag, {}).offer);
});

test('a session url is carried when there is one, and not required', () => {
  const withUrl = normaliseAccommodationResult(LIVE, { deeplinkUrl: 'https://dl.tvllnk.com/x' });
  assert.equal(withUrl.offer.url, 'https://dl.tvllnk.com/x');
  const without = normaliseAccommodationResult(LIVE, {});
  assert.equal(without.offer.url, null);
  // The widget builds its own click-through from the property reference and
  // the coordinates, so this is a bonus rather than a requirement.
  assert.ok(!without.unmapped.includes('url'));
  assert.ok(/r\.data && \(r\.data\.deeplinkUrl \|\| r\.data\.shareUrl\)/.test(TEST_API),
    'the test endpoint must still pass one through when the API gives one');
});

/* ============================================================
   The cached type must match the type the widget asks for
   ============================================================ */

test('a hotel search is cached as Accommodation, whatever the widget is set to', () => {
  // The empty-preview bug of 14 Sep 2026. buildAccommodationCriteria only ever
  // sends SearchType Accommodation, but the result was labelled from the
  // WIDGET's configured type — so a widget set to dynamic packaging cached a
  // hotel-only offer as 'Packages'. api/cached-offers.js filters on exactly
  // that field, so the widget asked for DynamicPackages, the cache held
  // Accommodation, and the preview came back empty with a full cache behind it.
  const r = { isAvailable: true, name: 'Hilton Bournemouth', pricing: { total: 756 },
              location: { name: 'Bournemouth' }, units: [{ nights: 7 }] };
  assert.equal(normaliseAccommodationResult(r, { type: 'DynamicPackages' }).offer.type, 'Accommodation');
  assert.equal(normaliseAccommodationResult(r, {}).offer.type, 'Accommodation');
});

test('the widget asks the cache for the type the sweep actually writes', () => {
  // The four places that must agree on one answer, or a full cache reads as an
  // empty one: what the sweep STORES, what the widget ASKS FOR, what the
  // editor's preview strip counts, and what its read-back check reads.
  //
  // They have now drifted three times. The third was the read-back, which kept
  // `type: 'Accommodation'` and so reported "the cache write did not land"
  // about a write that had landed perfectly (Andy, 14 Sep 2026). This test used
  // to check that ONE call site agreed, which is not the invariant.
  for (const t of ["'Packages'", "'Accommodation'"]) {
    assert.ok(TTI_SRC.includes(t), `the sweep must be able to store ${t}`);
  }
  assert.ok(/packageType: 'DynamicPackages'/.test(TTI_SRC),
    "a 'Packages' offer with no packageType reads as an operator package");

  // The editor states the rule once and uses it everywhere.
  const editorScript = EDITOR.slice(EDITOR.indexOf('<script src="/editor-shell.js"'));
  const decl = /const isPackageConfig = \(cfg\) =>([^;]+);/.exec(editorScript);
  assert.ok(decl, 'the editor must define the rule in one place');
  // eslint-disable-next-line no-new-func
  const isPackageConfig = new Function('cfg', `return ${decl[1]};`);
  assert.equal(isPackageConfig({ type: 'DynamicPackages' }), true);
  assert.equal(isPackageConfig({ type: 'Packages' }), true, "a legacy 'Packages' config is a package");
  assert.equal(isPackageConfig({ type: 'Accommodation' }), false);
  assert.equal(isPackageConfig({}), false, 'and no type at all is the hotel on its own');
  assert.equal(isPackageConfig(null), false);

  // EVERY use, not just one: the rows' Fly into box, the preview strip and the
  // read-back. Three call sites plus the declaration.
  assert.ok((editorScript.match(/isPackageConfig\(/g) || []).length >= 3,
    'the rows, the preview strip and the read-back must all use the shared rule');
  assert.ok(!/type: 'Accommodation' \}/.test(editorScript),
    'no call site may hard-code the type it asks the cache for');
});
test('the coordinates are stored under the names the cache read rebuilds from', () => {
  // api/cached-offers.js builds accommodation.destination from resortLat and
  // resortLng, and the widget's own deeplink builder needs that destination to
  // pin the property on a click. Without them every card fell back to '#'.
  const r = { isAvailable: true, name: 'Hilton Bournemouth', pricing: { total: 756 },
              location: { name: 'Bournemouth', latitude: 50.72, longitude: -1.87 },
              units: [{ nights: 7 }] };
  const { offer } = normaliseAccommodationResult(r, {});
  assert.equal(offer.resortLat, 50.72);
  assert.equal(offer.resortLng, -1.87);
  assert.equal(offer.lat, 50.72, 'and the plain names stay, for the map widget');
});

test('a missing booking url is not reported as a fault', () => {
  // The widget builds its own click-through from the property reference and
  // the coordinates, so a cached offer without a url is normal. Reporting it
  // sent Andy looking for a field that was never needed.
  // Complete now includes a board basis: a card without one looks like a hotel
  // that has no board, which is not a thing, so it is reported like any other
  // gap. The point of THIS test is that a missing `url` is not a gap.
  const r = { isAvailable: true, name: 'Hilton Bournemouth', pricing: { total: 756 },
              location: { name: 'Bournemouth' },
              units: [{ nights: 7, boardBasis: 'BedAndBreakfast' }],
              media: [{ url: 'https://x/1.jpg' }] };
  const { offer, unmapped } = normaliseAccommodationResult(r, {});
  assert.equal(offer.url, null);
  assert.deepEqual(unmapped, [], 'a complete offer with no url must report nothing');
});

test('a hotel with no photos still produces a renderable offer', () => {
  // Andy, 14 Sep 2026: "There are no images returned, but the offer should
  // render anyway". A card with no photo is a card, not a failure.
  const r = { isAvailable: true, name: 'Hilton Bournemouth', pricing: { total: 756 },
              location: { name: 'Bournemouth' }, units: [{ nights: 7 }], media: [] };
  const { offer, unmapped } = normaliseAccommodationResult(r, {});
  assert.ok(offer, 'it must still be an offer');
  assert.equal(offer.image, null);
  assert.equal(offer.hotel, 'Hilton Bournemouth');
  assert.equal(offer.price, 756);
  assert.ok(unmapped.includes('media'), 'and it must say the photo is genuinely absent');
  // The renderer must not depend on an image existing.
  assert.ok(/cssBgUrl\(img\)/.test(WIDGET));
  assert.ok(/if \(!url\) return '';/.test(WIDGET), 'no url means no background, not a broken card');
});

test('the test panel says whether the WIDGET can see what was cached', () => {
  // "We cached it" and "the widget can see it" are two different claims, and
  // the gap between them cost several rounds on 14 Sep 2026: a cache full of
  // offers the widget filters straight back out looks identical to an empty
  // cache, and the panel could only say "cached", which was true and useless.
  assert.ok(/async function readBackCheck/.test(EDITOR));
  assert.ok(/if \(d\.found\) readBackCheck\(out\)/.test(EDITOR), 'it must run after a successful test');
  // It asks TWICE: once unfiltered, once with the widget's own filters, so the
  // answer separates "not in the pool" from "filtered out of view".
  assert.ok(/const \[pooled, visible\] = await Promise\.all/.test(EDITOR));
  assert.ok(/Nothing is in the pool for these codes/.test(EDITOR));
  assert.ok(/widget can see none of them/.test(EDITOR));
  // And it NAMES the filters, so they can be turned off rather than guessed at.
  for (const f of ['board basis', 'star rating', 'minimum nights', 'latest date']) {
    assert.ok(EDITOR.includes(f), `the excluded-by filter list is missing ${f}`);
  }
});

/* ============================================================
   The config must survive the widget's own defaults
   ============================================================ */

test('_defaults carries ttiCodes through, or the widget forgets its hotels', () => {
  // THE ROOT CAUSE of both symptoms reported on 14 Sep 2026. _defaults is a
  // WHITELIST — it rebuilds the config from named keys — and ttiCodes was not
  // one of them. So this.cfg.ttiCodes was undefined however many hotels the
  // config carried, and everything downstream reads it off this.cfg.
  //
  // With no codes the query fell through to the destination branch and drew
  // "lots of random offers"; once that fallback was closed off it drew nothing
  // at all. Two different-looking bugs, one missing line.
  const body = WIDGET.slice(WIDGET.indexOf('_defaults(c) {'));
  const defaults = body.slice(0, body.indexOf('\n    }'));
  assert.ok(/ttiCodes:/.test(defaults),
    '_defaults must name ttiCodes, because it discards every key it does not');
  // A string list is a legitimate shape too — ttiCodesOf splits it.
  assert.ok(/Array\.isArray\(c\.ttiCodes\) \|\| typeof c\.ttiCodes === 'string'/.test(defaults));
});

test('every key the TTI path reads is one _defaults keeps', () => {
  // Guards the same class of bug for the rest of the path rather than just the
  // one instance that bit us.
  const body = WIDGET.slice(WIDGET.indexOf('_defaults(c) {'));
  const defaults = body.slice(0, body.indexOf('\n    }'));
  for (const key of ['ttiCodes', 'appId', 'type', 'destinations', 'supplierFilter']) {
    assert.ok(new RegExp('\\b' + key + ':').test(defaults), `_defaults drops ${key}`);
  }
});

test('cached offers carry a stable id, so a multi-hotel widget is not one card', () => {
  // api/cached-offers.js dedupes on `id|origin|type`. With no id every offer
  // keys identically and all but the first are discarded, which would collapse
  // a twelve-hotel widget to a single card.
  const mk = (ref, rid) => normaliseAccommodationResult({
    isAvailable: true, uniqueRef: ref, rid, name: 'H', pricing: { total: 100 },
    location: { name: 'X' }, units: [{ nights: 7, checkinDate: '2026-10-14T00:00:00Z' }],
  }, {}).offer;
  const a = mk('TTI:111', 1);
  const b = mk('TTI:222', 2);
  assert.ok(a.id && b.id, 'both must have an id');
  assert.notEqual(a.id, b.id, 'two different properties must not dedupe into one');
  // The same property at two prices in one search must stay distinct too.
  assert.notEqual(mk('TTI:111', 1).id, mk('TTI:111', 2).id);
});

/* ============================================================
   Dynamic packaging is not built, and says so
   ============================================================ */

test('a package is a different search, not a label on the hotel one', () => {
  // Andy selected DP and got hotel-only details under a package heading
  // (14 Sep 2026), because only the accommodation criteria were ever built.
  const c = buildDynamicPackageCriteria({ code: 'TTI:58612582', ctry: 'GB' },
    { customerIp: '195.162.100.165', origins: ['LGW'], destination: 'BOH' }, NOW);
  assert.equal(c.SearchType, 'DynamicPackaging');
  assert.ok(c.FlightSearchCriteria, 'the flight half must be sent');
  assert.ok(c.AccommodationSearchCriteria, 'alongside the hotel half');
  // The hotel half is IDENTICAL to a plain accommodation search: same pin,
  // same area, same dates. Only the flight is new.
  const a = buildAccommodationCriteria({ code: 'TTI:58612582', ctry: 'GB' },
    { customerIp: '195.162.100.165' }, NOW);
  assert.deepEqual(c.AccommodationSearchCriteria, a.AccommodationSearchCriteria);
});

test('the flight is a journey of legs, which is what Travelify asked for', () => {
  // The first attempt sent a flat Origins/DepartDate/ReturnDate lifted from
  // the deeplink, and the service answered by name (Andy, 14 Sep 2026):
  //   "FlightSearchCriteria - Legs: You must specify at least one flight leg;
  //    FlightSearchCriteria - Passengers: You must specify at least one passenger"
  const c = buildDynamicPackageCriteria({ code: 'TTI:1', ctry: 'GB' },
    { customerIp: '1.2.3.4', origins: ['LGW'], destination: 'BOH', adults: 2 }, NOW);
  const f = c.FlightSearchCriteria;
  assert.ok(Array.isArray(f.Legs) && f.Legs.length >= 1, 'at least one flight leg');
  assert.ok(Array.isArray(f.Passengers) && f.Passengers.length >= 1, 'at least one passenger');
  assert.ok(!('Origins' in f), 'the flat shape the API rejected must be gone');
  assert.equal(f.Legs[0].DestinationCode, 'BOH', 'a real airport, never a country code');
  assert.ok(!('DepartDate' in f) && !('ReturnDate' in f));
  assert.equal(f.DirectOnly, false, 'dir=false on the deeplink');

  // Out on the check-in, back on the check-out. Different dates would price a
  // package nobody asked for: a flight that lands after the room is given up.
  assert.equal(f.Legs.length, 2, 'a return trip is two legs');
  assert.equal(f.Legs[0].OriginCode, 'LGW');
  assert.equal(f.Legs[0].DepartDate, c.AccommodationSearchCriteria.CheckinDate);
  assert.equal(f.Legs[1].DestinationCode, 'LGW', 'and home again');
  assert.equal(f.Legs[1].DepartDate, c.AccommodationSearchCriteria.CheckoutDate);

  // THE FIELD NAMES ARE MEASURED. The round before this sent every plausible
  // spelling at once; Travelify then validated exactly two by name
  // (Legs[0].DestinationCode, Legs[1].OriginCode), which is the service saying
  // which it reads. The guesses are deleted, and must stay deleted.
  for (const [i, leg] of f.Legs.entries()) {
    assert.deepEqual(Object.keys(leg).sort(), ['DepartDate', 'DestinationCode', 'OriginCode'],
      `leg ${i}: only the field names Travelify has quoted back at us`);
  }

  // The party on the plane is the party in the room. Two adults in the hotel
  // and one on the flight is a price for a holiday nobody booked.
  assert.equal(f.Passengers.length, c.AccommodationSearchCriteria.Rooms[0].Guests.length);
  assert.deepEqual(f.Passengers, [{ Type: 'Adult' }, { Type: 'Adult' }]);
});

test('one departure airport per search, because a leg carries one origin', () => {
  // Several airports is several QUESTIONS. Sending only the first while the
  // agent picked three would quote a price from an airport nobody asked about.
  const c = buildDynamicPackageCriteria({ code: 'TTI:1', ctry: 'GB' },
    { customerIp: '1.2.3.4', origins: ['ABZ', 'GLA', 'EDI'], destination: 'BOH' }, NOW);
  assert.equal(c.FlightSearchCriteria.Legs[0].OriginCode, 'ABZ');
  assert.equal(c.FlightSearchCriteria.Legs.length, 2, 'two legs, not one per airport');

  // An explicit origin wins over the list, which is how the caller walks it.
  const g = buildDynamicPackageCriteria({ code: 'TTI:1', ctry: 'GB' },
    { customerIp: '1.2.3.4', origins: ['ABZ', 'GLA', 'EDI'], origin: 'GLA', destination: 'BOH' }, NOW);
  assert.equal(g.FlightSearchCriteria.Legs[0].OriginCode, 'GLA');

  // And the caller is given the list to walk, cleaned, deduped and capped:
  // every airport is a search, and a nightly sweep pays for each one.
  assert.deepEqual(dpOrigins({ origins: [' abz ', 'GLA', 'abz', 'nope', 'EDI', 'LGW'] }), ['ABZ', 'GLA', 'EDI']);
  assert.deepEqual(dpOrigins({ origins: ['ABZ', 'GLA'] }, 1), ['ABZ']);
  assert.deepEqual(dpOrigins({}), []);
});

test('a package is stored AS a package, in the fields the product already uses', () => {
  // Not a bespoke shape. These three fields are what the whole read path is
  // built on, and using them is what makes the card draw a flight without a
  // line of new template code. The first attempt invented departureAirport and
  // includesFlights on an 'Accommodation' offer, which nothing downstream could
  // recognise as a package.
  const r = { name: 'H', isAvailable: true, uniqueRef: 'TTI:1', rid: 9,
    pricing: { total: 861, currency: 'GBP' }, media: [], location: {},
    units: [{ nights: 7, checkinDate: '2026-10-14T00:00:00Z' }] };

  const dp = normaliseAccommodationResult(r, { origin: 'ABZ' }).offer;
  assert.equal(dp.type, 'Packages', 'the family cached-offers filters on');
  assert.equal(dp.packageType, 'DynamicPackages', 'what packageKindOf reads');
  assert.equal(dp.origin, 'ABZ', 'what hasFlight and flight.origin.iataCode read');
  assert.ok(!('departureAirport' in dp), 'no second name for the same thing');
  assert.ok(!('includesFlights' in dp), 'implied by the type, not restated');

  // A hotel on its own claims none of it.
  const hotel = normaliseAccommodationResult(r, {}).offer;
  assert.equal(hotel.type, 'Accommodation');
  assert.ok(!('packageType' in hotel));
  assert.ok(!('origin' in hotel));
});

test('a stored package satisfies the read side that has to find it', () => {
  // The exact predicates in api/cached-offers.js, applied to a real stored
  // offer. These two files disagreeing is what hid a full cache behind an
  // empty preview, and a test that only checks the writer cannot catch it.
  const dp = normaliseAccommodationResult(
    { name: 'H', isAvailable: true, uniqueRef: 'TTI:1', rid: 9,
      pricing: { total: 861, currency: 'GBP' }, media: [], location: {},
      units: [{ nights: 7, checkinDate: '2026-10-14T00:00:00Z' }] },
    { origin: 'ABZ' },
  ).offer;

  // typePredicate('DynamicPackages')
  assert.ok((dp.type || 'Packages') === 'Packages' && dp.packageType === 'DynamicPackages');
  // hasFlight — the gate that decides whether a flight block is built at all
  assert.ok(!!(dp.origin || dp.airport || dp.carrier || dp.outboundDate),
    'without this there is no flight on the card');

  // And the reader must actually carry those fields, rather than having been
  // written to read something else.
  assert.ok(/const hasFlight = !!\(o\.origin/.test(CACHED));
  assert.ok(/origin: o\.origin \? \{ iataCode: o\.origin/.test(CACHED));
  assert.ok(/packageKindOf\(o\) === 'DynamicPackages'/.test(CACHED));
});

test('the widget asks for the type it was configured as, not a hard-coded one', () => {
  // Hard-coding 'Accommodation' was the patch for a write-side fault: the
  // sweep stored packages under the wrong type. The write side is fixed, so
  // the read side must stop lying about what it wants or a DP widget can
  // never see a DP offer.
  const branch = WIDGET.slice(WIDGET.indexOf("q.set('tti', ttiCodes.join(','))"));
  assert.ok(/String\(this\.cfg\.type \|\| 'Accommodation'\) !== 'Accommodation'/.test(branch.slice(0, 2000)),
    'the TTI branch must derive the type from the config');
  assert.ok(!/q\.set\('type', 'Accommodation'\)/.test(branch.slice(0, 2000)),
    'and never pin it to one value');
});

test('one card per hotel is the dedupe that already exists, not a second one', () => {
  // Three airports cache three offers for one hotel. The platform has folded
  // that since long before TTI: strategy 'hotel' groups on name + country,
  // keeps the cheapest, and counts the rest into the "+N more" affordance.
  // A bespoke fold alongside it was dead code written against the stored
  // shape rather than the wire shape, so it silently did nothing.
  assert.ok(!/foldTtiByProperty/.test(WIDGET), 'the duplicate must be gone');
  assert.ok(/dedupeStrategy: c\.dedupeStrategy \|\| 'hotel'/.test(WIDGET),
    'and the default that does the job must still be the default');
  assert.ok(/case 'hotel': return hotelKey/.test(WIDGET));
  assert.ok(/_variantCount/.test(WIDGET), 'with the count the card shows');
});

test('a package with no departure airport is refused, not downgraded', () => {
  // Falling back to a hotel search is exactly the mislabelling this replaces.
  assert.equal(buildDynamicPackageCriteria({ code: 'TTI:1', ctry: 'GB' },
    { customerIp: '1.2.3.4' }, NOW), null);
  assert.equal(buildDynamicPackageCriteria({ code: 'TTI:1', ctry: 'GB' },
    { customerIp: '1.2.3.4', origins: ['nonsense'] }, NOW), null);
  assert.ok(/dp_needs_origin/.test(TEST_API), 'and the endpoint must say which is missing');
});

test('the test endpoint runs the package search for a package widget', () => {
  assert.ok(/const isDp = String\(body\.type \|\| 'Accommodation'\) !== 'Accommodation'/.test(TEST_API),
    'the same package rule the widget and the editor use');
  assert.ok(/buildDynamicPackageCriteria\(row, \{ \.\.\.search, origin, destination: arrival\.code \}\)/.test(TEST_API),
    'one search per departure airport, into a resolved arrival airport');
  assert.ok(/const useOrigins = isDp \? dpOrigins\(search, MAX_ORIGINS\)/.test(TEST_API));
  assert.ok(!/dp_not_supported/.test(TEST_API), 'it is supported now');
  assert.ok(/<option value="DynamicPackages">/.test(EDITOR), 'and the option is selectable');
  assert.ok(/needs a departure airport/.test(EDITOR), 'with the real requirement stated');
});

test('the guided tour matches the editor it is describing', () => {
  // A tour that points at a control which has moved or gone is worse than no
  // tour: it breaks mid-walkthrough on a client's first run.
  const TOUR = readFileSync(new URL('../public/tour-tti-offers.js', import.meta.url), 'utf8');
  for (const id of [...TOUR.matchAll(/target: '#([A-Za-z0-9_-]+)'/g)].map((m) => m[1])) {
    assert.ok(EDITOR.includes('id="' + id + '"'), `the tour points at #${id}, which the editor does not have`);
  }
  for (const title of [...TOUR.matchAll(/openSectionByTitle\('([^']+)'\)/g)].map((m) => m[1])) {
    assert.ok(EDITOR.includes('data-section>' + title), `the tour opens "${title}", which is not a section`);
  }
  // And it must cover the two controls added today.
  assert.ok(/#ttiTest/.test(TOUR), 'the tour must show the Test button');
  assert.ok(/#cfgPriceDisplay/.test(TOUR), 'and how prices are shown');
});

test('no control is declared twice in the editor markup', () => {
  // A duplicated id means the second one is never read or written, so the
  // setting silently does nothing. One slipped in with the pricing control:
  // the select already existed and a second copy was added above it, so only
  // the first was ever wired.
  //
  // Scoped to the STATIC markup. The scripts below it build HTML in template
  // strings, and a function returning one of three mutually exclusive branches
  // legitimately names the same id in each.
  const markup = EDITOR.slice(0, EDITOR.indexOf('<script src="/editor-shell.js"'));
  assert.ok(markup.length > 1000, 'the markup boundary must be found');
  const ids = [...markup.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
  const seen = new Set(); const dupes = new Set();
  for (const id of ids) { if (seen.has(id)) dupes.add(id); seen.add(id); }
  assert.deepEqual([...dupes], [], `duplicated ids: ${[...dupes].join(', ')}`);
});

test('the poller counts the flights that came back with a package', () => {
  // "0 flights" and "this is a hotel-only price" look identical on a card, so
  // the number is measured rather than assumed.
  assert.ok(/also: 'flightResults'/.test(TEST_API), 'the test button must count them');
  assert.ok(/also: 'flightResults'/.test(CRON), 'and so must the sweep');
  assert.ok(/flightResults: acc\.flights/.test(TEST_API), 'and report the count back');
});

/* ============================================================
   The nightly sweep
   ============================================================ */

test('the cron runs the same search the Test button does', () => {
  // It was still asking widgetsvc/traveloffers for a country's worth of offers
  // and sieving them for one hotel — the query that never found Andy's
  // property. Since it writes the SAME cache keys the Test button writes, its
  // next run would have replaced a working offer with nothing.
  assert.ok(/from '\.\.\/_lib\/offers\/travelify-search\.js'/.test(CRON));
  assert.ok(/runSearch\(\{ appId: item\.appId, apiKey: item\.apiKey \}/.test(CRON));
  assert.ok(/buildAccommodationCriteria\(item, opts\)/.test(CRON));
  assert.ok(/buildDynamicPackageCriteria\(item, opts\)/.test(CRON));
  assert.ok(/normaliseAccommodationResult\(one/.test(CRON));
});

test('the cron carries the API key, not just the App ID', () => {
  // Token auth needs both. Caching only the App ID would have made every
  // search unauthenticated.
  assert.ok(/apiKey: creds\.apiKey/.test(CRON));
  assert.ok(/!\(creds && creds\.apiKey\)/.test(CRON), 'a client with no key must be skipped');
});

test('no customer address means NO SWEEP, and the cache is left alone', () => {
  // A cron has no visitor, so there is no address to take. Inventing one runs
  // the whole sweep in the wrong market and caches prices for the wrong place,
  // which looks exactly like working. Refusing leaves yesterday's real offers
  // in place, which is the safe direction.
  assert.ok(/const CUSTOMER_IP = cleanIp\(process\.env\.TTI_CUSTOMER_IP/.test(CRON));
  assert.ok(/if \(!CUSTOMER_IP\) \{/.test(CRON));
  assert.ok(/skipped: 'no-customer-ip'/.test(CRON));
  // And it must refuse before anything is SWEPT — compared against the call
  // site, not the helper's definition, which sits above the handler.
  const gate = CRON.indexOf("skipped: 'no-customer-ip'");
  const call = CRON.indexOf('await storeProperty(item');
  assert.ok(gate !== -1 && call !== -1 && gate < call,
    'the refusal must come before the sweep writes anything');
  assert.ok(!/CUSTOMER_IP = '\d/.test(CRON), 'no fabricated address anywhere');
});

test('the package options are declared before the search that reads them', () => {
  // Andy got "Unexpected token 'A', \"A server e\"..." — Vercel's plain-text
  // 500 page reaching a caller expecting JSON. The cause: the `search` object
  // read `origins` fourteen lines above `const origins = ...`. A const read
  // before its declaration is a ReferenceError, not undefined, so the whole
  // route threw. node --check does not catch it.
  //
  // This asserts the specific ordering rather than trying to detect the class:
  // a general use-before-define check needs scope analysis, which a regex
  // cannot do — several attempts here produced only false positives. That job
  // belongs to a linter rule (no-use-before-define), not to a bespoke scanner
  // that would cry wolf for whoever reads it next.
  const handler = TEST_API.slice(TEST_API.indexOf('export default async function handler'));
  const origins = handler.indexOf('const origins =');
  const search = handler.indexOf('const search = {');
  assert.ok(origins > 0 && search > 0, 'both declarations must be found');
  assert.ok(origins < search,
    'origins must be declared before the search object that reads it, or the route 500s');
  const isDp = handler.indexOf('const isDp =');
  assert.ok(isDp > 0 && isDp < search, 'and so must isDp');
});

/* ============================================================
   End to end: a stored package really does become a flight card
   ============================================================ */

test('a stored TTI package survives the wire shape as a real flight', () => {
  // THE CENTRAL CLAIM of the package fix, run rather than argued. The writer
  // sets type/packageType/origin; cached-offers.js reshapes that into what the
  // card actually reads. If those two ever disagree the card silently draws a
  // hotel, which is exactly the bug this replaced.
  //
  // toRawShape is not exported (it is an internal of the endpoint), so it is
  // lifted out and run with its one import stubbed.
  const at = CACHED.indexOf('function toRawShape(');
  assert.notEqual(at, -1);
  let depth = 0; let end = -1;
  for (let i = CACHED.indexOf('{', at); i < CACHED.length; i++) {
    if (CACHED[i] === '{') depth++;
    else if (CACHED[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1);
  // eslint-disable-next-line no-new-func
  const toRawShape = new Function('marketOfAirport', 'money',
    `${CACHED.slice(at, end)}; return toRawShape;`)(() => 'GB', (n) => `£${n}`);

  const result = { name: 'Hilton Bournemouth', isAvailable: true, uniqueRef: 'TTI:58612582',
    rid: 9, pricing: { total: 861, currency: 'GBP' }, media: [{ url: 'https://x/1.jpg' }],
    location: { name: 'Bournemouth', countryCode: 'GB', latitude: 50.72, longitude: -1.87 },
    units: [{ nights: 7, checkinDate: '2026-10-14T00:00:00Z', boardBasis: 'BedAndBreakfast' }] };

  const pkg = toRawShape(normaliseAccommodationResult(result, { origin: 'ABZ' }).offer);
  assert.equal(pkg.type, 'Packages', 'the card branches on this');
  assert.equal(pkg.packageType, 'DynamicPackages', 'getPackageType reads it for the badge');
  assert.ok(pkg.flight, 'THE POINT: a package must arrive with a flight block');
  assert.equal(pkg.flight.origin.iataCode, 'ABZ', 'and the card renders this as the from-airport');
  assert.ok(pkg.accommodation, 'with the hotel alongside it, as a package card expects');
  assert.equal(pkg.accommodation.name, 'Hilton Bournemouth');

  // A hotel-only offer must NOT grow a flight, or every plain TTI card would
  // claim a departure it does not have.
  const hotel = toRawShape(normaliseAccommodationResult(result, {}).offer);
  assert.equal(hotel.type, 'Accommodation');
  assert.ok(!hotel.flight, 'a hotel on its own has no flight');
  assert.ok(hotel.accommodation);
});

/* ============================================================
   Where a package flies into
   ============================================================ */

test('a country code is never sent as an airport, because it is not one', () => {
  // Travelify, 14 Sep 2026, by name:
  //   Legs[0] - DestinationCode: Unrecognised 3-letter airport/city code: GB
  // The fix is not to send a better country, it is to resolve a real airport.
  assert.equal(buildDynamicPackageCriteria({ code: 'TTI:1', ctry: 'GB' },
    { customerIp: '1.2.3.4', origin: 'ABZ', destination: 'GB' }, NOW), null,
    'a two-letter country must be refused, not passed through');
  assert.equal(buildDynamicPackageCriteria({ code: 'TTI:1', ctry: 'GB' },
    { customerIp: '1.2.3.4', origin: 'ABZ' }, NOW), null,
    'and no destination at all means no package, never a blind search');
});

test('a hotel flies into its OWN local airport, not a big one 95km away', () => {
  // Andy, 14 Sep 2026: "why is it choosing Bristol when there is an airport in
  // Bournemouth?" It was choosing Bristol because BOH was not a candidate at
  // all — the list with coordinates held 106 majors and the list with 3,242
  // airports held no coordinates. A gap in the data, not a judgement about the
  // airport, so the data was rebuilt.
  const boh = resolveArrivalAirport({ lat: 50.72, lng: -1.87, ctry: 'GB' });
  assert.equal(boh.code, 'BOH');
  assert.ok(boh.km <= 15, `BOH should be minutes from the hotel, got ${boh.km}km`);
  // And the big one is OFFERED, because a small airport has thin routes and
  // that is the likeliest reason a package comes back empty.
  assert.equal(boh.alt.code, 'BRS');
  assert.ok(boh.alt.km > boh.km);
});

test('a real hub beats a near-empty airport that happens to be closer', () => {
  // OurAirports classifies by runway and service, not passengers: Al Maktoum
  // is a "large airport" 18km from Dubai and Dubai International is 34km, so
  // raw distance picks the near-empty one. The curated majors carry the thing
  // OurAirports does not — which airports are real hubs.
  const dxb = resolveArrivalAirport({ lat: 25.049, lng: 55.118, ctry: 'AE' });
  assert.equal(dxb.code, 'DXB');
  assert.equal(dxb.source, 'nearest-hub');
  assert.equal(dxb.alt.code, 'DWC', 'and the closer one is still offered');

  // The bonus is bounded, or every hotel would fly into a capital: Bournemouth
  // keeps BOH because Bristol is far outside it.
  assert.ok(HUB_BONUS_KM > 0 && HUB_BONUS_KM <= 80);
  assert.equal(resolveArrivalAirport({ lat: 50.72, lng: -1.87, ctry: 'GB' }).code, 'BOH');
});

test('the arrival airport is resolved from what the row actually knows', () => {
  // Cheapest honest source first. None of these spends a search.
  assert.deepEqual(
    pick(resolveArrivalAirport({ dst: 'ae1', ctry: 'AE' })),
    { code: 'AE1', source: 'given' },
    'a pinned code or a deeplink dst wins outright, in Travelify own code space');

  // A property we have never placed still gets its country's MAIN airport.
  // Not its alphabetically-first one: the arrivals list is alphabetical inside
  // each size class, which made Aberdeen the hub for Great Britain until the
  // curated importance ordering was brought back for exactly this step.
  assert.deepEqual(
    pick(resolveArrivalAirport({ ctry: 'GB' })),
    { code: 'LHR', source: 'country-hub' });
  assert.deepEqual(
    pick(resolveArrivalAirport({ ctry: 'MT' })),
    { code: 'MLA', source: 'country-hub' });

  // And nothing at all is NULL, not a guess.
  assert.equal(resolveArrivalAirport({}), null);
  assert.equal(resolveArrivalAirport({ ctry: 'ZZ' }), null);
});

test('the arrivals list is whole, and has what the majors list has', () => {
  // A silently truncated or mis-parsed rebuild would send every package to the
  // wrong airport, which looks like a supplier problem rather than a data one.
  const list = arrivalAirports();
  assert.ok(list.length > 2000 && list.length < 5000, `suspicious size: ${list.length}`);
  const codes = new Set(list.map((a) => a[0]));
  for (const c of ['BOH', 'SOU', 'LHR', 'JFK', 'DXB', 'BRS']) assert.ok(codes.has(c), `missing ${c}`);
  // Every curated major must survive, or the hub logic loses its candidates.
  for (const m of majorAirports()) assert.ok(codes.has(m[0]), `arrivals list lost ${m[0]}`);
  // Coordinates are the whole reason this file exists.
  for (const a of list) {
    assert.ok(Number.isFinite(a[3]) && Math.abs(a[3]) <= 90, `${a[0]} latitude`);
    assert.ok(Number.isFinite(a[4]) && Math.abs(a[4]) <= 180, `${a[0]} longitude`);
  }
});
test('the country wins over raw distance, because a package must land in it', () => {
  // A hotel on the Côte d'Azur is closer to an Italian airport than to a
  // French one often enough to matter, and a package that lands in the wrong
  // country is wrong in a way a price cannot show.
  const nice = resolveArrivalAirport({ lat: 43.70, lng: 7.27, ctry: 'FR' });
  assert.equal(nice.code, 'NCE');
  assert.equal(arrivalAirports().find((a) => a[0] === nice.code)[2], 'FR');
  // Only a country with no major airport of its own falls through.
  const andorra = resolveArrivalAirport({ lat: 42.51, lng: 1.52, ctry: 'AD' });
  assert.equal(andorra.source, 'nearest-anywhere');
  assert.ok(andorra.code);
});

test('a pasted DP deeplink brings its own arrival airport', () => {
  // Andy's DP link carries dst=AE1, which is exactly what DestinationCode
  // wants. Re-deriving it when the link already said so would be worse.
  const p = parseDeeplink('https://dl.tvllnk.com/deeplink/250?st=DynamicPackaging'
    + '&refn=TTI:58612582&ctry=AE&dst=AE1&org=LGW&loc=Dubai&loct=City');
  assert.equal(p.dst, 'AE1');
  assert.equal(p.type, 'DynamicPackages');
  // An accommodation link has no dst and must not invent one.
  const a = parseDeeplink('https://dl.tvllnk.com/deeplink/250?st=Accommodation&refn=TTI:1&ctry=GB');
  assert.ok(!('dst' in a));
});

test('a pinned arrival airport survives the round trip to the sweep', () => {
  // The agent overriding our choice is the whole point of the box. Dropping it
  // on save would silently put the package back on whatever we resolved.
  const rows = codesFromConfig({ ttiCodes: [{ code: '58612582', ctry: 'GB', dst: 'boh' }] });
  assert.equal(rows[0].dst, 'BOH', 'and normalised on the way through');
  assert.ok(!('dst' in codesFromConfig({ ttiCodes: [{ code: '1', ctry: 'GB' }] })[0]));
  // Junk is dropped rather than sent upstream to be rejected.
  assert.ok(!('dst' in codesFromConfig({ ttiCodes: [{ code: '1', ctry: 'GB', dst: 'x' }] })[0]));

  assert.ok(/dst: p\.dst \|\| ''/.test(CRON), 'the sweep must carry it');
  assert.ok(/resolveArrivalAirport\(\{ dst: item\.dst/.test(CRON), 'and resolve from it');
  assert.ok(/\{ dst: String\(r\.dst\)/.test(EDITOR), 'and the editor must save it');
});

test('the test panel says which airport it chose, and why', () => {
  // "We chose Bristol for a hotel in Bournemouth" is a reasonable call an
  // agent should be able to see and correct, not discover from an odd price.
  assert.ok(/flyInto: \(arrivals\.get\(idx\) \|\| \{\}\)\.code/.test(TEST_API));
  assert.ok(/flyIntoWhy: \(arrivals\.get\(idx\) \|\| \{\}\)\.source/.test(TEST_API));
  assert.ok(/Flying into/.test(EDITOR));
  assert.ok(/Put an airport code in the Fly into box/.test(EDITOR),
    'and say how to override it');
  // Resolving must cost no search: it reads the cache this property already
  // filled, never a fresh lookup.
  assert.ok(/await getJson\(ttiKey\(creds\.appId, row\.code\)\)/.test(TEST_API));
});

test('the airport list actually ships with the functions that read it', () => {
  // A data file read through new URL(..., import.meta.url) is only bundled if
  // Vercel's tracer finds it, and this repo's convention is to say so
  // explicitly rather than rely on that. Without it resolveArrivalAirport
  // returns null in production, every package is refused, and it looks like a
  // supplier problem — the file loads fine in every local test, which is
  // exactly what makes this class of bug expensive.
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const fn of ['api/tti-test.js', 'api/cron/refresh-tti-offers.js']) {
    const cfg = vercel.functions[fn];
    assert.ok(cfg, `${fn} has no functions entry`);
    assert.ok(/api\/_data\/airports\*?\.json/.test(String(cfg.includeFiles || '')),
      `${fn} reads the airport lists and must bundle them`);
    // Both files, because each carries something the other does not:
    // coordinates for every airport, and which ones are real hubs.
    assert.ok(String(cfg.includeFiles).includes('*'),
      `${fn} must bundle airports.json AND airports-arrivals.json`);
  }
});

test('a package that cannot name an arrival airport is refused, not guessed', () => {
  // The safe direction if the list ever fails to load: no search, and a
  // message that tells the agent what to do. Never a search into nowhere, and
  // never a country code we already know it rejects.
  assert.ok(/if \(isDp && !arrival\)/.test(TEST_API));
  assert.ok(/could not work out which airport/.test(TEST_API));
  assert.ok(/list load failed/.test(
    readFileSync(new URL('../api/_lib/offers/arrival-airport.js', import.meta.url), 'utf8')),
  'and a missing list logs rather than throwing');
});

test('every leg field name is one Travelify has quoted back at us', () => {
  // THE RULE, and it was learned by breaking it. The alias round sent each
  // value under several spellings; the reply named Legs[0].DestinationCode and
  // Legs[1].OriginCode, so those two were confirmed. It said nothing about the
  // date — because one of the three date aliases was right and the field never
  // errored. Silence is not confirmation. Trimming the date to 'DepartureDate'
  // on house-style reasoning deleted the alias that was doing the work, and the
  // next round said so by name:
  //
  //   Legs[0] - DepartDate: Date must be set and not be in the past
  //
  // So the set below is exactly the three names the service has quoted. Adding
  // to it needs an error message naming the field, not an argument from style.
  const NAMED_BY_TRAVELIFY = ['DepartDate', 'DestinationCode', 'OriginCode'];
  const src = readFileSync(new URL('../api/_lib/offers/tti.js', import.meta.url), 'utf8');
  const leg = /const leg = \([^)]*\) => \(\{([^}]*)\}\)/.exec(src);
  assert.ok(leg, 'the leg builder must be findable');
  const fields = [...leg[1].matchAll(/(\w+):/g)].map((m) => m[1]).sort();
  assert.deepEqual(fields, NAMED_BY_TRAVELIFY,
    'a leg field the service has never named is a guess, however plausible');
});

test('a package never departs in the past, whatever the widget is set to', () => {
  // leadDays clamps to [0, 330], and 0 is today at 00:00 UTC — behind us for
  // all but the first instant of the day. A hotel takes that happily; Travelify
  // refuses the whole package for it, with the SAME message a misnamed field
  // produces, so the cause would be indistinguishable from the bug above.
  const now = new Date('2026-09-14T13:00:00Z');
  for (const leadDays of [0, 1, 30]) {
    const c = buildDynamicPackageCriteria({ code: 'TTI:1', ctry: 'GB' },
      { customerIp: '1.2.3.4', origin: 'GLA', destination: 'BOH', leadDays }, now);
    const legs = c.FlightSearchCriteria.Legs;
    assert.ok(new Date(legs[0].DepartDate) > now, `leadDays ${leadDays} departs in the past`);
    assert.ok(new Date(legs[1].DepartDate) > new Date(legs[0].DepartDate), 'and comes back after');
    // The room and the flight must agree, or the package prices a stay the
    // traveller cannot reach.
    assert.equal(legs[0].DepartDate, c.AccommodationSearchCriteria.CheckinDate);
    assert.equal(legs[1].DepartDate, c.AccommodationSearchCriteria.CheckoutDate);
  }
  assert.equal(MIN_DP_LEAD_DAYS, 1);

  // And a HOTEL on its own keeps same-day booking, which is a real thing to
  // sell. The floor belongs to the flight, not to the product.
  const hotel = buildAccommodationCriteria({ code: 'TTI:1', ctry: 'GB' },
    { customerIp: '1.2.3.4', leadDays: 0 }, now);
  assert.equal(hotel.AccommodationSearchCriteria.CheckinDate, '2026-09-14T00:00:00Z');
});

test('a row with no coordinates is not a hotel in the Atlantic', () => {
  // (0,0) is a real place in the Gulf of Guinea, and everything upstream turns
  // a missing coordinate into it: the editor sends lat: null because NaN does
  // not survive JSON, and Number(null) is 0 — finite, in range, and wrong.
  // A Bournemouth hotel therefore resolved to Newquay, 5,629km away, which is
  // exactly the distance from null island to Cornwall (Andy, 14 Sep 2026).
  assert.equal(cleanCoord(null, 90), null, 'cleanCoord has always rejected zero');
  assert.equal(cleanCoord(0, 90), null);
  assert.equal(cleanCoord('', 90), null);
  assert.equal(cleanCoord(50.72, 90), 50.72);

  // The resolver refuses it too, whoever calls it and however the zero arrived.
  assert.equal(resolveArrivalAirport({ lat: 0, lng: 0, ctry: 'GB' }).source, 'country-hub',
    'null island must fall back to the country, not pick the nearest airport to it');
  assert.equal(resolveArrivalAirport({ lat: 0, lng: 0 }), null);
  assert.equal(resolveArrivalAirport({ lat: 999, lng: 999, ctry: 'GB' }).source, 'country-hub');
  // And a real position still works.
  assert.equal(resolveArrivalAirport({ lat: 50.72, lng: -1.87, ctry: 'GB' }).code, 'BOH');

  // The test endpoint must clean coordinates rather than coerce them, which is
  // the one call site that was not doing it.
  assert.ok(/lat: cleanCoord\(row\.lat, 90\), lng: cleanCoord\(row\.lng, 180\)/.test(TEST_API));
  assert.ok(!/lat: Number\(row\.lat\)/.test(TEST_API), 'Number(null) is 0, and 0 is a place');
});

/* ============================================================
   What the card can actually say about a package
   ============================================================ */

/** Push a normalised offer through the endpoint's own reshaper, so these
 *  assertions are about what the CARD receives, not what we stored. */
function wireShape(offer) {
  const at = CACHED.indexOf('function toRawShape(');
  let depth = 0; let end = -1;
  for (let i = CACHED.indexOf('{', at); i < CACHED.length; i++) {
    if (CACHED[i] === '{') depth++;
    else if (CACHED[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  // eslint-disable-next-line no-new-func
  return new Function('marketOfAirport', 'money',
    `${CACHED.slice(at, end)}; return toRawShape;`)(() => 'GB', (n) => `£${n}`)(offer);
}

const PKG_RESULT = {
  name: 'Iberostar Heritage Grand Mencey', isAvailable: true, uniqueRef: 'TTI:9', rid: 3,
  rating: 5, chain: 'Iberostar Hotels & Resorts',
  pricing: { total: 857, currency: 'GBP' }, media: [{ url: 'https://x/1.jpg' }],
  location: { name: 'Santa Cruz', countryCode: 'ES', latitude: 28.46, longitude: -16.25 },
  units: [{ nights: 7, checkinDate: '2026-10-14T00:00:00Z', boardBasis: 'AllInclusive' }],
};

test('a package card can say who the price is for', () => {
  // The card prints paxString(o) and falls back to the bare word "Travellers"
  // when it cannot. Andy, 14 Sep 2026: "It doesnt say how many travellers it's
  // based on" — a total price for an unstated number of people.
  const wire = wireShape(normaliseAccommodationResult(PKG_RESULT,
    { origin: 'GLA', destination: 'TFS', adults: 2, children: 1, infants: 0 }).offer);
  assert.equal(wire.adults, 2);
  assert.equal(wire.children, 1);
  // cached-offers only forwards finite numbers, so zero must survive as zero
  // rather than being dropped and read as unknown.
  assert.equal(wire.infants, 0);
});

test('a package card can say where it flies from AND to', () => {
  // The flight line is `fromCode -> toCode` and is skipped ENTIRELY unless both
  // ends are known. The origin was being stored and the arrival was not, so the
  // whole line vanished and the card never said where it flew from at all.
  const wire = wireShape(normaliseAccommodationResult(PKG_RESULT,
    { origin: 'GLA', originName: 'Glasgow', destination: 'TFS', destinationName: 'Tenerife South',
      outboundDate: '2026-10-14T00:00:00Z', returnDate: '2026-10-21T00:00:00Z' }).offer);
  assert.ok(wire.flight, 'a package must arrive with a flight block');
  assert.equal(wire.flight.origin.iataCode, 'GLA');
  assert.equal(wire.flight.origin.name, 'Glasgow');
  assert.equal(wire.flight.destination.iataCode, 'TFS', 'both ends, or the card draws nothing');
  // The dates the card renders as "Departs ... Returns ...".
  assert.equal(wire.flight.outboundDate, '2026-10-14T00:00:00Z');
  assert.equal(wire.flight.returnDate, '2026-10-21T00:00:00Z');
});

test('a package card can say the board basis', () => {
  const wire = wireShape(normaliseAccommodationResult(PKG_RESULT, { origin: 'GLA', destination: 'TFS' }).offer);
  assert.equal(wire.accommodation.boardBasis, 'AllInclusive');

  // And when the supplier does not send one, it is REPORTED rather than
  // silently dropped — a card with no board reads as a hotel that has none.
  const noBoard = { ...PKG_RESULT, units: [{ nights: 7, checkinDate: '2026-10-14T00:00:00Z' }] };
  assert.ok(normaliseAccommodationResult(noBoard, {}).unmapped.includes('boardBasis'));
});

test('a hotel we cannot place is located before its package is priced', () => {
  // A country hub is a fair answer for a mainland hotel and a bad one for an
  // island: Santa Cruz de Tenerife resolves to MADRID on the country alone,
  // 1,700km from the bed. So an unplaced property gets one cheap accommodation
  // search first, purely to read its coordinates.
  assert.equal(resolveArrivalAirport({ ctry: 'ES' }).code, 'MAD', 'the country alone gives the capital');
  const placed = resolveArrivalAirport({ lat: 28.4636, lng: -16.2518, ctry: 'ES' });
  assert.equal(placed.code, 'TFS', 'knowing where it is gives the island');
  assert.equal(placed.alt.code, 'TFN', 'with the closer island airport offered');

  assert.ok(/for \(const idx of unplaced\.slice\(0, MAX_LOCATE\)\)/.test(TEST_API));
  assert.ok(/-located/.test(TEST_API), 'and the panel must say the answer was measured, not assumed');
  // Bounded: this spends a real search, so it is capped and deadline-checked.
  assert.ok(/const MAX_LOCATE = \d/.test(TEST_API));
  assert.ok(/if \(Date\.now\(\) - startedAt > DEADLINE_MS\) break;/.test(TEST_API));
});

test('the nightly sweep stores everything the Test button stores', () => {
  // A refresh that dropped any of these would quietly undo the cards the Test
  // button produced — the widget would look right tonight and wrong tomorrow.
  for (const field of ['adults:', 'children:', 'infants:', 'originName: airportLabel(origin)',
    'destination: item.arrival.code', 'outboundDate: legs[0].DepartDate', 'returnDate: legs[1].DepartDate']) {
    assert.ok(CRON.includes(field), `the sweep must carry ${field}`);
  }
});
