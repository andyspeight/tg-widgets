/**
 * Offer map (World Map) — client "show these star ratings" filter (Andy, 11 Aug 2026).
 *
 * A per-widget config `showRatings` (array of whole stars, e.g. [4,5]) limits
 * which accommodation ratings appear on the map's deal cards. Empty = show all.
 * The map shows one accommodation mode at a time (holidays = packages, or
 * hotels), so this single control covers every relevant offer type; you get
 * per-type granularity by choosing the mode per widget. A ratingless offer
 * (e.g. flight-only) is never hidden.
 *
 * Verifies the real normShowRatings (extracted + eval'd) and the filter
 * semantics, plus source-guards the widget + editor wiring.
 *
 * Run: node test/worldmap-star-filter-smoke.mjs  (also: npm run test:worldmap-stars)
 */
import { readFileSync } from 'node:fs';

const widget = readFileSync(new URL('../public/widget-worldmap.js', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../public/editor-worldmap.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// ── Behavioural: the real normShowRatings, extracted and evaluated ──
const m = widget.match(/function normShowRatings\(v\) \{[\s\S]*?\n  \}/);
ok('normShowRatings is defined in the widget', !!m);
let normShowRatings = () => { throw new Error('not loaded'); };
if (m) { normShowRatings = new Function(m[0] + '; return normShowRatings;')(); }

console.log('normShowRatings clamps to unique whole stars 1-5');
{
  ok('keeps valid stars', JSON.stringify(normShowRatings([4, 5])) === '[4,5]');
  ok('dedupes + sorts', JSON.stringify(normShowRatings([5, 4, 4])) === '[4,5]');
  ok('drops out-of-range + non-numbers', JSON.stringify(normShowRatings([0, 6, 3, 'x'])) === '[3]');
  ok('non-array → []', JSON.stringify(normShowRatings('nope')) === '[]');
}

// ── Behavioural: the filter semantics (mirrors the widget's _ratingShown) ──
const ratingShown = (cfg, o) => {
  const allow = cfg.showRatings;
  if (!Array.isArray(allow) || !allow.length) return true;
  if (!o || typeof o.rating !== 'number' || !isFinite(o.rating)) return true;
  return allow.indexOf(Math.round(o.rating)) !== -1;
};
console.log('The show-filter matches only ticked ratings, exempts ratingless');
{
  ok('empty list shows everything', ratingShown({ showRatings: [] }, { rating: 3 }) === true);
  ok('ticked rating shows', ratingShown({ showRatings: [4, 5] }, { rating: 4 }) === true);
  ok('unticked rating hides', ratingShown({ showRatings: [4, 5] }, { rating: 3 }) === false);
  ok('fractional rounds to nearest star', ratingShown({ showRatings: [4, 5] }, { rating: 4.5 }) === true);
  ok('ratingless offer is never hidden', ratingShown({ showRatings: [5] }, { rating: null }) === true);
}

console.log('Widget wiring');
{
  ok('DEFAULTS carries showRatings: []', /showRatings:\s*\[\],/.test(widget));
  ok('_ratingShown method exists with the same logic', /_ratingShown\(o\) \{[\s\S]*?allow\.indexOf\(Math\.round\(o\.rating\)\)/.test(widget));
  ok('showRatings normalised on construct + update',
    (widget.match(/this\.cfg\.showRatings = normShowRatings\(this\.cfg\.showRatings\);/g) || []).length === 2);
  ok('filter applied in both deal chains (country + resort drill-down)',
    (widget.match(/\.filter\(o => this\._ratingShown\(o\)\)/g) || []).length === 2);
  const vm = widget.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok('widget version >= 3.16.0', vm && (+vm[1] > 3 || (+vm[1] === 3 && +vm[2] >= 16)));
}

console.log('Editor wiring');
{
  ok('C default has showRatings: []', /showRatings:\s*\[\],/.test(editor));
  ok('star options are whole stars 2-5', /const STAR_OPTIONS = \[2, 3, 4, 5\];/.test(editor));
  ok('renders the pills + reads current set', /function renderRatings\(\)/.test(editor) && /function currentChosenRatings\(\)/.test(editor));
  ok('all-ticked stores [] (= all), none falls back to all',
    /set\.size === STAR_OPTIONS\.length\) \{\s*C\.showRatings = \[\]/.test(editor) && /set\.size === 0\) \{\s*C\.showRatings = \[\]/.test(editor));
  ok('syncControls renders the pills', /renderCuration\(\);\s*renderRatings\(\);/.test(editor));
  ok('pill container + delegated click wiring', /id="rating-pills"/.test(editor) && /getElementById\('rating-pills'\)\.addEventListener\('click'/.test(editor));
  ok('pill styles present', /\.tgwm-rating-pill \{/.test(editor) && /\.tgwm-rating-pill\[data-on="1"\]/.test(editor));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
