/**
 * Widget views (3 Sep 2026): the Spotlight family reports the one-time load
 * heartbeat, /api/widget-log turns a load with a widget id into two Redis
 * counters (all time + this month), and /api/widget-list merges them into the
 * dashboard list. Guards the key scheme and the wiring by source, since the
 * Redis client is a REST call.
 *
 * Run: node test/widget-views-smoke.mjs   (also: npm run test:widget-views)
 */
import { readFileSync } from 'node:fs';
import { viewKeys, monthBucket, isCountableId, VIEWS_PREFIX, MONTH_TTL_SECONDS } from '../api/_lib/widget-views.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ── key scheme ──────────────────────────────────────────────────────────────
const k = viewKeys('tgw_1786541681562_64vl50', new Date(Date.UTC(2026, 8, 3)));
ok(k.allTime === VIEWS_PREFIX + 'tgw_1786541681562_64vl50', 'all-time key is prefix + id');
ok(k.month === VIEWS_PREFIX + 'tgw_1786541681562_64vl50:202609', 'month key carries the UTC yyyymm bucket');
ok(monthBucket(new Date(Date.UTC(2026, 0, 31, 23, 59))) === '202601', 'January stays in January at the UTC boundary');
ok(MONTH_TTL_SECONDS > 31 * 86400 && MONTH_TTL_SECONDS < 90 * 86400, 'a month bucket lives longer than a month, less than a quarter');
ok(isCountableId('tgw_1786541681562_64vl50') && isCountableId('tgs_demo_greece'), 'minted and demo ids are countable');
ok(!isCountableId('') && !isCountableId('a b') && !isCountableId('x'.repeat(61)) && !isCountableId(null), 'blank, spaced, oversized or missing ids are not');

// ── widget-log counts a load, and only a load ──────────────────────────────
const log = read('api/widget-log.js');
ok(/event === 'load' && isCountableId\(entry\.widgetId\)/.test(log), 'widget-log counts only a load event with a countable id');
ok(/incr\(k\.allTime\)/.test(log) && /incrEx\(k\.month, MONTH_TTL_SECONDS\)/.test(log), 'widget-log increments the all-time and month counters');
ok(/redisConfigured\(\)/.test(log.slice(log.indexOf('Per-widget view counters'))), 'counting is skipped when Redis is not configured');

// ── widget-list merges the counters ───────────────────────────────────────
const list = read('api/widget-list.js');
ok(/viewsMonth: 0/.test(list) && /async function attachViews/.test(list), 'widget-list carries viewsMonth and an attachViews step');
ok(/await attachViews\(widgets\)/.test(list) && /catch \(e\) \{ console\.error\('\[widget-list\] views'/.test(list), 'attachViews is awaited inside a try so a Redis blip keeps the list');
ok(/Math\.max\(Number\(w\.views\) \|\| 0, all\)/.test(list), 'a hand-entered Airtable Views value still shows when larger');

// ── the dashboard's counter read must survive a big account ────────────────
// The Upstash REST client puts every argument in the URL path, so an unchunked
// MGET of two keys per widget passes the usual 8KB URL ceiling at ~100 widgets
// and the counts vanish for the biggest accounts. Guard the chunking.
ok(/VIEW_KEYS_PER_CALL = 50/.test(list), 'widget-list chunks the MGET (50 keys per call)');
ok(/for \(let i = 0; i < keys\.length; i \+= VIEW_KEYS_PER_CALL\)/.test(list), 'keys are sliced into chunks');
ok(/Promise\.all\(chunks\.map\(c => mget\(c\)\.catch\(\(\) => \[\]\)\)\)/.test(list), 'chunks run concurrently and a failed chunk degrades to empty');
ok(/vals\.push\(Array\.isArray\(got\) && j < got\.length \? got\[j\] : null\)/.test(list), 'a short or failed chunk contributes nulls so later widgets keep their alignment');
{
  // The arithmetic the chunk size defends: recreate the URL growth per widget.
  const key = VIEWS_PREFIX + 'tgw_1786541681562_64vl50';
  const perWidget = encodeURIComponent(key).length + 1 + encodeURIComponent(key + ':202609').length + 1;
  ok(perWidget > 100 && perWidget < 110, 'each widget costs ~103 URL characters (the reason for chunking)');
  ok(perWidget * 100 > 8000, 'an unchunked read for 100 widgets would exceed 8KB');
  ok((perWidget / 2) * 50 < 4000, '50 keys per call stays well inside the ceiling');
}

// ── the three widgets report a real embed, never a preview ────────────────
for (const [file, guard] of [
  ['public/widget-spotlight.js', /!this\.c\.widgetId \|\| this\.c\.destinationData/],
  ['public/widget-airport.js', /this\.c\.widgetId && !this\.c\.airportData/],
  ['public/widget-attraction.js', /this\.c\.widgetId && !this\.c\.attractionData/],
]) {
  const src = read(file);
  ok(/function tgReport\(event, widgetId, message, detail\)/.test(src), file + ': defines the reporter');
  ok(/'\/widget-log'/.test(src), file + ': posts to /api/widget-log on our own origin');
  ok(/tgReport\('load', this\.c\.widgetId\)/.test(src), file + ': sends the load heartbeat');
  ok(guard.test(src), file + ': inline-data previews (editor, demo) are never counted');
  ok(/tgReportFailure\(this\.c\.widgetId/.test(src), file + ': reports a status-bearing content failure');
  ok(/\\\(\\d\{3\}\\\)/.test(src), file + ': the failure beacon needs an HTTP status in the message');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
