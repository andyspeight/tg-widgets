/**
 * Content widgets — container responsiveness (Andy, 10 Aug 2026).
 *
 * The Spotlight widget (and its siblings: airport, attraction, weather, events)
 * are embedded on customer pages, often in a column far narrower than the
 * browser window. They used viewport @media breakpoints and fixed-column grids,
 * so the breakpoints never fired for the container and the "At a glance" facts
 * row overflowed. The fix makes each widget a CSS container (container-type:
 * inline-size) and moves its width breakpoints to @container, with the card rows
 * on auto-fit so they reflow to the container width.
 *
 * This guards that each converted widget:
 *   - declares container-type: inline-size on its root,
 *   - uses @container (not viewport @media) for its width breakpoints,
 *   - has no fixed repeat(N, 1fr) column grid left inside a @media (max-width)
 *     block (those are the ones that used to overflow).
 *
 * Widgets are added to WIDGETS as they are converted.
 *
 * Run: node test/content-widgets-responsive-smoke.mjs  (also: npm run test:responsive)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// Widgets converted to container responsiveness. `viewportWidth` is how many
// viewport width @media blocks may LEGITIMATELY remain: 0 for a plain content
// widget, but a widget with a full-VIEWPORT overlay (Events' fullscreen modal)
// keeps a viewport breakpoint for that overlay, which sits outside the container.
const WIDGETS = [
  { name: 'spotlight', viewportWidth: 0 },
  { name: 'airport', viewportWidth: 0 },
  { name: 'attraction', viewportWidth: 0 },
  { name: 'weather', viewportWidth: 0 },
  { name: 'events', viewportWidth: 1 },
];

for (const { name, viewportWidth } of WIDGETS) {
  const src = readFileSync(new URL('../public/widget-' + name + '.js', import.meta.url), 'utf8');

  ok(/container-type:\s*inline-size/.test(src), name + ': declares container-type: inline-size');
  ok(/container-name:\s*[a-z0-9-]+/i.test(src), name + ': declares a container-name');
  ok(/@container\s+[a-z0-9-]+\s*\(/i.test(src), name + ': uses @container width breakpoints');

  // Layout breakpoints must be @container, not viewport @media (which never fire
  // for an embedded widget). prefers-reduced-motion / prefers-color-scheme are
  // fine; a documented allowance covers a full-viewport overlay's own breakpoint.
  const viewportWidthMedia = src.match(/@media[^{]*\(\s*(?:max|min)-width/g) || [];
  ok(viewportWidthMedia.length <= viewportWidth,
    name + ': viewport width @media within allowance (' + viewportWidthMedia.length + ' <= ' + viewportWidth + ')');
}
// An auto-fit card grid is asserted per-widget only where the widget HAD a
// reflow-able fixed card row (spotlight, airport below). Weather's only fixed
// grids are its 12-month climate chart (must stay 12 across) and Events already
// used auto-fill, so they respond via @container without new auto-fit grids.

// Spotlight specifics — the facts row was the reported overflow.
{
  const s = readFileSync(new URL('../public/widget-spotlight.js', import.meta.url), 'utf8');
  const facts = s.slice(s.indexOf('.tgs-facts {'), s.indexOf('.tgs-facts {') + 400);
  ok(/repeat\(\s*auto-fit\s*,\s*minmax\(150px/.test(facts), 'spotlight: .tgs-facts is auto-fit (was fixed 5-col)');
  const highlights = s.slice(s.indexOf('.tgs-highlights {'), s.indexOf('.tgs-highlights {') + 300);
  ok(/repeat\(\s*auto-fit\s*,\s*minmax\(/.test(highlights), 'spotlight: .tgs-highlights is auto-fit (was fixed 3-col)');
  const vm = s.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok(vm && (+vm[1] > 1 || (+vm[1] === 1 && +vm[2] >= 5)), 'spotlight: version at or beyond 1.5');
}

// Airport + attraction: the quick-facts row was the fixed grid that overflowed.
for (const [name, cls] of [['airport', '.tga-facts'], ['attraction', '.tgx-facts']]) {
  const s = readFileSync(new URL('../public/widget-' + name + '.js', import.meta.url), 'utf8');
  const i = s.indexOf(cls + ' {');
  const block = i >= 0 ? s.slice(i, i + 400) : '';
  ok(/repeat\(\s*auto-fit\s*,\s*minmax\(/.test(block), name + ': ' + cls + ' reflows via auto-fit');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
