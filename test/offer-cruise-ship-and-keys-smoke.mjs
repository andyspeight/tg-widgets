/**
 * Cruise offer feedback (Andy, 10 Aug 2026):
 *   1-2. Some letters/numbers (d, t, 1, 3 …) would not type in the offer
 *        builder. Cause: the builder's edit form is itself a Shadow DOM widget,
 *        so keydown events reaching the shell are retargeted to the shadow host,
 *        the shell's inField guard saw "not a field", and its single-key
 *        shortcuts preventDefault'd the keystroke. Fix: the guard now walks the
 *        composed path (crossing shadow boundaries) and checks isContentEditable.
 *   4.   The ship name (e.g. Celebrity Infinity) now shows on the cruise card
 *        and the offer-page hero, with an anchor icon.
 *
 * Source guards; the shell fix was also reproduced end-to-end in a real browser
 * (a keydown from inside a Shadow DOM input: old guard inField=false, new=true).
 *
 * Run: node test/offer-cruise-ship-and-keys-smoke.mjs  (also: npm run test:offer-cruise-ship)
 */
import { readFileSync } from 'node:fs';

const shell = readFileSync(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
const card = readFileSync(new URL('../public/widget-offer-card.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../public/widget-offer-page.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('Shell keyboard guard survives Shadow DOM (the typing bug)');
{
  ok('a composed-path helper decides "typing in editable"', /function typingInEditable\(e\)/.test(shell));
  ok('it walks e.composedPath()', /e\.composedPath\(\)/.test(shell));
  ok('it accepts isContentEditable + contenteditable="" and inputs',
    /isContentEditable/.test(shell) && /contenteditable=""/.test(shell) && /input,textarea,select/.test(shell));
  ok('the shortcut guard uses it (not the bare e.target.closest)',
    /const inField = typingInEditable\(e\);/.test(shell));
  // The single-key shortcuts that were swallowing input still exist and are
  // still gated on !inField (so the fix is about inField, not removing them).
  ok('single-key shortcuts remain, gated on !inField', /if \(!mod && !inField\)/.test(shell) && /data-tab="settings"/.test(shell));
}

console.log('Ship name on the cruise card, with an anchor');
{
  ok('card has an anchor icon', /anchor:\s*'<svg/.test(card));
  ok('_cruiseCard reads the shipName field', /const ship = this\._f\('shipName'\);/.test(card));
  ok('renders it with the anchor icon when present',
    /shipLine = ship \? '<p class="tgoc-c-ship">' \+ ICO\.anchor/.test(card));
  ok('ship line is placed in the card body', /'<h3 class="tgoc-c-title">' \+ esc\(d\.title\) \+ '<\/h3>'\s*\+\s*shipLine/.test(card));
  ok('ship line has styles', /\.tgoc-c-ship \{/.test(card) && /\.tgoc-c-ship svg \{/.test(card));
  const vm = card.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok('card version bumped (>= 0.2.1)', vm && (+vm[1] > 0 || (+vm[2] > 2 || (+vm[2] === 2 && +vm[3] >= 1))));
}

console.log('Ship name in the offer-page hero, with an anchor');
{
  ok('page has an anchor icon in its icon set', /anchor:\s*'<svg/.test(page));
  ok('overlay hero shows the anchored ship name',
    /d\.shipName \? '<span class="tgop-hero-loc tgop-hero-ship">' \+ I\.anchor \+ esc\(d\.shipName\)/.test(page));
  // Both heroes (overlay + split) get it.
  ok('the anchored ship line appears twice (overlay + split heroes)',
    (page.match(/tgop-hero-ship">' \+ I\.anchor \+ esc\(d\.shipName\)/g) || []).length >= 2);
  const vm = page.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok('page version bumped (>= 0.4.1)', vm && (+vm[1] > 0 || (+vm[2] > 4 || (+vm[2] === 4 && +vm[3] >= 1))));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
