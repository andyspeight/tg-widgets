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

test('the criteria match the shape Travelify actually documented', () => {
  const b = buildAccommodationCriteria(AT, {}, NOW);
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
  const ref = (code) => buildAccommodationCriteria({ ...AT, code }, {}, NOW)
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
  const a = buildAccommodationCriteria({ code: 'TTI:58612582', ctry: 'GB' }, {}, NOW)
    .AccommodationSearchCriteria;
  assert.equal(a.Ref, 'TTI:58612582');
  assert.equal(a.LocationCountry, 'GB');
  // Absent, not zeroed. 0,0 is a real place in the Atlantic.
  assert.equal('Latitude' in a, false);
  assert.equal('Longitude' in a, false);
  assert.equal('Radius' in a, false);
});

test('coordinates narrow the search when a row has them', () => {
  const a = buildAccommodationCriteria(AT, {}, NOW).AccommodationSearchCriteria;
  assert.equal(a.Latitude, 50.71993);
  assert.equal(a.Longitude, -1.874885);
  assert.equal(a.Radius, 11);
  assert.equal(a.LocationName, 'Bournemouth, Dorset, United Kingdom');
});

test('a search with no code and no area at all is refused', () => {
  // Somewhere to look is still required. An unscoped worldwide search is not
  // a broader question, it is a meaningless one.
  assert.equal(buildAccommodationCriteria({ ...AT, code: '' }, {}, NOW), null);
  assert.equal(buildAccommodationCriteria({ code: '58612582' }, {}, NOW), null);
  assert.equal(buildAccommodationCriteria(null, {}, NOW), null);
  // Out-of-range coordinates fall back to the country rather than being sent.
  const bad = buildAccommodationCriteria({ code: '58612582', ctry: 'GB', lat: 91, lng: 0 }, {}, NOW);
  assert.equal('Latitude' in bad.AccommodationSearchCriteria, false);
  assert.equal(bad.AccommodationSearchCriteria.LocationCountry, 'GB');
});

test('the stay is a month out and a week long, as the deeplinks already ask', () => {
  const a = buildAccommodationCriteria(AT, {}, NOW).AccommodationSearchCriteria;
  assert.equal(a.CheckinDate, '2026-10-14T00:00:00Z', '30 days from 14 Sep');
  assert.equal(a.CheckoutDate, '2026-10-21T00:00:00Z', 'seven nights later');
  // Both must be midnight UTC in the exact format the example uses.
  for (const d of [a.CheckinDate, a.CheckoutDate]) {
    assert.match(d, /^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
  }
});

test('the stay window is configurable and clamped to something sane', () => {
  const a = buildAccommodationCriteria(AT, { leadDays: 90, nights: 3 }, NOW).AccommodationSearchCriteria;
  assert.equal(a.CheckinDate, '2026-12-13T00:00:00Z');
  assert.equal(a.CheckoutDate, '2026-12-16T00:00:00Z');
  const silly = buildAccommodationCriteria(AT, { leadDays: 9999, nights: 999 }, NOW).AccommodationSearchCriteria;
  assert.ok(silly.CheckinDate < silly.CheckoutDate);
  assert.equal(buildAccommodationCriteria(AT, { radius: 9999 }, NOW).AccommodationSearchCriteria.Radius, 100);
});

test('occupancy carries children and infants with their ages', () => {
  const a = buildAccommodationCriteria(AT, { adults: 2, childAges: [7, 1] }, NOW).AccommodationSearchCriteria;
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
  assert.ok(/runSearch\(creds, criteria/.test(TEST_API));
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
  assert.ok(/offers: normalised, refreshedAt/.test(TEST_API));
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
  // behind it, which is worse than showing nothing.
  const n = normaliseAccommodationResult({ name: 'The Grand', uniqueRef: 'TTI:1' });
  assert.equal(n, null);
  const ok = normaliseAccommodationResult({ name: 'The Grand', uniqueRef: 'TTI:1', price: 420 });
  assert.equal(ok.offer.price, 420);
});

test('the normaliser reports what it could not find', () => {
  // The result shape had not been seen when this was written. A cache quietly
  // full of nulls looks identical to a supplier with thin content, so the
  // guesses report themselves rather than failing silently.
  const n = normaliseAccommodationResult({ price: 420 });
  assert.ok(n.unmapped.includes('hotel'), 'a nameless result must say so');
  assert.ok(n.unmapped.includes('image'));
  assert.ok(n.unmapped.includes('url'));
  const full = normaliseAccommodationResult({
    name: 'The Grand', price: 420, image: { url: 'https://x/i.jpg' }, deeplinkUrl: 'https://x/b',
  });
  assert.deepEqual(full.unmapped, [], 'a complete result reports no gaps');
  assert.equal(full.offer.hotel, 'The Grand');
  assert.equal(full.offer.image, 'https://x/i.jpg');
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
