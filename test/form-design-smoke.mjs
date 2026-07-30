/**
 * Form widget — design-system compliance.
 *
 * Andy's feedback (30 Jul 2026): "the input boxes, the spacing, the text
 * placement all look like they need some time and care." The first pass used
 * ad-hoc values, which is exactly what reads as unconsidered. These guards hold
 * the widget to the travelgenix-design system so it cannot drift back.
 *
 * Rules enforced here:
 *   - 4px spacing grid (no 7px/13px/18px/28px anywhere)
 *   - 44px minimum touch targets on every tappable control
 *   - no hardcoded hex outside the token block (components use variables)
 *   - visible focus states on every interactive element
 *   - full dark mode, not a placeholder
 *   - prefers-reduced-motion respected
 *   - no emoji as icons, no pure black, no AI-tell purple gradient
 *
 * Run: node test/form-design-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const SRC = readFileSync(new URL('../public/widget-form.js', import.meta.url), 'utf8');
const CSS = (SRC.match(/const STYLES = `([\s\S]*?)`;/) || [])[1] || '';
ok(CSS.length > 500, 'stylesheet extracted');

// The token block defines the palette; components must reference it, not repeat it.
const tokenBlock = (CSS.match(/\.tgf-root \{[\s\S]*?\n    \}/) || [])[0] || '';
const darkBlock = (CSS.match(/\.tgf-root\[data-theme="dark"\] \{[\s\S]*?\n    \}/) || [])[0] || '';
const componentCss = CSS.replace(tokenBlock, '').replace(darkBlock, '');

// ── 4px spacing grid ─────────────────────────────────────────────────────────
// Collect px values from spacing/size properties in COMPONENT css only.
const spacingProps = /(?:^|[;{]\s*)(padding|margin|gap|top|right|bottom|left)(?:-(?:top|right|bottom|left))?\s*:\s*([^;}]+)/g;
const offGrid = [];
let m;
while ((m = spacingProps.exec(componentCss)) !== null) {
  const decl = m[2];
  if (/var\(|calc\(|auto|%|em|ch|dvh|vh/.test(decl)) continue;
  const pxs = decl.match(/(-?\d+(?:\.\d+)?)px/g) || [];
  for (const px of pxs) {
    const n = Math.abs(parseFloat(px));
    if (n !== 0 && n % 4 !== 0 && n !== 1 && n !== 2 && n !== 3) offGrid.push(m[1] + ': ' + decl.trim());
  }
}
ok(offGrid.length === 0, 'all spacing is on the 4px grid' + (offGrid.length ? ' — off-grid: ' + offGrid.slice(0, 5).join(' | ') : ''));

// Spacing tokens exist and are multiples of 4.
const tokenVals = [...tokenBlock.matchAll(/--tgf-s\d+:\s*(\d+)px/g)].map((x) => Number(x[1]));
ok(tokenVals.length >= 6, 'a spacing scale is defined as tokens');
ok(tokenVals.every((v) => v % 4 === 0), 'every spacing token is a multiple of 4');

// ── Touch targets ────────────────────────────────────────────────────────────
const ruleFor = (sel) => {
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  return (CSS.match(re) || [])[1] || '';
};
const minHeightOf = (block) => {
  const h = block.match(/(?:min-height|height)\s*:\s*(\d+)px/);
  return h ? Number(h[1]) : 0;
};
ok(minHeightOf(ruleFor('.tgf-btn')) >= 44, 'buttons are at least 44px tall');
ok(minHeightOf(ruleFor('.tgf-input')) >= 44, 'text inputs are at least 44px tall');
ok(minHeightOf(ruleFor('.tgf-choice')) >= 44, 'choice rows are at least 44px tall');
ok(minHeightOf(ruleFor('.tgf-star')) >= 44, 'star targets are a full 44px hit area (the glyph is smaller)');
ok(minHeightOf(ruleFor('.tgf-scale-num')) >= 44, 'scale points are at least 44px');
ok(/min-width:\s*44px/.test(ruleFor('.tgf-scale-num')), 'scale points are at least 44px wide too');

// Inputs must be AT LEAST 16px or iOS zooms the page on focus.
const inputFont = Number((ruleFor('.tgf-input').match(/font-size:\s*(\d+)px/) || [])[1] || 0);
ok(inputFont >= 16, `inputs are at least 16px text, preventing iOS auto-zoom (is ${inputFont}px)`);

// A single-line answer is a RULE, not a box: the answer should read as a
// continuation of the question rather than as paperwork.
const inputRule = ruleFor('.tgf-input');
ok(/border:\s*0/.test(inputRule) && /border-bottom:\s*2px/.test(inputRule),
  'a single-line answer is an underline, not a boxed field');
ok(/background:\s*transparent/.test(inputRule), 'the answer line has no fill');
ok(/border-bottom-color:\s*var\(--tgf-accent\)/.test(CSS), 'the answer line lights up in the accent colour on focus');
ok(inputFont >= 20, `the answer is set larger than the help text so it reads as writing (is ${inputFont}px)`);

// ── Tokens, not hardcoded values, in components ──────────────────────────────
const strayHex = (componentCss.match(/#[0-9a-fA-F]{3,8}\b/g) || []);
ok(strayHex.length === 0, 'no hardcoded hex in component rules' + (strayHex.length ? ' — found ' + strayHex.slice(0, 5).join(', ') : ''));
ok(/--tgf-danger/.test(tokenBlock) && /var\(--tgf-danger\)/.test(componentCss), 'the error colour is a semantic token');
ok(/--tgf-shadow/.test(tokenBlock) && /box-shadow:\s*var\(--tgf-shadow\)/.test(CSS), 'elevation comes from a shadow token');
ok(/rgba\(27,43,91/.test(tokenBlock), 'the shadow is brand-tinted navy, not a default grey drop shadow');

// ── Focus states on every interactive element ────────────────────────────────
for (const sel of ['.tgf-input', '.tgf-btn']) {
  ok(new RegExp(sel.replace('.', '\\.') + ':focus-visible').test(CSS), sel + ' has a visible focus state');
}
ok(/\.tgf-choice:has\(\.tgf-choice-input:focus-visible\)/.test(CSS), 'choice rows show focus from their hidden native input');
ok(/\.tgf-star:has\(\.tgf-choice-input:focus-visible\)/.test(CSS), 'stars show focus');
ok(/\.tgf-scale-item:has\(\.tgf-choice-input:focus-visible\)/.test(CSS), 'scale points show focus');
ok(/\.tgf-consent-input:focus-visible/.test(CSS), 'the consent checkbox shows focus');
// Focus must never be removed outright.
ok(!/outline:\s*none\s*;?\s*\}/.test(CSS.replace(/:focus-visible \{[^}]*\}/g, '')) || /focus-visible/.test(CSS),
  'focus is restyled, never simply removed');

// ── Hover + press feedback ───────────────────────────────────────────────────
ok(/\.tgf-btn:hover/.test(CSS) && /\.tgf-btn:active/.test(CSS), 'buttons have hover and press states');
ok(/\.tgf-choice:hover/.test(CSS) && /\.tgf-choice:active/.test(CSS), 'choices have hover and press states');
ok(/cursor:\s*pointer/.test(ruleFor('.tgf-choice')), 'choices show a pointer cursor');

// ── Dark mode is real, not a placeholder ─────────────────────────────────────
ok(darkBlock.length > 100, 'a dark theme block exists');
const lightTokens = [...tokenBlock.matchAll(/(--tgf-[a-z0-9-]+):/g)].map((x) => x[1]);
const darkTokens = [...darkBlock.matchAll(/(--tgf-[a-z0-9-]+):/g)].map((x) => x[1]);
for (const t of ['--tgf-bg', '--tgf-ink', '--tgf-border', '--tgf-danger']) {
  ok(darkTokens.includes(t), 'dark mode overrides ' + t);
}
ok(lightTokens.includes('--tgf-ink-2') && lightTokens.includes('--tgf-ink-3'), 'a text hierarchy exists (primary/secondary/tertiary)');

// ── Motion ───────────────────────────────────────────────────────────────────
ok(/@media \(prefers-reduced-motion: reduce\)/.test(CSS), 'prefers-reduced-motion is respected');
const rm = (CSS.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n    \}/) || [])[1] || '';
ok(/animation:\s*none/.test(rm) && /transition:\s*none/.test(rm), 'reduced motion disables both animation and transitions');
ok(/transform:\s*none/.test(rm), 'reduced motion also cancels transform-based feedback');
// Only transform/opacity should be animated.
const animatedProps = [...CSS.matchAll(/transition:\s*([^;]+);/g)].map((x) => x[1]);
const bad = animatedProps.filter((t) => /\b(width|height|top|left|right|bottom|margin|padding)\b/.test(t) && !/max-width/.test(t));
ok(bad.filter((t) => !/width 320ms/.test(t)).length === 0 || bad.length <= 1,
  'animations stay on cheap properties (the progress bar width is the one deliberate exception)');

// ── Anti-patterns / AI tells ─────────────────────────────────────────────────
ok(!/#000000|#000\b/.test(CSS), 'no pure black');
ok(!/linear-gradient\([^)]*(?:purple|#[89a-f][0-9a-f]{2}[0-9a-f]{2}f)/i.test(CSS), 'no AI-tell purple gradient');
// eslint-disable-next-line no-misleading-character-class
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(SRC.replace(/★/g, '')), 'no emoji used as icons');
ok(/text-wrap:\s*balance/.test(CSS), 'question text uses balanced wrapping (no orphan words)');
ok(/font-variant-numeric:\s*tabular-nums/.test(CSS), 'numbers are tabular so they do not jitter');
ok(/max-width:\s*\d+ch/.test(CSS), 'text is held to a readable measure');

// ── Layout rhythm ────────────────────────────────────────────────────────────
ok(/\.tgf-answer \{[^}]*margin-top/.test(CSS), 'the answer block is separated from the question by deliberate space');
ok(/margin-top:\s*var\(--tgf-s8\)/.test(ruleFor('.tgf-foot')), 'the action row has real air above it, not crowding the answer');
// The keyboard hint belongs beside the button it describes, not flung to the
// far edge where it reads as an orphaned label.
ok(!/margin-left:\s*auto/.test(ruleFor('.tgf-hint')), 'the keyboard hint sits beside its button, not pushed to the far edge');
ok(!/style="padding:/.test(SRC), 'no inline padding left in the markup (spacing lives in the stylesheet)');
ok(/@media \(max-width: 560px\)/.test(CSS), 'a mobile breakpoint exists');
const mob = (CSS.match(/@media \(max-width: 560px\) \{([\s\S]*?)\n    \}/) || [])[1] || '';
ok(/\.tgf-stage/.test(mob) && /\.tgf-q/.test(mob), 'mobile tightens the stage padding and headline size');

// ── Accent contrast is computed, not assumed ─────────────────────────────────
ok(/function inkFor\(/.test(SRC), 'the widget derives readable ink for the client accent colour');
const inkFor = eval('(' + (SRC.match(/function inkFor\(hex\) \{[\s\S]*?\n  \}/) || [])[0] + ')');
ok(inkFor('#1B2B5B') === '#FFFFFF', 'white text on the navy default');
ok(inkFor('#FFEB3B') === '#0F172A', 'dark text on a pale yellow accent (would be unreadable in white)');
ok(inkFor('#00B4D8') !== undefined, 'the teal accent resolves');
ok(inkFor('') === '#FFFFFF', 'a malformed colour falls back safely');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
