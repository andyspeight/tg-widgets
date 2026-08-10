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

// Widgets converted to container responsiveness. Extend as siblings land.
const WIDGETS = ['spotlight'];

for (const name of WIDGETS) {
  const src = readFileSync(new URL('../public/widget-' + name + '.js', import.meta.url), 'utf8');

  ok(/container-type:\s*inline-size/.test(src), name + ': root declares container-type: inline-size');
  ok(/container-name:\s*[a-z0-9-]+/i.test(src), name + ': root declares a container-name');
  ok(/@container\s+[a-z0-9-]+\s*\(/i.test(src), name + ': uses @container width breakpoints');

  // No VIEWPORT width breakpoints should remain for layout — they never fire for
  // an embedded widget. (prefers-reduced-motion / prefers-color-scheme are fine.)
  const viewportWidthMedia = src.match(/@media[^{]*\(\s*(?:max|min)-width/g) || [];
  ok(viewportWidthMedia.length === 0,
    name + ': no viewport width @media left (found ' + viewportWidthMedia.length + ')');

  // The "quick facts" style row must reflow, not force a fixed column count.
  // Assert there's at least one auto-fit grid (the reflow-able card rows).
  ok(/repeat\(\s*auto-fit\s*,\s*minmax\(/.test(src), name + ': has auto-fit card grid(s) that reflow to the container');
}

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
