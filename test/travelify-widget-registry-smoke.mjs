/**
 * Travelify integration — the static half.
 *
 * Everything the contract promises that can be checked without a network call:
 * the generated registry is current, every widget has exactly one category from
 * Travelify's controlled list, every widget has a preview image to point
 * imageUrl at, and every widget's editor path actually routes (a deep link to a
 * path with no rewrite would 404 the user straight after a successful sign-in,
 * which is the one thing the SSO change must never do).
 *
 * Run: node test/travelify-widget-registry-smoke.mjs  (npm run test:travelify-registry)
 */
import { readFileSync, existsSync, statSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (cond, label, detail) => {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + label + (detail ? '\n        ' + detail : '')); }
};

const { WIDGET_REGISTRY, WIDGETS_BY_ID, WIDGET_IDS } = await import('../api/_lib/widget-registry.js');
const { TRAVELIFY_CATEGORIES, PUBLIC_CATEGORY_BY_ID, publicCategoryFor } =
  await import('../api/_lib/widget-public-categories.js');
const { toDirectoryEntry, entitledWidgets, isInPlan, widgetForAirtableType } =
  await import('../api/_lib/v1/widget-view.js');
const { extractRegistry, renderModule } = await import('../scripts/build-widget-registry.mjs');

console.log('Travelify widget registry\n');

// ── The generated registry matches public/index.html ───────────────────────
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const committed = readFileSync(new URL('../api/_lib/widget-registry.js', import.meta.url), 'utf8');
ok(renderModule(extractRegistry(html)) === committed,
  'generated registry is current',
  'public/index.html has changed — run: npm run build:widget-registry');

ok(WIDGET_REGISTRY.length >= 50, `registry has every widget (${WIDGET_REGISTRY.length})`);
ok(new Set(WIDGET_IDS).size === WIDGET_IDS.length, 'widget ids are unique');
ok(WIDGET_IDS.every((id) => /^[a-z0-9-]+$/.test(id)), 'widget ids are URL safe');

// ── Categories ─────────────────────────────────────────────────────────────
const unmapped = WIDGET_IDS.filter((id) => !PUBLIC_CATEGORY_BY_ID[id]);
ok(unmapped.length === 0,
  'every widget has an explicit Travelify category',
  unmapped.length ? `unmapped: ${unmapped.join(', ')} — add them to widget-public-categories.js` : '');

const badCategory = WIDGET_IDS.filter((id) => !TRAVELIFY_CATEGORIES.includes(publicCategoryFor(id)));
ok(badCategory.length === 0,
  'every category is one of the controlled values',
  badCategory.length ? `outside the list: ${badCategory.join(', ')}` : '');

ok(!TRAVELIFY_CATEGORIES.includes('All Widgets'),
  '"All Widgets" is never returned (it is a filter, not a category)');

const orphans = Object.keys(PUBLIC_CATEGORY_BY_ID).filter((id) => !WIDGETS_BY_ID[id]);
ok(orphans.length === 0, 'category map has no ids the registry does not have',
  orphans.length ? `orphans: ${orphans.join(', ')}` : '');

// ── Preview images back every imageUrl ──────────────────────────────────────
const missingPreview = [];
const tinyPreview = [];
for (const id of WIDGET_IDS) {
  const file = new URL(`../public/previews/${id}.png`, import.meta.url);
  if (!existsSync(file)) { missingPreview.push(id); continue; }
  // A near-empty PNG means the capture drew nothing; the generator is supposed
  // to substitute a branded card rather than commit a blank tile.
  if (statSync(file).size < 4096) tinyPreview.push(id);
}
ok(missingPreview.length === 0, 'every widget has a preview image',
  missingPreview.length ? `missing: ${missingPreview.join(', ')} — run: npm run build:widget-previews` : '');
ok(tinyPreview.length === 0, 'no preview image is blank',
  tinyPreview.length ? `suspiciously small: ${tinyPreview.join(', ')}` : '');

// ── imageUrl is absolute HTTPS, never a relative path ──────────────────────
const entry = toDirectoryEntry(WIDGETS_BY_ID[WIDGET_IDS[0]], 'https://widgets.travelify.io');
ok(entry.imageUrl.startsWith('https://'), 'imageUrl is absolute HTTPS');
ok(Object.keys(entry).sort().join(',') === 'category,description,imageUrl,name,widgetId',
  'directory entry carries exactly the contract fields', JSON.stringify(Object.keys(entry)));
ok(WIDGET_REGISTRY.every((w) => w.name && w.description),
  'every widget has a name and a description (both required)');

// ── Plan gating ────────────────────────────────────────────────────────────
ok(entitledWidgets('', {}).length === 0, 'an unresolved plan is entitled to nothing, not everything');
ok(entitledWidgets('Ignite', {}).length >= entitledWidgets('Spark', {}).length,
  'a higher plan is entitled to at least as much as a lower one');
const comingSoon = entitledWidgets('Bespoke', { [WIDGET_IDS[0]]: 'coming-soon' });
ok(!comingSoon.some((w) => w.id === WIDGET_IDS[0]), 'a coming-soon widget is kept out of the directory');
ok(WIDGET_REGISTRY.every((w) => Object.values(w.access).every((v) => v <= 0)),
  'no plan carries a positive count (available means unlimited)');

// ── Airtable type round-trip, so My Widgets can count rows ─────────────────
const unroundtrippable = WIDGET_REGISTRY.filter((w) => widgetForAirtableType(w.airtableType)?.id !== w.id);
ok(unroundtrippable.length === 0, 'every widget resolves back from its Airtable type',
  unroundtrippable.length ? `broken: ${unroundtrippable.map((w) => w.id).join(', ')}` : '');
ok(widgetForAirtableType('  GOOGLE REVIEWS ')?.id === 'reviews', 'Airtable type matching is case and space tolerant');
ok(widgetForAirtableType('Not A Real Type') === null, 'an unknown Airtable type resolves to nothing');

// ── Every deep-link target actually routes ─────────────────────────────────
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const rewriteSources = new Set(vercel.rewrites.map((r) => r.source));
const unroutable = WIDGET_REGISTRY.filter((w) => !rewriteSources.has(w.editorUrl));
ok(unroutable.length === 0,
  'every widget editor path has a vercel rewrite',
  unroutable.length ? `no rewrite for: ${unroutable.map((w) => `${w.id} -> ${w.editorUrl}`).join(', ')}` : '');
ok(WIDGET_REGISTRY.every((w) => w.editorUrl.startsWith('/') && !w.editorUrl.startsWith('//')),
  'every editor path is root-relative (no protocol-relative open redirect)');

ok(vercel.headers.some((h) => h.source === '/previews/(.*)'),
  'vercel.json caches the preview images');

// ── Plan gating agrees with the save-time gate in widget-config ────────────
const apiSrc = readFileSync(new URL('../api/widget-config.js', import.meta.url), 'utf8');
const limitsBlock = (apiSrc.match(/const PLAN_WIDGET_LIMITS = \{([\s\S]*?)\n\};/) || [, ''])[1];
const limits = {};
for (const m of limitsBlock.matchAll(
  /^\s*'([^']+)':\s*\{\s*Spark:\s*(-?\d+),\s*Boost:\s*(-?\d+),\s*Ignite:\s*(-?\d+),\s*Bespoke:\s*(-?\d+)\s*\}/gm)) {
  limits[m[1]] = { Spark: +m[2], Boost: +m[3], Ignite: +m[4], Bespoke: +m[5] };
}
const disagreements = [];
for (const w of WIDGET_REGISTRY) {
  const api = limits[w.airtableType];
  if (!api) continue;
  for (const plan of ['Spark', 'Boost', 'Ignite', 'Bespoke']) {
    const offered = isInPlan(w, plan);
    const saveable = api[plan] !== 0;
    if (offered !== saveable) disagreements.push(`${w.id}/${plan} directory=${offered} save=${saveable}`);
  }
}
ok(disagreements.length === 0,
  'the directory never offers a widget the save API would refuse',
  disagreements.slice(0, 6).join('; '));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
