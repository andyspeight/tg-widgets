/**
 * Widgets fail QUIET on a client's live page (23 Jul 2026 audit #2/#5/#17).
 *
 * A broken or slow widget must hide or show a calm state, never paint a visible
 * error box on a client's homepage. Testimonials used to show a red "failed to
 * load" card; six others showed a grey "Unable to load X widget" box. This guards
 * the loud markup so it cannot return, and confirms the config fetches are bounded.
 *
 * Run: node test/quiet-failure-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

// None of these may assign an error box into the DOM on failure. We look for an
// innerHTML assignment that carries a loud "unable/failed to load" phrase — the
// i18n string DEFINITIONS (loadError: '...') have no innerHTML and are ignored.
const WIDGETS = ['testimonials', 'faq', 'currency', 'flighttime', 'spinwheel', 'worldclock', 'weather', 'statscounter', 'reviews'];
for (const w of WIDGETS) {
  const src = read(`public/widget-${w}.js`);
  ok(!/innerHTML[^;\n]{0,240}(Unable to load|failed to load|invalid configuration)/i.test(src),
    `widget-${w}: no visible error box rendered on failure`);
}

// Testimonials dropped its red error card and hides on both failure paths.
const t = read('public/widget-testimonials.js');
ok(!/#FEF2F2|#FECACA/.test(t), 'testimonials: red error card colours removed');
ok((t.match(/style\.display = 'none'/g) || []).length >= 2, 'testimonials: both failure paths hide quietly');

// Testimonials and reviews now bound their config fetch (they lacked a timeout).
for (const w of ['testimonials', 'reviews']) {
  const src = read(`public/widget-${w}.js`);
  ok(/ctrl\.abort\(\), 9000/.test(src) && /signal: ctrl\.signal/.test(src),
    `widget-${w}: config fetch is timeout-guarded`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
