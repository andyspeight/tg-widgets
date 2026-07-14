/**
 * Spotlight content-override tests (plain Node, no jsdom).
 *
 * The "rewrite in your own voice" feature merges a client's per-destination
 * prose overrides over the live Luna Brain payload at render time. The merge
 * helper lives inside the widget IIFE (widget-spotlight.js) and the bounding
 * sanitiser lives inside api/widget-config.js; neither is exported. As with
 * the deeplink tests, we extract the ACTUAL shipped source and evaluate it so
 * the test exercises the code that ships, not a copy.
 *
 * Covers:
 *  - scalar overrides (tagline, heroIntro, planning notes) merge over live data
 *  - array overrides (highlights, events) match by the slug of the ORIGINAL
 *    title/name, so a Luna rename/removal makes the override fall away safely
 *    rather than smear onto the wrong card
 *  - facts / climate / images are never touched
 *  - server sanitiser clamps lengths, drops empty and malformed leaves, caps
 *    counts, and re-derives the contentEdited flag
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WIDGET = path.join(__dirname, '..', 'public', 'widget-spotlight.js');
const API = path.join(__dirname, '..', 'api', 'widget-config.js');

let passed = 0;
const failures = [];
function assert(cond, msg) { if (cond) { passed++; } else { failures.push(msg); } }
function eq(actual, expected, msg) {
  assert(actual === expected, `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Slice a balanced {...} block starting at the first '{' after `fromIdx`,
// skipping string/comment content so their braces do not count.
function sliceBalanced(src, fromIdx) {
  let i = src.indexOf('{', fromIdx);
  const open = i;
  let depth = 0, str = null, line = false, block = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced block');
}
function extractFn(src, signature) {
  const at = src.indexOf(signature);
  if (at < 0) throw new Error('not found: ' + signature);
  return signature + sliceBalanced(src, at + signature.length);
}

const widgetSrc = fs.readFileSync(WIDGET, 'utf8');
const apiSrc = fs.readFileSync(API, 'utf8');

// Build the widget merge helper with its two dependencies in scope.
const applyContentOverrides = new Function(
  extractFn(widgetSrc, 'function normaliseSlugClient(s)') + '\n' +
  extractFn(widgetSrc, 'function pickV(ov, fallback)') + '\n' +
  extractFn(widgetSrc, 'function applyContentOverrides(data, ov)') + '\n' +
  'return applyContentOverrides;'
)();

// Build the server-side sanitiser + flag helper.
const sanitiseContentOverrides = new Function(
  'const OV_MAX_KEYS = 250, OV_MAX_LEAVES = 60, OV_MAX_STR = 6000;\n' +
  extractFn(apiSrc, 'function sanitiseContentOverrides(input)') + '\n' +
  'return sanitiseContentOverrides;'
)();
const hasContentOverrides = new Function(
  extractFn(apiSrc, 'function hasContentOverrides(ov)') + '\n' +
  'return hasContentOverrides;'
)();

const ov = (v, o) => ({ v, o: o == null ? '' : o });

// A representative live Luna payload.
function livePayload() {
  return {
    name: 'Santorini',
    level: 'city',
    tagline: 'Whitewashed cliffs above a caldera',
    heroIntro: 'A volcanic island in the Cyclades.',
    facts: { flightTime: '4h 10m', currency: 'Euro (EUR)', voltage: '230V' },
    climate: { temps: [12, 12, 14, 17, 21, 26, 28, 28, 25, 21, 17, 14], season: [] },
    images: ['https://cdn.example.com/santorini.jpg'],
    highlights: [
      { icon: 'sun', title: 'Oia sunsets', description: 'The famous golden hour.' },
      { icon: 'wine', title: 'Assyrtiko wineries', description: 'Volcanic-soil whites.' },
    ],
    events: [
      { month: 'Aug', name: 'Ifestia Festival', description: 'A re-enactment of the eruption.' },
    ],
    planning: { priceBand: '£££', visaAdvisory: 'No visa for UK visitors under 90 days.', healthNotes: 'EHIC/GHIC accepted.' },
    bestForTags: ['Romance', 'Food and wine'],
  };
}

// ── 1. No overrides → payload untouched ────────────────────────────────────
{
  const d = livePayload();
  const out = applyContentOverrides(d, null);
  eq(out.tagline, 'Whitewashed cliffs above a caldera', 'null overrides leave tagline');
  const out2 = applyContentOverrides(livePayload(), {});
  eq(out2.heroIntro, 'A volcanic island in the Cyclades.', 'empty overrides leave heroIntro');
}

// ── 2. Scalar overrides applied ────────────────────────────────────────────
{
  const out = applyContentOverrides(livePayload(), {
    tagline: ov('Our little slice of the Aegean'),
    heroIntro: ov('We have sent hundreds of couples here.'),
    planning: { visaAdvisory: ov('Ask us about visas'), healthNotes: ov('Bring travel insurance') },
  });
  eq(out.tagline, 'Our little slice of the Aegean', 'tagline overridden');
  eq(out.heroIntro, 'We have sent hundreds of couples here.', 'heroIntro overridden');
  eq(out.planning.visaAdvisory, 'Ask us about visas', 'visaAdvisory overridden');
  eq(out.planning.healthNotes, 'Bring travel insurance', 'healthNotes overridden');
  // Facts / climate / images never touched
  eq(out.facts.currency, 'Euro (EUR)', 'currency stays live');
  eq(out.climate.temps[6], 28, 'climate stays live');
  eq(out.images[0], 'https://cdn.example.com/santorini.jpg', 'images stay live');
  eq(out.planning.priceBand, '£££', 'untouched planning field stays live');
}

// ── 3. Highlights matched by slug of the ORIGINAL title ────────────────────
{
  const out = applyContentOverrides(livePayload(), {
    highlights: {
      'oia-sunsets': { title: ov('Sunsets you will never forget'), description: ov('Our favourite spot.') },
    },
  });
  const h0 = out.highlights[0];
  eq(h0.title, 'Sunsets you will never forget', 'highlight title overridden by original-title slug');
  eq(h0.description, 'Our favourite spot.', 'highlight description overridden');
  eq(h0.icon, 'sun', 'highlight icon preserved from live');
  // Second highlight untouched
  eq(out.highlights[1].title, 'Assyrtiko wineries', 'unmatched highlight stays live');
}

// ── 4. Events matched by slug of the ORIGINAL name ─────────────────────────
{
  const out = applyContentOverrides(livePayload(), {
    events: { 'ifestia-festival': { name: ov('The big volcano show'), description: ov('Go for it.') } },
  });
  eq(out.events[0].name, 'The big volcano show', 'event name overridden');
  eq(out.events[0].description, 'Go for it.', 'event description overridden');
  eq(out.events[0].month, 'Aug', 'event month preserved from live');
}

// ── 5. Drift safety: Luna renamed the highlight → override falls away ───────
{
  const d = livePayload();
  d.highlights[0].title = 'Oia at golden hour'; // Luna changed the title after the edit
  const out = applyContentOverrides(d, {
    highlights: { 'oia-sunsets': { description: ov('Stale rewrite') } },
  });
  // The key no longer matches the (new) live title, so the live value shows.
  eq(out.highlights[0].description, 'The famous golden hour.', 'renamed highlight ignores stale override');
}

// ── 6. pickV falls back when v is missing/non-string ───────────────────────
{
  const out = applyContentOverrides(livePayload(), { tagline: { o: 'x' } });
  eq(out.tagline, 'Whitewashed cliffs above a caldera', 'override with no v falls back to live');
}

// ── 7. Server sanitiser: shape, clamping, caps ─────────────────────────────
{
  eq(JSON.stringify(sanitiseContentOverrides(null)), '{}', 'null → {}');
  eq(JSON.stringify(sanitiseContentOverrides('nope')), '{}', 'string → {}');
  eq(JSON.stringify(sanitiseContentOverrides([1, 2])), '{}', 'array → {}');

  const clean = sanitiseContentOverrides({
    'city:recABC': {
      tagline: { v: 'Hello', o: 'Original' },
      heroIntro: { v: '   ', o: 'x' },              // empty after trim → dropped
      bogus: { notV: 'ignored' },                    // no v leaf, no children → dropped
      highlights: { 'oia-sunsets': { title: { v: 'T', o: 'O' } } },
    },
  });
  eq(clean['city:recABC'].tagline.v, 'Hello', 'valid leaf kept');
  eq(clean['city:recABC'].heroIntro, undefined, 'empty leaf dropped');
  eq(clean['city:recABC'].bogus, undefined, 'malformed leaf dropped');
  eq(clean['city:recABC'].highlights['oia-sunsets'].title.v, 'T', 'nested leaf kept');

  // Length clamp
  const big = 'a'.repeat(9000);
  const clamped = sanitiseContentOverrides({ 'k': { tagline: { v: big, o: big } } });
  eq(clamped.k.tagline.v.length, 6000, 'value clamped to OV_MAX_STR');
  eq(clamped.k.tagline.o.length, 6000, 'original clamped to OV_MAX_STR');
}

// ── 8. hasContentOverrides flag ────────────────────────────────────────────
{
  eq(hasContentOverrides(null), false, 'null → no overrides');
  eq(hasContentOverrides({}), false, 'empty → no overrides');
  eq(hasContentOverrides({ 'k': {} }), false, 'empty bucket → no overrides');
  eq(hasContentOverrides({ 'k': { tagline: { v: 'x', o: '' } } }), true, 'scalar leaf → has overrides');
  eq(hasContentOverrides({ 'k': { highlights: { s: { title: { v: 'x', o: '' } } } } }), true, 'nested leaf → has overrides');
}

// ── 9. _withOverrides key selection (fixed + auto-detect) ──────────────────
{
  const withOverrides = new Function(
    extractFn(widgetSrc, 'function normaliseSlugClient(s)') + '\n' +
    extractFn(widgetSrc, 'function pickV(ov, fallback)') + '\n' +
    extractFn(widgetSrc, 'function applyContentOverrides(data, ov)') + '\n' +
    'const proto = { ' + extractFn(widgetSrc, '_withOverrides(data)') + ' };\n' +
    'return (c, data) => proto._withOverrides.call({ c }, data);'
  )();

  const overrides = { 'city:recABC': { tagline: ov('Keyed by payload') } };
  const payload = () => ({ name: 'Santorini', level: 'city', recordId: 'recABC', tagline: 'Live' });

  // Payload carries its own identity → applies whether auto-detect is on or off.
  eq(withOverrides({ contentOverrides: overrides, autoDetect: { enabled: false } }, payload()).tagline, 'Keyed by payload', 'fixed: keyed by payload identity');
  eq(withOverrides({ contentOverrides: overrides, autoDetect: { enabled: true } }, payload()).tagline, 'Keyed by payload', 'auto-detect: keyed by payload identity');

  // Older payload without recordId → fall back to the configured destination.
  const legacy = () => ({ name: 'Santorini', level: 'city', tagline: 'Live' });
  eq(withOverrides({ contentOverrides: overrides, destination: { level: 'city', recordId: 'recABC' } }, legacy()).tagline, 'Keyed by payload', 'legacy payload falls back to config.destination key');
  // No payload identity and no config destination → live unchanged.
  eq(withOverrides({ contentOverrides: overrides }, legacy()).tagline, 'Live', 'no key resolvable → live');

  // Non-matching identity → live payload unchanged.
  eq(withOverrides({ contentOverrides: overrides }, { name: 'S', level: 'country', recordId: 'recZZZ', tagline: 'Live' }).tagline, 'Live', 'non-matching identity → live');
}

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\nspotlight-overrides: ${passed} passed, ${failures.length} FAILED`);
  failures.forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log(`spotlight-overrides: ${passed} passed`);
