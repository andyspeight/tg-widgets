/**
 * /api/widget-log alert gate: an error is only worth emailing a human about when
 * it names a widget, an id, or a message. A content-less POST (an empty or
 * unparseable beacon that defaults to event:'error' + widget:'unknown') must be
 * recorded but NEVER alerted on — otherwise every dropped keepalive body or
 * public-endpoint probe becomes a phantom "unknown failing on <site>" email.
 *
 * Run: node test/widget-log-alert-smoke.mjs
 */
import { isActionableError } from '../api/widget-log.js';

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

// ── Loads and junk are never alertable ──────────────────────────────────────
ok(isActionableError({ event: 'load', widget: 'consent', widgetId: 'tgw_9', message: '' }) === false,
  'a load heartbeat is never an alert, however well populated');
ok(isActionableError(null) === false, 'null entry is safe (no throw, not actionable)');
ok(isActionableError({}) === false, 'empty object is not actionable');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
