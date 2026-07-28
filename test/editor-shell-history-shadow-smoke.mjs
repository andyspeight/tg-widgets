/**
 * Editor shell — the post-save URL sync must survive an editor shadowing
 * `window.history`.
 *
 * Editors load as CLASSIC (non-module) scripts, so a top-level `let history`
 * in an editor shares the page's global lexical scope and SHADOWS window.history
 * for the shared shell. The weather and spotlight editors both keep such a
 * `history` array for their undo stack. When the shell's doSave used the bare
 * global `history.replaceState`, it hit that array, threw, was swallowed by the
 * surrounding try/catch, and the URL never picked up the widgetId the CREATE
 * returned. Result (Halal World Travel weather, 28 Jul 2026):
 *   - the embed modal reads the id off the URL → stayed empty until reload
 *   - every subsequent save read no id off the URL → CREATED a new record each
 *     time instead of updating the one being edited (duplicate widgets)
 *
 * The shell must therefore use window.history / window.location explicitly.
 * These guards keep it that way and document why the editors' `let history`
 * makes it necessary.
 *
 * Run: node test/editor-shell-history-shadow-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const shell = readFileSync(new URL('../public/editor-shell.js', import.meta.url), 'utf8');

// ── The shell must window-qualify the post-save URL sync ──────────────────────
ok(/window\.history\.replaceState\(/.test(shell), 'doSave uses window.history.replaceState (shadow-safe)');
ok(/new URL\(window\.location/.test(shell), 'doSave builds the URL from window.location (shadow-safe)');

// No BARE history.replaceState anywhere — that is the exact call an editor's
// `let history` array shadows. (Negative lookbehind: allow window.history. and
// foo.history. , reject a bare/global `history.replaceState`.)
ok(!/(?<![.\w])history\.replaceState\s*\(/.test(shell), 'no bare history.replaceState(...) call survives in the shell (the shadowable call)');
// And the bare `new URL(location)` form is gone too.
ok(!/new URL\(location\)/.test(shell), 'no bare new URL(location) survives in the shell');

// Version bumped so the deploy is identifiable.
const m = shell.match(/Unified Shell JS v(\d+)\.(\d+)\.(\d+)/);
const v = m ? m.slice(1).map(Number) : null;
ok(v && (v[0] > 1 || (v[0] === 1 && (v[1] > 2 || (v[1] === 2 && v[2] >= 2)))), `shell version >= 1.2.2 (is ${v ? v.join('.') : 'unknown'})`);

// ── Document the coupling: the editors that DO shadow window.history ──────────
// If these editors ever drop their `let history`, this test still passes (the
// shell fix is independent) — but while they have it, the shell MUST stay
// window-qualified, which the guards above enforce.
for (const ed of ['editor-weather.html', 'editor-spotlight.html']) {
  const src = readFileSync(new URL('../public/' + ed, import.meta.url), 'utf8');
  const shadows = /\n\s*let history\s*=/.test(src) || /\n\s*var history\s*=/.test(src);
  ok(shadows, `${ed} declares a top-level history binding (the reason the shell must be window-qualified)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
