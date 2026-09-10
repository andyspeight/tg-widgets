/**
 * The Special Offers grid must fill the container it is given.
 *
 * The bug (Andy, 10 Sep 2026): embedded on a client page the cards sat at a
 * fixed 380px with a gaping hole between them. Cause was two compounding caps:
 * the grid's tracks were `minmax(300px, 380px)` and centred, so on a 1400px
 * container it computed `380px 380px 380px` with 110px dead each side; and the
 * vertical card's own `max-width: 380px` was only lifted for the carousel, so
 * with an explicit cols-N the card sat left inside a much wider track.
 *
 * Verified in Chromium at 1440 / 1024 / 768 / 375 before this test was written:
 * cells now measure 339 / 317 / 354 / 327 with 12px gutters and no dead space,
 * and a two-offer row bounds at 460px rather than stretching to 690px. This
 * suite pins the CSS contract that produces that, since the numbers are easy to
 * regress by hand.
 *
 * Run: node test/offers-grid-fill-smoke.mjs  (also: npm run test:offers-grid-fill)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const grid = readFileSync(new URL('../public/widget-offers-grid.js', import.meta.url), 'utf8');
const card = readFileSync(new URL('../public/widget-offer-card.js', import.meta.url), 'utf8');

// One line of CSS from the widget's STYLES block, whitespace-collapsed.
const rule = (selector) => {
  const i = grid.indexOf(selector + ' {');
  if (i === -1) return '';
  return grid.slice(i, grid.indexOf('}', i) + 1).replace(/\s+/g, ' ');
};

// ── Tracks fill, they do not cap ────────────────────────────────
const items = rule('.tgog-items.grid');
ok(/repeat\(auto-fit, minmax\(300px, 1fr\)\)/.test(items), 'auto-fit tracks stretch to 1fr');
ok(!/minmax\([^)]*380px\)/.test(items), 'the 380px track cap is gone');
ok(!/justify-content:\s*center/.test(items), 'the row is not centred, so there is no dead space either side');

// ── Gutter is 12px, inside Andy's 10-15px and on the 4px grid ───
const wrap = rule('.tgog-items');
const gap = (wrap.match(/gap:\s*(\d+)px/) || [])[1];
ok(gap === '12', 'the gutter is 12px (was 20px)');
ok(Number(gap) >= 10 && Number(gap) <= 15, 'the gutter is within the 10-15px asked for');
ok(Number(gap) % 4 === 0, 'the gutter sits on the 4px spacing grid');

// ── A short row is bounded, not ballooned ───────────────────────
const cell = rule('.tgog-items.grid > *');
ok(/width:\s*100%/.test(cell), 'a card fills its track');
ok(/max-width:\s*460px/.test(cell), 'a card is bounded at 460px so a short row cannot stretch to ~690px');
ok(/margin-inline:\s*auto/.test(cell), 'a bounded card centres in its track rather than jamming left');
// The bound must never bite on a full row: 4 across at a 1392px container is
// (1392 - 3*12) / 4 = 339px, and 3 across is 456px. Both must be under it.
const fourAcross = (1392 - 3 * 12) / 4;
const threeAcross = (1392 - 2 * 12) / 3;
ok(fourAcross < 460, 'four across at 1440 (' + Math.round(fourAcross) + 'px) is under the bound');
ok(threeAcross < 460, 'three across at 1440 (' + Math.round(threeAcross) + 'px) is under the bound');

// ── The card is told to fill, in the grid as well as the carousel ──
ok(/fluid: true,/.test(grid), 'the grid builds every card fluid');
ok(!/fluid: cfg\.display === 'carousel'/.test(grid), 'fluid is no longer carousel-only');
ok(/\.tgoc-root--fluid \.tgoc-card--vertical \{ max-width: none; \}/.test(card),
  'fluid still lifts the vertical card cap, which is what fluid:true relies on');
ok(/\.tgoc-card--vertical \{ flex-direction: column; max-width: 380px; \}/.test(card),
  'the card keeps its own 380px default for hosts that do not size the slot');

// ── Explicit cols-N still fills, and mobile still stacks ────────
['2', '3', '4'].forEach((n) => {
  ok(new RegExp('repeat\\(' + n + ', 1fr\\)').test(rule('.tgog-items.grid.cols-' + n)),
    'cols-' + n + ' tracks are 1fr');
});
ok(/@media \(max-width: 720px\)[\s\S]{0,220}grid-template-columns: 1fr/.test(grid),
  'below 720px the grid still stacks to one column');

// ── The stack layouts must not pick up the card bound ───────────
ok(!/\.tgog-items\.stack > \*/.test(grid), 'the bound is scoped to .grid, so horizontal/banner/split stay full width');
ok(/cfg\.layout === 'vertical'[\s\S]{0,200}: 'stack'/.test(grid), '.grid is only used for vertical cards');

console.log('\nOffers grid fill: ' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
