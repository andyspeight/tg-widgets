/**
 * Special Offers grid — card images + centred layout (Andy, Aug 2026).
 *
 * Two fixes after the grid started rendering:
 *   1. The builder stores photos in offer.images[] (first = cover), but the card
 *      read only the scalar fields.image / o.image, so every builder-made offer
 *      fell back to the gradient placeholder. The card now also reads images[0].
 *   2. The grid used auto-fill, which leaves empty phantom columns on a wide
 *      page, packing a short row of cards to the left. It now uses auto-fit with
 *      justify-content:center so the row centres.
 *
 * Source-guards both (the card image resolution + the grid layout), and checks
 * the explicit column modes are untouched.
 *
 * Run: node test/offer-card-image-grid-smoke.mjs  (npm run test:offer-card-image-grid)
 */
import { readFileSync } from 'node:fs';

const CARD = readFileSync(new URL('../public/widget-offer-card.js', import.meta.url), 'utf8');
const GRID = readFileSync(new URL('../public/widget-offers-grid.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The card finds its cover image in the images[] array');
{
  ok('image resolves fields.image / o.image / images[0]',
    /image: safeUrl\(this\._f\('image'\) \|\| o\.image \|\| \(Array\.isArray\(o\.images\) \? o\.images\[0\] : ''\)\)/.test(CARD));
  ok('the scalar fields.image path is kept first (legacy/flat offers)',
    /this\._f\('image'\) \|\| o\.image/.test(CARD));
}

console.log('The grid centres a short row instead of packing it left');
{
  ok('the base grid uses auto-fit (collapses empty columns)',
    /\.tgog-items\.grid \{ grid-template-columns: repeat\(auto-fit, minmax\(300px, 380px\)\); justify-content: center; \}/.test(GRID));
  ok('the left-packing auto-fill rule is gone', !/repeat\(auto-fill/.test(GRID));
  ok('the track cap matches the card max-width (380px)', /minmax\(300px, 380px\)/.test(GRID));
}

console.log("Each offer shows its OWN saved currency, not the widget's");
{
  ok('the card resolves the symbol from the offer currency first',
    /currencySymbol\(o\.currency \|\| this\.cfg\.currency \|\| 'GBP'\)/.test(CARD));
  ok('the grid passes the offer currency to the card first',
    /currency: \(offer && offer\.currency\) \|\| cfg\.currency \|\| 'GBP'/.test(GRID));
  ok('EUR maps to the euro symbol', /EUR: '€'/.test(CARD));
}

console.log('Cards fill the grid cell so a row is equal height');
{
  ok('the card is set to height:100% to fill its stretched cell', /\.tgoc-card \{[\s\S]*?height: 100%;[\s\S]*?\}/.test(CARD));
  ok('the vertical footer still pins to the bottom (margin-top:auto)', /\.tgoc-card--vertical \.tgoc-foot \{[\s\S]*?margin-top: auto;/.test(CARD));
}

console.log('Explicit column modes are unchanged (no regression)');
{
  ok('cols-2 still fills the width', /\.tgog-items\.grid\.cols-2 \{ grid-template-columns: repeat\(2, 1fr\); \}/.test(GRID));
  ok('cols-3 still fills the width', /\.tgog-items\.grid\.cols-3 \{ grid-template-columns: repeat\(3, 1fr\); \}/.test(GRID));
  ok('cols-4 still fills the width', /\.tgog-items\.grid\.cols-4 \{ grid-template-columns: repeat\(4, 1fr\); \}/.test(GRID));
  ok('stack mode (non-vertical layouts) still single column', /\.tgog-items\.stack \{ grid-template-columns: 1fr; \}/.test(GRID));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
