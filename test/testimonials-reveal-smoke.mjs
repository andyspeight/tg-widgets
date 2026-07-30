/**
 * Testimonials — progressive reveal on grid and masonry.
 *
 * A client with thirty testimonials had no way to show a taste of them without
 * burying the rest of the page. `reveal.rows` sets how many rows appear first;
 * a button opens `reveal.step` more rows per press.
 *
 * The two things this guards, because both are silent when they break:
 *
 *  1. A ROW IS NOT A FIXED NUMBER OF CARDS. Both layouts are responsive — 3
 *     columns on a desktop, 1 on a phone. Deriving the row size from gridCols
 *     would reveal three cards at a time on a phone that shows one per row, so
 *     the widget reads the column count off the layout the browser actually
 *     rendered. A regression here looks fine on a laptop and wrong on a phone.
 *
 *  2. AN EXPLICIT `display` BEATS `[hidden]`. `.tgt-reveal` is display:flex and
 *     `.tgt-card` is display:flex / inline-block, so setting the hidden property
 *     alone has NO visual effect — the cards stay on screen and a "Show less"
 *     button sits under a list with nothing hidden. Caught by screenshotting;
 *     a probe reading `el.hidden` reports success either way.
 *
 * Verified separately by driving the real widget in Chromium at 1280px and
 * 390px: 3 columns reveal 3 at a time and 1 column reveals 1, Back collapses,
 * focus stays on the button across presses, the live region only speaks after a
 * press, and no button appears when everything already fits.
 *
 * Run: node test/testimonials-reveal-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const W = readFileSync(new URL('../public/widget-testimonials.js', import.meta.url), 'utf8');
const ED = readFileSync(new URL('../public/editor-testimonials.html', import.meta.url), 'utf8');


// Anchor on the 4-space-indented DEFINITIONS. The bare names also appear at
// their call sites inside render(), which comes first in the file and would
// silently invert every slice below.
const defn = (name) => {
  const at = W.indexOf('\n    ' + name);
  if (at < 0) throw new Error('definition not found: ' + name);
  return at;
};

// ── Off by default ───────────────────────────────────────────────────────────
// An existing widget picking up this version must not change what it shows.
ok(/reveal: \{[\s\S]{0,200}rows: 0,/.test(W), 'reveal.rows defaults to 0 (off)');
ok(/reveal: \{ rows: 0,/.test(ED), 'the editor default is off too');
ok(/_revealActive\(\) \{[\s\S]{0,300}return this\.c\.reveal\.rows > 0;/.test(W),
  'rows is the single on/off source — no second enabled flag to drift out of step');

// ── Only the layouts that have rows ──────────────────────────────────────────
const active = W.slice(defn('_revealActive() {'), defn('_renderReveal(list) {'));
ok(/layout !== 'grid' && this\.c\.layout !== 'masonry'/.test(active),
  'reveal is limited to grid and masonry');

// ── The row size is measured, never assumed ──────────────────────────────────
const perRow = W.slice(defn('_perRow(listEl) {'), defn('_applyReveal() {'));
ok(/getComputedStyle\(listEl\)/.test(perRow), 'the column count is read from the rendered layout');
ok(/cs\.columnCount/.test(perRow), 'masonry uses its computed column-count');
ok(/gridTemplateColumns/.test(perRow), 'grid counts its computed tracks');
ok(!/gridCols/.test(perRow), 'the row size is NOT derived from gridCols (that breaks on mobile)');
ok(/return Number\.isFinite\(n\) && n > 0 \? n : 1;/.test(perRow), 'an unreadable layout falls back to 1 per row, never 0');
// A 0 would make visible = rows * 0 = 0 and blank the widget.
ok(/let n = 1;/.test(perRow), 'the default before measuring is 1, not 0');

// ── Hiding actually hides ────────────────────────────────────────────────────
ok(/\.tgt-card\[hidden\] \{ display: none !important; \}/.test(W),
  'a hidden card is forced to display:none (its own display would win otherwise)');
ok(/\.tgt-reveal\[hidden\] \{ display: none !important; \}/.test(W),
  'a hidden reveal wrapper is forced to display:none — display:flex beats [hidden]');

// ── The button says what pressing it does ────────────────────────────────────
const apply = W.slice(defn('_applyReveal() {'), defn('_filtered() {'));
ok(/const allShown = visible >= cards\.length;/.test(apply), 'it knows when everything is on screen');
ok(/wrap\.hidden = allShown && !canCollapse;/.test(apply), 'no button once there is nothing left to do');
ok(/canCollapse = allShown && this\.c\.reveal\.showLess && cards\.length > this\.c\.reveal\.rows \* perRow/.test(apply),
  'collapse is only offered when the list was genuinely longer than the opening rows');
ok(/btn\.setAttribute\('data-dir', more \? 'more' : 'less'\)/.test(apply), 'the direction flips with the state');
ok(/this\.c\.reveal\.moreLabel \|\| this\.t\('showMore'\)/.test(apply), 'a custom label wins, otherwise the localised default');
ok(/this\.c\.reveal\.lessLabel \|\| this\.t\('showLess'\)/.test(apply), 'same for the collapse label');

// ── Accessibility ────────────────────────────────────────────────────────────
ok(/aria-controls="tgt-list"/.test(W), 'the button points at the list it controls');
ok(/id="tgt-list"/.test(W), 'both layouts carry that id');
ok((W.match(/id="tgt-list"/g) || []).length >= 2, 'grid AND masonry, or aria-controls dangles on one of them');
ok(/role="status" aria-live="polite"/.test(W), 'the count change is announced');
ok(/if \(status && this\.state\.revealTouched\)/.test(apply),
  'the live region stays quiet until the visitor presses something (no unprompted announcement on load)');
ok(/clip-path: inset\(50%\)/.test(W), 'the status text is visually hidden, not display:none (which would silence it)');
ok(/min-height: 44px/.test(W.slice(W.indexOf('.tgt-reveal-btn'))), 'the button meets the 44px touch target');
ok(/\.tgt-reveal-btn:focus-visible/.test(W), 'the button has a visible focus ring');
ok(/prefers-reduced-motion: reduce[\s\S]{0,120}tgt-reveal-arrow/.test(W), 'the chevron animation respects reduced motion');

// ── The render rule: a press must not throw focus away ───────────────────────
// A full re-render would destroy the button mid-click and drop focus to the top
// of the document — the repo-wide focus rule, and plain bad manners.
const bind = W.slice(W.indexOf("const revealBtn = this.root.querySelector('[data-reveal-btn]')"));
const clickHandler = bind.slice(0, bind.indexOf('// The column count changes'));
ok(/this\._applyReveal\(\);/.test(clickHandler), 'pressing re-applies in place');
ok(!/this\.render\(\)/.test(clickHandler), 'pressing does NOT re-render (that would drop focus)');
ok(/this\.state\.revealTouched = true;/.test(clickHandler), 'a press is recorded so the live region may speak');

// ── Responsive: a resize changes what a row is ───────────────────────────────
ok(/ResizeObserver/.test(W), 'the reveal re-applies when the widget is resized');
ok(/this\._revealRO\.disconnect\(\)/.test(W), 'the observer is disconnected on destroy (it holds the instance)');
ok(/if \(this\.host && !this\.host\.isConnected\) \{ this\.destroy\(\); return; \}[\s\S]{0,80}_applyReveal/.test(W),
  'the observer self-destructs if the host was removed without destroy() (SPA client sites)');

// ── Filtering resets the reveal ──────────────────────────────────────────────
ok(/this\.state\.revealRows = 0;[\s\S]{0,80}this\.state\.revealTouched = false;[\s\S]{0,40}this\.render\(\);/.test(W),
  'changing the trip-type chip collapses back to the opening rows');

// ── Config is bounded ────────────────────────────────────────────────────────
ok(/merged\.reveal\.rows = clamp\(Math\.round\(Number\(merged\.reveal\.rows\) \|\| 0\), 0, 50\)/.test(W), 'rows is clamped');
ok(/merged\.reveal\.step = clamp\(Math\.round\(Number\(merged\.reveal\.step\) \|\| 1\), 1, 50\)/.test(W),
  'step is at least 1 — a step of 0 would make the button do nothing and look broken');
ok(/merged\.reveal\.moreLabel = String\(merged\.reveal\.moreLabel \|\| ''\)\.trim\(\)\.slice\(0, 60\)/.test(W), 'labels are bounded strings');
ok(/reveal: \{ \.\.\.DEFAULT_CONFIG\.reveal, \.\.\.\(u\.reveal \|\| \{\}\) \}/.test(W),
  'a partial reveal config is filled from the defaults, not left with holes');
// Labels are author-controlled config going into markup.
ok(/esc\(this\.c\.reveal\.moreLabel \|\| this\.t\('showMore'\)\)/.test(W), 'the label is escaped into the initial markup');
ok(/label\.textContent =/.test(apply), 'later label updates use textContent, not innerHTML');

// ── i18n ─────────────────────────────────────────────────────────────────────
const langs = ['en', 'fr', 'de', 'es', 'it', 'ro'];
for (const l of langs) {
  const line = (W.match(new RegExp('\\n    ' + l + ': \\{[^\\n]*')) || [''])[0];
  ok(/showMore:/.test(line), `${l} has showMore`);
  ok(/showLess:/.test(line), `${l} has showLess`);
  ok(/showingOf:/.test(line) && /\{n\}/.test(line) && /\{total\}/.test(line), `${l} has showingOf with both counts`);
}

// ── Editor ───────────────────────────────────────────────────────────────────
ok(/data-toggle-reveal/.test(ED), 'the editor has an on/off switch');
ok(/cfg\.reveal\.rows = cfg\.reveal\.rows > 0 \? 0 : 2;/.test(ED), 'switching on picks a sensible 2 rows');
ok(/data-slider="reveal\.rows"/.test(ED) && /data-slider="reveal\.step"/.test(ED), 'rows and step are adjustable');
ok(/data-set="reveal\.moreLabel"/.test(ED) && /data-set="reveal\.lessLabel"/.test(ED), 'both labels are editable');
ok(/data-toggle="reveal\.showLess" data-rerender/.test(ED), 'the collapse switch rebuilds the panel to show or hide its text field');
ok(/if \(el\.hasAttribute\('data-rerender'\)\) renderTabBody\(\);/.test(ED), 'the rerender marker is honoured');
ok(/c\.layout === 'grid' \|\| c\.layout === 'masonry'/.test(ED), 'the controls only appear for grid and masonry');
ok(/already fit in the first/.test(ED),
  'an agent whose list already fits is told why nothing changed, rather than left guessing');
// The slider readout was formatting every non-time slider as px/s, so the
// reveal sliders read "2px/s".
ok(/const UNITS = \{/.test(ED), 'slider units are per-slider, not a two-way guess');
ok(/'marquee\.speed': \(n\) => n \+ 'px\/s'/.test(ED), 'px/s belongs to the marquee speed alone');
ok(/querySelector\('\.field-label \.field-hint'\)/.test(ED),
  'only the inline label hint is rewritten, never the explanatory paragraph below the slider');
ok(!/\beval\s*\(/.test(ED) && !/new Function/.test(ED), 'no eval in the editor');

// ── Version ──────────────────────────────────────────────────────────────────
const v = (W.match(/const VERSION = '(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);
ok(v.length === 3 && (v[0] > 1 || v[1] >= 1), `VERSION is at least 1.1.0 (is ${v.join('.')})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
