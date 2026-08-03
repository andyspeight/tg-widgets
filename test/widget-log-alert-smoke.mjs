/**
 * /api/widget-log alert gate: an error is only worth emailing a human about when
 * it names a widget, an id, or a message. A content-less POST (an empty or
 * unparseable beacon that defaults to event:'error' + widget:'unknown') must be
 * recorded but NEVER alerted on — otherwise every dropped keepalive body or
 * public-endpoint probe becomes a phantom "unknown failing on <site>" email.
 *
 * Run: node test/widget-log-alert-smoke.mjs
 */
import { isActionableError, alertKind } from '../api/widget-log.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// ── The phantom alerts we saw in production: unknown, no id, no message ──────
ok(isActionableError({ event: 'error', widget: 'unknown', widgetId: '', message: '' }) === false,
  'content-less unknown error is NOT actionable (the yourticketgenie/travelnet case)');
ok(isActionableError({ event: 'error', widget: '', widgetId: '', message: '' }) === false,
  'empty body (widget falsy) is NOT actionable');
ok(isActionableError({ event: 'error', widget: 'unknown', widgetId: '', message: '', detail: '', origin: 'https://www.travelnet.ie' }) === false,
  'a real Origin alone does not make an empty beacon actionable');

// ── Genuine failures: any one of widget / id / message makes it actionable ───
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_123', message: 'Load failed' }) === true,
  'named widget + id + message IS actionable (the real offers failure)');
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: '', message: '' }) === true,
  'a named widget alone is enough to alert');
ok(isActionableError({ event: 'error', widget: 'unknown', widgetId: 'tgw_456', message: '' }) === true,
  'a widget id alone is enough to alert');
ok(isActionableError({ event: 'error', widget: 'unknown', widgetId: '', message: 'config load failed' }) === true,
  'a message alone is enough to alert');

// ── A Draft / unpublished form is an expected setup state, never an alert ────
// (24 Jul 2026) An agent placed an embed before setting the form Live in the
// builder. The reason arrives in the detail (enquirypro) or the message
// (enquiry) depending on the widget version — both must be suppressed.
ok(isActionableError({ event: 'error', widget: 'enquirypro', widgetId: 'tgw_x', message: 'config load failed', detail: 'This form is not published yet.' }) === false,
  'not-published in the DETAIL is suppressed (no alert)');
ok(isActionableError({ event: 'error', widget: 'enquiry', widgetId: 'tgw_y', message: 'This form is not published yet.', detail: '' }) === false,
  'not-published in the MESSAGE is suppressed (no alert)');
ok(isActionableError({ event: 'error', widget: 'enquirypro', widgetId: 'tgw_z', message: 'config load failed', detail: 'HTTP 500 Server error' }) === true,
  'a genuine config-load failure (not a Draft form) still alerts');

// ── A 2xx "failure" is a client-side blip (dropped connection), never pageable ──
// (24 Jul 2026) An empty-bodied 200 from a mobile visitor read as an error, but
// the server answered OK — it's a truncated download, not a service outage.
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_a', message: 'Offers service unavailable (HTTP 200)', detail: 'cards' }) === false,
  'a 200-status "unavailable" (empty body / dropped connection) is not an alert');
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_b', message: 'Offers service unavailable (HTTP 504)', detail: 'cards' }) === true,
  'a genuine gateway outage (HTTP 504) still alerts');
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_c', message: 'Offers service unavailable (HTTP 502)', detail: 'cards' }) === true,
  'a genuine bad-gateway (HTTP 502) still alerts');

// ── A widget-config 404 is a DELETED / stale embed, not a platform failure ────
// (27-29 Jul 2026) travelhubworld left two deleted offers widgets embedded on
// /last-minute-deals, so each page view re-fired "Config load failed: 404".
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_1784733883811_bzxnql', message: 'config load failed', detail: 'Config load failed: 404' }) === false,
  'a config-load 404 (deleted / stale embed) is NOT alerted');
ok(isActionableError({ event: 'error', widget: 'spotlight', widgetId: 'tgw_x', message: 'config load failed', detail: 'HTTP 404 Not Found' }) === false,
  'any config 404 phrasing is suppressed');
// But only CONFIG 404s: a genuine config 5xx, and a non-config 404, still alert.
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_d', message: 'config load failed', detail: 'Config load failed: 503' }) === true,
  'a config 503 still alerts (real outage, not a missing widget)');
ok(isActionableError({ event: 'error', widget: 'mybooking', widgetId: 'tgw_e', message: 'order lookup failed', detail: 'HTTP 404' }) === true,
  'a 404 that is NOT a config load still alerts (only widget-config 404 is a stale embed)');

// ── A config-load NETWORK error is a navigate-away / transient blip, not a fault ─
// (29 Jul 2026) yourticketgenie's healthy homepage widget (296 clean config
// loads) fired one "config load failed / Failed to fetch" — a visitor navigating
// away as the page fetched, before visibilityState flipped to hidden.
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_1783436471386_hv9ltx', message: 'config load failed', detail: 'Failed to fetch' }) === false,
  'config load + "Failed to fetch" (navigate-away) is NOT alerted');
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_f', message: 'config load failed', detail: 'Load failed' }) === false,
  'config load + Safari "Load failed" is NOT alerted');
ok(isActionableError({ event: 'error', widget: 'enquiry', widgetId: 'tgw_g', message: 'config load failed', detail: 'The user aborted a request.' }) === false,
  'config load + abort is NOT alerted');
// ── The offers CACHE "unreachable" beacon is the same client-side blip ───────
// (3 Aug 2026) yourticketgenie's healthy homepage offers widget fired one
// "offer cache unreachable / Load failed" — a single request that never reached
// us — while EVERY server-side hit succeeded (100% 200s, one 51s before the
// alert). The widget is cache-only, so its fetch throwing is a navigate-away, a
// dropped connection, or an extension blocking a "/offers" URL, not an outage.
// Now recorded but not emailed, exactly like the config network beacon above.
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_1783436471386_hv9ltx', message: 'offer cache unreachable', detail: 'Load failed' }) === false,
  'offer cache unreachable + Safari "Load failed" (the yourticketgenie 3 Aug case) is NOT alerted');
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_i', message: 'offer cache unreachable', detail: 'Failed to fetch' }) === false,
  'offer cache unreachable + Chrome "Failed to fetch" is NOT alerted');
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_j', message: 'offer cache unreachable', detail: 'The user aborted a request.' }) === false,
  'offer cache unreachable + abort is NOT alerted');
// A GENUINE cache outage is NOT silenced: it beacons as "offer cache degraded"
// (a distinct message with a status-bearing or template detail), and a
// platform-wide reachability break is caught by the cached-offers monitor probe.
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_k', message: 'offer cache degraded', detail: 'HTTP 502' }) === true,
  'a real cache outage (offer cache degraded / HTTP 502) still alerts');
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_l', message: 'offer cache degraded', detail: 'cards' }) === true,
  'a server-flagged degraded cache (offer cache degraded) still alerts');
// The suppression is DETAIL-scoped: an "unreachable" beacon carrying a
// status-bearing detail (not a bare network reject) still alerts.
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_m', message: 'offer cache unreachable', detail: 'HTTP 500 Server error' }) === true,
  'offer cache unreachable with a status-bearing detail (not a network reject) still alerts');

// ── Loads and junk are never alertable ──────────────────────────────────────
ok(isActionableError({ event: 'load', widget: 'consent', widgetId: 'tgw_9', message: '' }) === false,
  'a load heartbeat is never an alert, however well populated');
ok(isActionableError(null) === false, 'null entry is safe (no throw, not actionable)');
ok(isActionableError({}) === false, 'empty object is not actionable');

// ── Classified offers errors: actionable, dedupe-stable, and no raw parser noise
// The 23 Jul 2026 incident sent the cryptic "Unexpected end of JSON input". The
// widget now sends a status-bearing classified message. It must still alert, and
// repeats of the SAME message must collapse to one dedup kind.
const OFFERS_504 = 'Offers service unavailable (HTTP 504)';
ok(isActionableError({ event: 'error', widget: 'offers', widgetId: 'tgw_1', message: OFFERS_504 }) === true,
  'a classified offers outage still alerts (it names a widget + message)');
ok(/http 504/i.test(OFFERS_504) && !/unexpected end of json input/i.test(OFFERS_504),
  'the classified message is actionable (carries the HTTP status, not the raw parser error)');
ok(alertKind(OFFERS_504) === alertKind(OFFERS_504) && alertKind(OFFERS_504) === 'offers-service-unavailable-http-504-',
  'identical outages derive the SAME dedup kind → one email per widget+site / 30 min');
ok(alertKind('Offers service unavailable (HTTP 502)') !== alertKind(OFFERS_504),
  'a different status is a different kind (502 vs 504 are seen separately, by design)');
ok(alertKind("Failed to execute 'json' on 'Response': Unexpected end of JSON input") !== alertKind(OFFERS_504),
  'the old raw parser message is no longer what the live path reports');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
