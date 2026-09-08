/**
 * Plan limits drift guard: the API's PLAN_WIDGET_LIMITS and the dashboard's
 * registry `access` map must agree on WHICH plans include each widget.
 *
 * Why: the Loader (Andy, 8 Sep 2026). The Package Catalogue in Airtable puts
 * widget-loader on Spark, Boost, Ignite and Bespoke, and the dashboard's access
 * map said Spark: 1, so a Spark client opened the editor as normal. The save
 * then hit PLAN_WIDGET_LIMITS, which still said Spark: 0, and was refused with
 * "The Loader widget is not included in your plan. Please upgrade". The two
 * maps sit in different files with a "KEEP IN SYNC" comment and nothing
 * checked that they were.
 *
 * What this guards (source-level, no network):
 *   1. Every ALLOWED_WIDGET_TYPES entry has a PLAN_WIDGET_LIMITS row and vice
 *      versa (a missing row is a 500 on save).
 *   2. For every live registry widget the API knows, the API and the dashboard
 *      agree on inclusion per plan: 0 on one side and non-zero on the other is
 *      the exact shape of the Loader bug. Counts may differ (-1 vs 3 is a
 *      display nuance the dashboard already sources from the catalogue feed).
 *   3. No row on either side carries a positive count. Andy's rule (8 Sep
 *      2026): a widget that is available on a plan is unlimited there, so
 *      every value is -1 or 0.
 *   4. The Loader itself (the bug that started this) is unlimited everywhere.
 *
 * Run: node test/plan-limits-drift-smoke.mjs  (npm run test:plan-limits-drift)
 */
import { readFileSync } from 'node:fs';

const API = readFileSync(new URL('../api/widget-config.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const COPY = readFileSync(new URL('../api/widget-copy.js', import.meta.url), 'utf8');

const PLANS = ['Spark', 'Boost', 'Ignite', 'Bespoke'];
let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
};

// ---------------------------------------------------------------------------
// Parse the API side
// ---------------------------------------------------------------------------
function parseAllowed(src) {
  const block = (src.match(/const ALLOWED_WIDGET_TYPES = \[([^\]]*)\]/) || [, ''])[1];
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}
function parseLimits(src) {
  const block = (src.match(/const PLAN_WIDGET_LIMITS = \{([\s\S]*?)\n\};/) || [, ''])[1];
  const out = {};
  const re = /^\s*'([^']+)':\s*\{\s*Spark:\s*(-?\d+),\s*Boost:\s*(-?\d+),\s*Ignite:\s*(-?\d+),\s*Bespoke:\s*(-?\d+)\s*\}/gm;
  for (const m of block.matchAll(re)) {
    out[m[1]] = { Spark: +m[2], Boost: +m[3], Ignite: +m[4], Bespoke: +m[5] };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parse the dashboard side: each registry entry's airtableType, status, access
// ---------------------------------------------------------------------------
function parseRegistry(html) {
  // Walk the WIDGETS array one entry at a time so a card whose fields sit in
  // a different order cannot be read against its neighbour's values.
  const start = html.indexOf('const WIDGETS = [');
  if (start < 0) return [];
  const body = html.slice(start);
  const out = [];
  for (const chunk of body.split(/\n  \{\n/).slice(1)) {
    const entry = chunk.split(/\n  \},?\n/)[0];
    const type = (entry.match(/airtableType:\s*'([^']+)'/) || [])[1];
    const status = (entry.match(/status:\s*'([^']+)'/) || [])[1];
    const acc = entry.match(/access:\s*\{\s*Spark:\s*(-?\d+),\s*Boost:\s*(-?\d+),\s*Ignite:\s*(-?\d+),\s*Bespoke:\s*(-?\d+)\s*\}/);
    if (!type || !status || !acc) continue;
    if ((entry.match(/airtableType:/g) || []).length !== 1) continue;
    out.push({ type, status, access: { Spark: +acc[1], Boost: +acc[2], Ignite: +acc[3], Bespoke: +acc[4] } });
  }
  return out;
}

const allowed = parseAllowed(API);
const limits = parseLimits(API);
const registry = parseRegistry(HTML);

console.log('The two maps parsed');
ok('ALLOWED_WIDGET_TYPES parsed (' + allowed.length + ' types)', allowed.length > 40);
ok('PLAN_WIDGET_LIMITS parsed (' + Object.keys(limits).length + ' rows)', Object.keys(limits).length > 40);
ok('registry parsed (' + registry.length + ' entries)', registry.length > 40);
ok('registry entries are unique by type',
  new Set(registry.map((r) => r.type)).size === registry.length);

console.log('Every allowed type has a limits row, and every limits row is an allowed type');
{
  const noRow = allowed.filter((t) => !limits[t]);
  ok('no allowed type is missing a limits row (a missing row is a 500 on save)',
    noRow.length === 0, 'missing: ' + noRow.join(', '));
  const notAllowed = Object.keys(limits).filter((t) => !allowed.includes(t));
  ok('no limits row for a type the API does not accept',
    notAllowed.length === 0, 'stray: ' + notAllowed.join(', '));
  const badRows = Object.entries(limits).filter(([, row]) =>
    PLANS.some((p) => !Number.isInteger(row[p]) || row[p] < -1));
  ok('every limits value is -1, 0 or a positive count',
    badRows.length === 0, 'bad: ' + badRows.map(([t]) => t).join(', '));
}

console.log('The API and the dashboard agree on which plans include each live widget');
{
  const live = registry.filter((r) => r.status === 'live' && limits[r.type]);
  ok('there are live registry widgets the API knows to compare (' + live.length + ')', live.length > 30);
  const drift = [];
  for (const r of live) {
    for (const p of PLANS) {
      const api = limits[r.type][p] !== 0;
      const dash = r.access[p] !== 0;
      if (api !== dash) drift.push(`${r.type} on ${p}: API ${limits[r.type][p]} vs dashboard ${r.access[p]}`);
    }
  }
  ok('no widget is "included" on the dashboard but refused by the API (or the reverse)',
    drift.length === 0, drift.join('\n      '));

  const unknown = registry.filter((r) => r.status === 'live' && !limits[r.type]);
  // Informational: a live card whose airtableType the API does not accept
  // cannot be saved under that type at all. Reported, not failed, because a
  // card can legitimately share its editor with another type.
  if (unknown.length) console.log('  ℹ live registry types with no API row: ' + unknown.map((r) => r.type).join(', '));
}

console.log('Available means unlimited: no positive count anywhere (Andy, 8 Sep 2026)');
{
  const apiCounts = Object.entries(limits)
    .flatMap(([t, row]) => PLANS.filter((p) => row[p] > 0).map((p) => `${t} on ${p}: ${row[p]}`));
  ok('the API map has no positive count', apiCounts.length === 0, apiCounts.join('\n      '));
  const dashCounts = registry
    .flatMap((r) => PLANS.filter((p) => r.access[p] > 0).map((p) => `${r.type} on ${p}: ${r.access[p]}`));
  ok('the dashboard registry has no positive count', dashCounts.length === 0, dashCounts.join('\n      '));
  const every = registry.filter((r) => r.status === 'live' && limits[r.type]);
  const valueDrift = every.flatMap((r) => PLANS.filter((p) => limits[r.type][p] !== r.access[p])
    .map((p) => `${r.type} on ${p}: API ${limits[r.type][p]} vs dashboard ${r.access[p]}`));
  ok('with only -1 and 0 in play, the API and the dashboard now agree on every value',
    valueDrift.length === 0, valueDrift.join('\n      '));
}

console.log('There is ONE plan map: the copy endpoint reads it rather than carrying its own');
{
  ok('api/widget-copy.js imports PLAN_WIDGET_LIMITS and canonicalisePlan from widget-config.js',
    /import \{ PLAN_WIDGET_LIMITS, canonicalisePlan \} from '\.\/widget-config\.js';/.test(COPY));
  ok('api/widget-copy.js declares no plan map of its own',
    !/const PLAN_WIDGET_LIMITS\s*=/.test(COPY) && !/const PLAN_ALIASES\s*=/.test(COPY));
  ok('a locked type is refused on copy with the same wording as a new widget',
    /planLimit === 0[\s\S]*?is not included in your plan/.test(COPY));
}

console.log('The Loader is unlimited on every plan (catalogue: Spark, Boost, Ignite, Bespoke; Andy: available means unlimited)');
{
  const row = limits['Loader'];
  ok('the API has a Loader row', !!row);
  ok('the API has the Loader unlimited on every plan',
    !!row && PLANS.every((p) => row[p] === -1), row ? JSON.stringify(row) : 'no row');
  const card = registry.find((r) => r.type === 'Loader');
  ok('the dashboard has the Loader unlimited on every plan',
    !!card && PLANS.every((p) => card.access[p] === -1), card ? JSON.stringify(card.access) : 'no card');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
