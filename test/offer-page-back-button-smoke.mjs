/**
 * Special Offer Page — "Back to offers" control (Andy, 10 Aug 2026).
 *
 * The full offer page gains a browser-Back control: a floating pill over the hero
 * plus an icon twin in the sticky bar. It only renders when there IS history to
 * go back to (same-tab arrival from the offers grid); a directly-opened or
 * new-tab link has none, so the button is hidden rather than dead. Clicking calls
 * window.history.back().
 *
 * Source guards (jsdom isn't available here, and history.length can't be driven
 * in Node) — they pin the gating, the markup, the wiring and the styles.
 *
 * Run: node test/offer-page-back-button-smoke.mjs  (also: npm run test:offer-page-back)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const src = readFileSync(new URL('../public/widget-offer-page.js', import.meta.url), 'utf8');

// Label
ok(/backToOffers: 'Back to offers'/.test(src), 'label present in MESSAGES');

// Gating: only when there is somewhere to go back to.
ok(/const canBack = typeof window !== 'undefined' && window\.history && window\.history\.length > 1/.test(src),
  'canBack gated on history.length > 1');

// Floating pill markup, gated on canBack, carrying data-back.
ok(/const fBack = canBack[\s\S]{0,160}class="tgop-back" data-back/.test(src), 'floating back pill built only when canBack');
ok(/root\.innerHTML = fBack \+ html/.test(src), 'floating pill prepended to every template');

// Sticky-bar twin, gated on canBack.
ok(/canBack \? '<button type="button" class="tgop-bar-back" data-back/.test(src), 'sticky-bar back twin gated on canBack');

// Wiring: both [data-back] controls call history.back(), guarded so it never
// no-ops the visitor off-site.
{
  const bind = src.slice(src.indexOf('_bind(d)'));
  ok(/querySelectorAll\('\[data-back\]'\)\.forEach/.test(bind.slice(0, 1200)), 'both back controls wired via [data-back]');
  ok(/window\.history\.length > 1\) window\.history\.back\(\)/.test(bind.slice(0, 1200)), 'click calls history.back() behind the length guard');
  ok(/backFloat\.classList\.toggle\('hide', past\)/.test(bind.slice(0, 1600)), 'floating pill hides as the sticky bar slides in');
}

// Styles for both controls.
ok(/\.tgop-back \{/.test(src) && /\.tgop-back\.hide \{/.test(src), 'floating pill + hidden-state styles present');
ok(/\.tgop-bar-back \{/.test(src), 'sticky-bar back button styles present');

// Version bump.
{
  const vm = src.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok(vm && (+vm[1] > 0 || (+vm[1] === 0 && +vm[2] >= 2)), 'version at or beyond 0.2');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
