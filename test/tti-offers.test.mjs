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
} from '../api/_lib/offers/tti.js';

const WIDGET = readFileSync(new URL('../public/widget-offers.js', import.meta.url), 'utf8');
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

test('TTI Offers reads are attributed to their own widget type', () => {
  assert.ok(/servedWidgetType/.test(CACHED) && /'TTI Offers' : 'Travel Offers'/.test(CACHED));
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
  assert.ok(/replace\(\/\^TTI:\/, ''\)/.test(EDITOR));
});

test('the editor has no dead destination controls left behind', () => {
  assert.ok(!/destChips|destInput/.test(EDITOR), 'retired destination chips must be gone');
  assert.ok(!/cfgTtiCodes|ttiTextOf|ttiCodesOf/.test(EDITOR), 'the retired textarea helpers must be gone');
  assert.ok(/id="ttiRows"/.test(EDITOR), 'the property row list is missing');
});

test('a hotel is two fields, the code and the country', () => {
  // Andy, 14 Sep 2026. Nothing else is asked for: the code picks the hotel and
  // the country is the area the sweep searches before the pin narrows it.
  // The inputs are built in JS, not markup, so assert on what actually runs.
  assert.ok(/code\.placeholder = 'TTI code/.test(EDITOR), 'code input missing');
  assert.ok(/ctry\.className = 'input tti-ctry'/.test(EDITOR), 'country input missing');
  assert.ok(/ctry\.maxLength = 2/.test(EDITOR), 'the country field should hold two letters');
  assert.ok(/\.tti-row \{ display: grid; grid-template-columns: 1fr 84px 28px/.test(EDITOR),
    'both fields sit on one row');
});

test('only rows with BOTH a code and a country reach the saved config', () => {
  assert.ok(
    /if \(!code \|\| !ctry \|\| seen\[code\]\) continue;/.test(EDITOR),
    'a half-typed row must be held back from the save rather than saved broken',
  );
  assert.ok(/rows need/.test(EDITOR), 'the agent has to be told which rows are not ready');
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

test('the test endpoint resolves the App ID server-side, never from the body', () => {
  // A client must not be able to test against another client's Travelify
  // application: the rates that come back are commercially theirs.
  assert.ok(/async function appIdForCaller\(user\)/.test(TEST_API));
  assert.ok(!/body\.appId|rows\.appId/.test(TEST_API), 'the App ID must never come off the request');
});

test('the test endpoint is capped and authenticated', () => {
  assert.ok(/const auth = requireAuth\(req\);/.test(TEST_API), 'must be authenticated');
  assert.ok(/const MAX_CODES = \d+;/.test(TEST_API), 'one click must not fan out');
  assert.ok(/rows\.slice\(0, MAX_CODES\)/.test(TEST_API), 'the cap must actually be applied');
  assert.ok(/evaluatePublicRateLimit\(req, res, \{ event: 'tti-test' \}\)/.test(TEST_API));
});

test('the test endpoint keeps its rate limit even though the editor calls it', () => {
  // It is the only agent action that spends live Travelify searches, so the
  // trusted-preview relax must not switch its limit off.
  assert.ok(/case 'tti-test':/.test(RATELIMIT), 'tti-test needs its own window, not the null default');
  assert.ok(
    /NO_PREVIEW_RELAX = event === 'popup-lead' \|\| event === 'trip-enquiry'[\s\S]{0,80}event === 'tti-test'/.test(RATELIMIT),
    'the editor-preview relax must not apply to a live-search path',
  );
});

test('an unmatched search reports what it DID get, not just that it failed', () => {
  // "Nothing matched" is a dead end on its own: it cannot tell a wrong code
  // from a pin Travelify ignored. These three numbers separate the causes.
  assert.ok(/withRef: refs\.length/.test(TEST_API), 'how many offers carried a reference at all');
  assert.ok(/sampleRefs: \[\.\.\.new Set\(refs\)\]/.test(TEST_API), 'what those references look like');
  assert.ok(/sampleHotels:/.test(TEST_API), 'and what the search actually returned');
  assert.ok(/came back for that country/.test(EDITOR), 'the editor has to show it');
});

test('the ignored-pin verdict fires on a single code', () => {
  // The first person to try this tests one hotel. Making them add a second
  // before we say what we can already see is no help to anyone.
  assert.ok(
    /pinLooksIgnored: found === 0\s*&& results\.length > 0/.test(TEST_API),
    'one code is enough to recognise the pattern',
  );
  assert.ok(
    /r\.status === 'area-only' && r\.withRef > 20/.test(TEST_API),
    'and it must rest on offers that DO carry references, or a wrong code reads the same',
  );
});

test('a code with no country is refused rather than searched worldwide', () => {
  assert.ok(/status: 'no-country'/.test(TEST_API));
  assert.ok(/if \(!prop\.ctry\)/.test(TEST_API), 'the check must happen before any request is fired');
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

test('the test route declares a duration longer than its own timeout', () => {
  // An undeclared route gets Vercel's default, which was SHORTER than this
  // endpoint's own timeout, so the platform killed the function mid-flight and
  // returned an empty-bodied gateway response instead of per-code results.
  const fn = (VERCEL.functions || {})['api/tti-test.js'];
  assert.ok(fn, 'api/tti-test.js needs a functions entry, or it gets the default');
  const own = Number(/const TIMEOUT_MS = (\d+);/.exec(TEST_API)[1]);
  assert.ok(fn.maxDuration * 1000 > own,
    `maxDuration ${fn.maxDuration}s must exceed the endpoint's own ${own / 1000}s budget`);
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
