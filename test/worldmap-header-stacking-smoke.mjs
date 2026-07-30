/**
 * World Map — the map must not paint over the host page's sticky header.
 *
 * The Leaflet panes, price pins (.tg-price-tag, z-index 1000) and map controls
 * resolved their z-index against the PAGE's root stacking context, because
 * nothing above .tgwm-map-wrap created one (.tgwm-map-wrap and .tgwm-root are
 * position:relative with no z-index, and :host is static). On a client site
 * whose sticky header had a lower z-index the map painted OVER the header's
 * logo, text and colour (Snow Dragon, 29 Jul 2026).
 *
 * Fix: .tgwm-map-wrap isolates its own stacking (isolation:isolate), so every
 * map z-index stays contained inside the widget. The fullscreen overlay is a
 * SIBLING of the map wrap (a child of .tgwm-root) and keeps its own
 * position:fixed max z-index, so it still covers the whole page when opened.
 *
 * Run: node test/worldmap-header-stacking-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const src = readFileSync(new URL('../public/widget-worldmap.js', import.meta.url), 'utf8');

// Pull the .tgwm-map-wrap rule block and assert it isolates its stacking.
const wrap = (src.match(/\.tgwm-map-wrap\s*\{[\s\S]*?\}/) || [])[0] || '';
ok(/isolation:\s*isolate/.test(wrap), '.tgwm-map-wrap isolates its stacking (isolation: isolate) so map z-indexes can\'t escape to the page header');
ok(/position:\s*relative/.test(wrap), '.tgwm-map-wrap stays position:relative (isolation is additive, not a reposition)');

// The fullscreen overlay MUST still escape above the page — it is a sibling of
// the map wrap, appended into .tgwm-root, and keeps its fixed max z-index.
ok(/\.tgwm-root'\)\.appendChild\(wrap\)/.test(src) || /appendChild\(wrap\)/.test(src),
  'the fullscreen overlay is appended as a sibling of the map wrap (inside .tgwm-root), so isolating the wrap does not trap it');
const overlay = (src.match(/\.tgwm-overlay\s*\{[\s\S]*?\}/) || [])[0] || '';
ok(/position:\s*fixed/.test(overlay), 'the fullscreen overlay stays position:fixed');
ok(/z-index:\s*2147483647/.test(overlay), 'the fullscreen overlay keeps its max z-index so it still covers the page when opened');

// The map wrap must NOT itself carry a high z-index (that would re-leak).
ok(!/\.tgwm-map-wrap\s*\{[^}]*z-index:\s*[1-9]/.test(src), '.tgwm-map-wrap does not set a positive z-index (isolation alone contains the stacking)');

const v = (src.match(/const VERSION = '(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);
ok(v.length === 3 && (v[0] > 3 || (v[0] === 3 && (v[1] > 13 || (v[1] === 13 && v[2] >= 1)))), `VERSION is at least 3.13.1 (is ${v.join('.')})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
