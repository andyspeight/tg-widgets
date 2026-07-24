/**
 * Enquiry Pro must not steal focus on a passive re-render (23 Jul 2026, client
 * report via Jess).
 *
 * The widget moved focus to the step heading on EVERY _renderStep after the
 * first — intended only for real forward/back navigation (a11y announce). But
 * the editor's live preview calls widget.update() on every keystroke, which
 * re-renders the same step and so yanked focus out of the editor field the agent
 * was typing into, forcing a re-click per letter. The fix focuses the heading
 * only when the step INDEX actually changed. This guards that invariant.
 *
 * Run: node test/enquirypro-focus-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const src = readFileSync(new URL('../public/widget-enquirypro.js', import.meta.url), 'utf8');

ok(/this\._focusedStep\s*!==\s*this\.S\.step/.test(src),
  'the step change is computed before focusing the heading');
ok(/if \(!firstRender && stepChanged\)[\s\S]{0,160}heading\.focus\(\)/.test(src),
  'heading.focus() runs ONLY on a real step change — not same-step re-renders or a passive update()');
// The bare unconditional `if (!firstRender) { ... heading.focus() }` must be gone.
ok(!/if \(!firstRender\)\s*\{\s*var heading/.test(src),
  'the old unconditional focus-on-every-render block is removed');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
