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
