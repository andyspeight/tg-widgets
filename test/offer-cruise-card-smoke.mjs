/**
 * Special Offers — cruise card layout (Andy, 10 Aug 2026, client design).
 *
 * A new selectable card design ("cruise"): stacked ribbon flags (promo / type /
 * style), a "N Nights From £X per person" headline, up to three icon feature
 * rows from the includes, and a "View holiday details" link. Additive — the
 * existing vertical/horizontal/banner/split layouts are untouched.
 *
 * Source guards (jsdom isn't available here): the whitelist, the builder, the
 * render branch, the ribbon/feature/CTA markup and the styles.
 *
 * Run: node test/offer-cruise-card-smoke.mjs  (also: npm run test:offer-cruise-card)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const card = readFileSync(new URL('../public/widget-offer-card.js', import.meta.url), 'utf8');
const grid = readFileSync(new URL('../public/widget-offers-grid.js', import.meta.url), 'utf8');

// Selectable, additive layout.
ok(/const layouts = \['vertical', 'horizontal', 'banner', 'split', 'cruise'\]/.test(card), 'card whitelists the cruise layout (keeps the originals)');
ok(/const layouts = \['vertical', 'horizontal', 'banner', 'split', 'cruise'\]/.test(grid), 'grid whitelists the cruise layout too');

// Builder + render branch.
ok(/_cruiseCard\(d\) \{/.test(card), '_cruiseCard builder defined');
ok(/if \(cfg\.layout === 'cruise'\) \{\s*inner = this\._cruiseCard\(d\)/.test(card), 'render routes the cruise layout to _cruiseCard');

// Ribbons: promo (featured), type, style (luxury), each gated on its field.
{
  const b = card.slice(card.indexOf('_cruiseCard(d) {'), card.indexOf('_render() {'));
  ok(/tgoc-ribbon--featured/.test(b) && /d\.badgeText/.test(b), 'promo ribbon shown when a badge is set');
  ok(/tgoc-ribbon--type/.test(b) && /shortType\(this\._f\('type'\)\)/.test(b), 'type ribbon from the offer type');
  ok(/tgoc-ribbon--luxury/.test(b) && /this\._f\('style'\)/.test(b), 'style ribbon from the offer style');
  ok(/this\.t\('from'\)/.test(b) && /this\._f\('nights'\)/.test(b) && /this\._f\('basis'\)/.test(b), 'headline built from nights + from + price + basis');
  ok(/\(d\.includes \|\| \[\]\)\.slice\(0, 3\)/.test(b), 'up to three feature rows from the includes');
  ok(/FEAT_ICONS\[i % FEAT_ICONS\.length\]/.test(b), 'feature rows get rotating icons');
  ok(/this\.cfg\.ctaText \|\| this\.t\('viewHolidayDetails'\)/.test(b), 'CTA defaults to "View holiday details"');
}

// i18n.
ok(/viewHolidayDetails: 'View holiday details'/.test(card) && /from: 'From'/.test(card), 'new labels present');

// Styles.
ok(/\.tgoc-card--cruise \{/.test(card) && /\.tgoc-ribbon \{/.test(card) && /\.tgoc-c-cta \{/.test(card), 'cruise styles present');
ok(/clip-path: polygon/.test(card), 'ribbon flag shape via clip-path');

// Version.
{
  const vm = card.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok(vm && (+vm[1] > 0 || (+vm[1] === 0 && +vm[2] >= 2)), 'card version at or beyond 0.2');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
