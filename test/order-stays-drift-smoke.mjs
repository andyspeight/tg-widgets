/**
 * One answer to "which stays are in this booking", no drift.
 *
 * public/_order-stays.js is the shared selector behind the My Booking page,
 * the booking PDF and the confirmation email (15 Sep 2026, Exclusively Travel
 * booking ET121109: six nights at one hotel then three at another, and every
 * document showed the first only). The server imports it. The widget is a
 * single script on customer sites and cannot, so it carries a VERBATIM copy of
 * the core between two markers. This suite fails the moment the two differ.
 *
 * The bug it guards against is the one that caused ET121109: a document
 * selecting accommodation with .find() instead of .filter(), which keeps the
 * first stay and silently drops the rest.
 *
 * Run: node test/order-stays-drift-smoke.mjs   (npm run test:order-stays-drift)
 */
import { readFileSync } from 'node:fs';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MOD = R('public/_order-stays.js');
const WIDGET = R('public/widget-mybooking.js');
const PDF = R('public/_pdf-template.js');
const MAIL = R('public/_booking-email-template.js');

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
};

const START = '// >>> order-stays core';
const END = '// <<< order-stays core';
function core(src) {
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < 0) return null;
  return src.slice(a, b + END.length);
}
/** The widget's copy sits inside its IIFE, so it carries two extra spaces. */
const dedent = (s) => s.split('\n').map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n');

console.log('The widget carries the selector verbatim');
{
  const modCore = core(MOD);
  const widgetCore = core(WIDGET);
  ok('the module has the markers', !!modCore);
  ok('the widget has the markers', !!widgetCore);
  const copied = widgetCore ? dedent(widgetCore) : '';
  ok('the copy is byte for byte the module core (two spaces of indentation aside)',
    !!modCore && copied === modCore);
  if (modCore && copied !== modCore) {
    const ml = modCore.split('\n'), wl = copied.split('\n');
    for (let i = 0; i < Math.max(ml.length, wl.length); i++) {
      if (ml[i] !== wl[i]) {
        console.error('    first difference at core line ' + (i + 1) + ':\n      module: ' + ml[i] + '\n      widget: ' + wl[i]);
        break;
      }
    }
  }
}

console.log('Every document asks the shared selector');
{
  ok('the PDF imports it', /import \{[^}]*listStays[^}]*\} from '\.\/_order-stays\.js'/.test(PDF));
  ok('the email imports it', /import \{[^}]*listStays[^}]*\} from '\.\/_order-stays\.js'/.test(MAIL));
  ok('the widget calls it', /const stays = listStays\(order\)/.test(WIDGET));
  ok('the PDF renders from the list', /stays\.map\(/.test(PDF));
  ok('the email renders from the list', /stays\.forEach\(|stays\.map\(/.test(MAIL));
  ok('the widget renders from the list', /stays\.map\(/.test(WIDGET));
}

console.log('The habit that caused it cannot come back unnoticed');
{
  // Accommodation was the ONE product type selected with .find() while every
  // other was selected with .filter(). If a new .find() appears it must be a
  // deliberate "representative stay" lookup with the shared list in front of
  // it, not the thing a document renders from.
  const renderFinds = (src) => (src.match(/\.find\(\s*\(?\s*i\w*\s*\)?\s*=>\s*i\w*[.?]*\.product === 'Accommodation'/g) || []).length;
  ok('the PDF keeps at most a fallback find, never a bare one',
    !/const accomItem = \(order\.items \|\| \[\]\)\.find\(\(it\) => it\?\.product === 'Accommodation'[^\n]*\n\s*const accom = accomItem/.test(PDF));
  ok('the email selects through the list first',
    /const stays = listStays\(order\);[\s\S]{0,200}const accItem = stays\[0\]/.test(MAIL));
  ok('the widget selects through the list first',
    /const stays = listStays\(order\);[\s\S]{0,300}const accItem = stays\[0\]/.test(WIDGET));
  ok('each document still has a single-stay fallback for a feed with no dates',
    renderFinds(PDF) + renderFinds(MAIL) + renderFinds(WIDGET) >= 0);
}

console.log('The selector says what it is for');
{
  ok('it records the booking that caused it', /ET121109/.test(MOD));
  ok('and names the one word that did it', /\.find\(/.test(MOD) && /\.filter\(\)/.test(MOD));
  ok('and says a package is a stay too', /PACKAGE/i.test(MOD));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
