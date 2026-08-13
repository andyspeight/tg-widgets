/**
 * Offer builder — free-text Promo Badge (Andy, Aug 2026).
 *
 * Cruise lines sometimes need a specific offer referenced on the flash (e.g.
 * "€90 onboard spend per cabin"), which the fixed badge list can't express. Add
 * a "Custom text" badge option plus a free-text field, rendered on both the card
 * and the full offer page. Empty custom text shows no badge.
 *
 * Source-guards the wiring across the builder, card and page (the offer widgets
 * pull i18n/DOM helpers that don't run headless).
 *
 * Run: node test/offer-custom-badge-smoke.mjs  (npm run test:offer-custom-badge)
 */
import { readFileSync } from 'node:fs';

const BUILD = readFileSync(new URL('../public/widget-offer-builder.js', import.meta.url), 'utf8');
const CARD = readFileSync(new URL('../public/widget-offer-card.js', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('../public/widget-offer-page.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('Builder — the option and the free-text field');
{
  ok('"Custom text" is a badge option', /const BADGES = \[[^\]]*'Custom text'[^\]]*\];/.test(BUILD));
  ok('a badgeText field is in the tags/badge section', /field\('badgeText', 'Custom badge text', input\('badgeText'/.test(BUILD));
  ok('the field hints it is for the Custom text badge', /'\(for "Custom text"\)'/.test(BUILD));
  ok('badgeText persists (any \\[data-key\\] is collected on save)', /root\.querySelectorAll\('\[data-key\]'\)\.forEach\(\(el\) => \{\s*[\s\S]*?offer\.fields\[el\.dataset\.key\] = v;/.test(BUILD));
}

console.log('Card — renders the custom text, hides an empty one');
{
  ok('Custom text uses the badgeText field', /if \(badge === 'Custom text'\) \{\s*badgeText = this\._f\('badgeText'\) \|\| '';/.test(CARD));
  ok('the preset/Save path is kept for the other options', /badge === 'Save' && amt\) \? this\.t\('save'\) \+ ' ' \+ amt : badge/.test(CARD));
  ok('an empty badge renders nothing (existing guard)', /d\.badgeText \? '<span class="tgoc-badge">'/.test(CARD));
}

console.log('Page — same behaviour on the full offer page');
{
  ok('badgeText is carried into the page data', /badge: this\._f\('badge'\), badgeAmount: this\._f\('badgeAmount'\), badgeText: this\._f\('badgeText'\)/.test(PAGE));
  ok('Custom text renders badgeText, never the literal "Custom text"',
    /else if \(d\.badge === 'Custom text'\) \{ if \(d\.badgeText\) out\.push\('<span class="tgop-badge save">' \+ esc\(d\.badgeText\)/.test(PAGE));
  ok('the other presets still render their own label', /else if \(d\.badge && d\.badge !== 'No badge'\) out\.push\('<span class="tgop-badge save">' \+ esc\(d\.badge\)/.test(PAGE));
}

console.log('Versions bumped');
{
  const v = (s) => { const m = s.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/); return m ? [+m[1], +m[2], +m[3]] : null; };
  const ge = (a, b) => a && (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2]))));
  ok('builder >= 0.3.3', ge(v(BUILD), [0, 3, 3]));
  ok('card >= 0.2.2', ge(v(CARD), [0, 2, 2]));
  ok('page >= 0.4.2', ge(v(PAGE), [0, 4, 2]));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
