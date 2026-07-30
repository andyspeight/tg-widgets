/**
 * Offers widgets are CACHE-ONLY (locked decision 30 Jul 2026).
 *
 * A visitor's browser must never trigger a Travelify search. The only live
 * search left in the product is the one Travelify runs when a visitor CLICKS
 * an offer and lands on the booking page.
 *
 * Why this needs its own guard: the live fallback was load-bearing for two
 * years and every failure branch used to end "…and then we go live". Removing
 * it is easy to half-undo — one `catch` that reaches for the proxy, one new
 * template that skips the cache — and the symptom (a slow trickle of Travelify
 * searches) is invisible until someone reads the telemetry a month later.
 *
 * Evidence this was built on (7 days to 30 Jul 2026, Supabase widget_events):
 *   • 4,256 live /api/offers calls against 3,089 cache reads
 *   • 986 of the last 1,250 live calls came from ONE departure board that
 *     refetched every 5 minutes and again on every tab focus
 *   • cache hit rate 57% → 95% after the 27/28 Jul read-side fixes
 *
 * Run: node test/offers-cache-only-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const WIDGET = readFileSync(new URL('../public/widget-offers.js', import.meta.url), 'utf8');
const EDITOR = readFileSync(new URL('../public/editor-offers.html', import.meta.url), 'utf8');
const CACHED = readFileSync(new URL('../api/cached-offers.js', import.meta.url), 'utf8');
const CRON = readFileSync(new URL('../api/cron/refresh-map-offers.js', import.meta.url), 'utf8');

// Skip the changelog when asserting on code — it legitimately describes the
// live path it removed.
const code = WIDGET.slice(WIDGET.indexOf("'use strict'"));

// ── No live path survives in the widget ──────────────────────────────────────
ok(!/OFFERS_PROXY/.test(code), 'no OFFERS_PROXY constant');
ok(!/_cacheEligible/.test(code), 'no cache-eligibility gate (there is nothing to be eligible for)');
ok(/CACHED_OFFERS_URL/.test(code), 'the cache URL is still built');
// Every fetch in the widget must go to one of our own read-only endpoints.
const fetchTargets = [...code.matchAll(/fetch(?:WithRetry)?\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
// GEO_API_URL is the ip-geolocation lookup that picks the visitor's nearest
// departure airport. It is not an offer search and costs Travelify nothing.
const ALLOWED = new Set(['CACHED_OFFERS_URL', 'FX_RATES_URL', 'WIDGET_LOG_URL', 'GEO_API_URL', 'url', 'API_BASE']);
for (const t of new Set(fetchTargets)) {
  ok(ALLOWED.has(t), `fetch target "${t}" is an allowed endpoint (never the live offers proxy)`);
}
// A POST is how the live proxy was called; the cache is a GET.
ok(!/method:\s*'POST'[\s\S]{0,400}?appId:/.test(code),
  'no POST carrying an appId survives (that was the live-proxy call shape)');

// ── The board fetches once, on load ──────────────────────────────────────────
ok(!/setInterval\(\s*\(\)\s*=>\s*\{[\s\S]{0,120}_fetchAndRenderBoard/.test(code),
  'no timer refetches the departure board');
ok(!/visibilitychange[\s\S]{0,200}_fetchAndRenderBoard/.test(code),
  'refocusing the tab does not refetch the board');
// The scheduler is kept as a teardown so an old config's boardAutoRefresh /
// boardRefreshSeconds simply does nothing, and a stale timer is cleared.
ok(/_scheduleBoardRefresh\(\) \{[\s\S]{0,400}clearInterval\(this\._boardRefreshTimer\)/.test(code),
  '_scheduleBoardRefresh tears down any legacy timer');
ok(/removeEventListener\('visibilitychange'/.test(code),
  '_scheduleBoardRefresh removes any legacy visibility handler');
// Anchor on the 4-space-indented DEFINITIONS — the bare names also appear at
// their call sites earlier in the class, which silently inverts a slice.
const defn = (name) => {
  const at = code.indexOf('\n    ' + name);
  if (at < 0) throw new Error('definition not found: ' + name);
  return at;
};
const boardFetch = code.slice(defn('async _fetchAndRenderBoard()'), defn('_renderBoardShell()'));
ok(!/_scheduleBoardRefresh/.test(boardFetch), 'the board re-render path no longer re-arms a refresh');

// ── Flight templates ask for rows they can actually draw ─────────────────────
ok(/_needsFlightRows\(\)/.test(code), 'the widget knows which templates need a flight per row');
const needs = code.slice(defn('_needsFlightRows() {'), defn('_cachedOffersQuery(payload) {'));
ok(/departure-board/.test(needs) && /boarding-pass/.test(needs),
  'both flight-only templates are covered');
ok(/q\.set\('hasFlight', '1'\)/.test(code), 'flight templates ask the cache for hasFlight=1');
// Board basis / rating / nights describe a hotel. On a flight board they only
// shrink the pool — one live board went from 494 eligible offers to 3.
const queryFn = code.slice(defn('_cachedOffersQuery(payload) {'), defn('_fireDataLoaded() {'));
ok(/if \(!flightRows\) \{[\s\S]*?boardBases[\s\S]*?ratingMin[\s\S]*?durationM/.test(queryFn),
  'hotel-shaped filters are skipped for flight templates');
const flightSkip = queryFn.slice(queryFn.indexOf('if (!flightRows) {'), queryFn.indexOf('cabinClasses'));
ok(/budgetMin/.test(queryFn) && /budgetMax/.test(queryFn) && !/budgetM/.test(flightSkip),
  'price bounds still apply to every template');
// The board sets a SINGULAR `origin` once it detects the visitor's airport.
// Missing it would let a board read every departure airport in the cache.
ok(/payload\.origin\b/.test(queryFn), "the board's singular `origin` reaches the cache query");

// ── Failure is calm, and a real outage is still audible ──────────────────────
ok(/_fetchFromCache\(payload, ck, ttlMs\)/.test(code), 'one fetch path, named for what it does');
const fetchFn = code.slice(defn('async _fetchFromCache('), defn('_needsFlightRows() {'));
ok(/this\._showEmpty\(\)/.test(fetchFn), 'an empty result shows the client\'s configured empty state');
ok(/data && data\.degraded/.test(fetchFn), 'a degraded cache is told apart from an empty one');
ok(/offer cache degraded/.test(fetchFn), 'a degraded cache beacons');
ok(/offer cache unreachable/.test(fetchFn), 'an unreachable cache beacons');
// A plain "nothing matched" must NOT beacon, or the real faults drown.
const emptyBranch = fetchFn.slice(fetchFn.indexOf('this.rawOffers = [];'), fetchFn.indexOf('} catch'));
ok(/if \(this\._cacheDegraded\) \{[\s\S]{0,200}tgReport/.test(emptyBranch),
  'a legitimate no-match does NOT fire an alert');
ok(/fetchWithRetry\(CACHED_OFFERS_URL/.test(code),
  'the cache read is retried — with no fallback, one dropped request blanks the widget');
// Failing soft means never painting a red banner over a customer's page.
ok(!/Offers service unavailable/.test(code), 'no raw service-error banner survives');

// ── The endpoint knows it is now the only source ─────────────────────────────
ok(/hasFlight/.test(CACHED), 'the cache endpoint supports hasFlight');
ok(/const needsFlight = String\(q\.hasFlight \|\| ''\) === '1'/.test(CACHED), 'hasFlight is opt-in, not default');
ok(/if \(needsFlight && !\(o\.origin && hasDepartureTime\(o\)\)\) continue;/.test(CACHED),
  'hasFlight requires BOTH a departure airport and a real departure time');
// A date-only offer would render 00:00 on every board row, which reads broken.
ok(/hasDepartureTime = \(o\) => \/T\\d\{2\}:\\d\{2\}\/\.test/.test(CACHED),
  'a date without a time does not count as a departure time');
// Both no-Redis and thrown-error paths must be distinguishable from a real zero.
const degradedReturns = (CACHED.match(/degraded: true/g) || []).length;
ok(degradedReturns >= 2, `every unanswerable branch flags degraded (found ${degradedReturns})`);
ok(!/falls back to the live proxy|fall back to live|falls back to live/.test(CACHED),
  'no stale comment still promises a live fallback');

// ── The editor tells the truth ───────────────────────────────────────────────
// It used to fan out one live /api/offers per destination when the cache came
// back empty. That both reported a pool the widget cannot read and was itself
// the cause of a rate-limit lockout that blanked a client's live site.
ok(!/fetch\('\/api\/offers'/.test(EDITOR), 'the editor no longer probes live Travelify');
ok(/fetch\('\/api\/cached-offers\?'/.test(EDITOR), 'the editor probes the cache');
ok(/availability\.unavailable/.test(EDITOR), 'the strip distinguishes "cannot reach the cache" from zero');
ok(/could not reach the offer cache/.test(EDITOR), 'an unreachable cache says so in plain words');
ok(/nothing in the offer cache matches these filters yet/i.test(EDITOR),
  'a genuine zero explains itself instead of just showing 0');
ok(/exact count from the offer cache, which is what your widget shows/.test(EDITOR),
  'the count is described as what the widget will actually show');
// The editor's query must mirror the widget's or the strip promises a pool the
// widget never reads.
ok(/const flightRows = state\.config\.template === 'departure-board' \|\| state\.config\.template === 'boarding-pass'/.test(EDITOR),
  'the editor mirrors the widget\'s flight-template rule');
ok(/q\.set\('hasFlight', '1'\)/.test(EDITOR), 'the editor mirrors hasFlight');
ok(/state\.config\.template\]\)/.test(EDITOR),
  'the probe cache key includes the template (it changes the query)');
ok(/detail\.degraded/.test(EDITOR), 'the dedupe panel separates a cache outage from empty filters');

// ── The cron keeps its live access ───────────────────────────────────────────
// Cache-only is about the VISITOR path. The cron is how the cache gets filled,
// so it must still call Travelify — that is the whole point of the change.
ok(/OFFERS_PROXY/.test(CRON), 'the refresh cron still calls the live offers proxy');
ok(/SWEEP_TYPES/.test(CRON) && /'Flights'/.test(CRON), 'the cron still sweeps flights into the cache');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
