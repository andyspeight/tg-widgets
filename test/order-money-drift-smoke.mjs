/**
 * One calculation of what a booking owes, no drift.
 *
 * public/_order-money.js is the shared calculation behind the My Booking page,
 * the booking PDF, the confirmation email, the balance chase emails and the
 * pay-balance charge (8 Sep 2026, the TG120193 voucher report). The server
 * imports it. The widget is a single script on customer sites and cannot, so
 * it carries a VERBATIM copy of the core between two markers. This suite
 * fails the moment the two differ, and checks the widget's English wording
 * matches the strings the PDF and email print.
 *
 * Run: node test/order-money-drift-smoke.mjs   (npm run test:order-money-drift)
 */
import { readFileSync } from 'node:fs';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MOD = R('public/_order-money.js');
const WIDGET = R('public/widget-mybooking.js');
const SHIM = R('api/_lib/order-money.js');
let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

const START = '// >>> order-money core';
const END = '// <<< order-money core';
function core(src) {
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < 0) return null;
  return src.slice(a, b + END.length);
}

console.log('The widget carries the module core verbatim');
{
  const m = core(MOD), w = core(WIDGET);
  ok('the module marks its core', !!m);
  ok('the widget marks its copy', !!w);
  const dedented = w ? w.split('\n').map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n') : '';
  ok('the copy is byte for byte the module core (two spaces of indentation aside)', !!m && dedented === m);
  if (m && dedented !== m) {
    const ml = m.split('\n'), wl = dedented.split('\n');
    for (let i = 0; i < Math.max(ml.length, wl.length); i++) {
      if (ml[i] !== wl[i]) { console.error('    first difference at core line ' + (i + 1) + ':\n      module: ' + ml[i] + '\n      widget: ' + wl[i]); break; }
    }
  }
  ok('the widget prefers the server\'s money block and only computes for a sample order', /function orderMoney\(order\) \{ return moneyOf\(order\); \}/.test(WIDGET));
  ok('the old per-output arithmetic is gone from the widget', !/function computeOutstanding\(/.test(WIDGET) && !/function computeNextDue\(/.test(WIDGET) && !/function reconcileSchedule\(order\)/.test(WIDGET));
}

console.log('\nThe server imports the same module, through the stable shim');
{
  ok('the shim re-exports the public module', /export \* from '\.\.\/\.\.\/public\/_order-money\.js';/.test(SHIM));
  for (const f of ['api/retrieve-order.js', 'api/internal/retrieve-order-by-client.js', 'api/booking-pdf.js', 'api/pay-balance.js']) {
    ok(f + ' reads the shared calculation', /from '(\.\.\/)?(\.\/)?_lib\/order-money\.js'/.test(R(f)) && /moneyOf\(raw, /.test(R(f)));
  }
  ok('the templates import the public module directly', /from '\.\/_order-money\.js'/.test(R('public/_pdf-template.js')) && /from '\.\/_order-money\.js'/.test(R('public/_booking-email-template.js')));
  ok('the public module is runtime-neutral', !/^import /m.test(MOD) && !/process\.env/.test(MOD) && !/\bdocument\./.test(MOD) && !/\bBuffer\b/.test(MOD));
  ok('no output does its own voucher sums any more', !/order\.voucher\b/.test(R('public/_pdf-template.js')) && !/order\.voucher\b/.test(R('public/_booking-email-template.js')) && !/raw\.voucherValue/.test(R('api/pay-balance.js')) && !/voucherValue/.test(R('api/retrieve-order.js')));
}

console.log('\nThe widget\'s English wording is the wording the PDF and email print');
{
  const strings = {};
  const block = (core(MOD).match(/const MONEY_STRINGS = \{([\s\S]*?)\};/) || [])[1] || '';
  for (const m of block.matchAll(/(\w+): '((?:[^'\\]|\\.)*)'/g)) strings[m[1]] = m[2];
  const en = (WIDGET.match(/const MESSAGES = \{\s*en: \{([\s\S]*?)\n    \},/) || [])[1] || '';
  const enOf = (k) => (en.match(new RegExp("\\n      " + k + ": '((?:[^'\\\\]|\\\\.)*)'")) || [])[1];
  ok('settled', enOf('payStatusSettled') === strings.settled);
  ok('part paid', enOf('payStatusPartly') === strings.partly);
  ok('amount payable now', enOf('amountPayableNow') === strings.amountPayableNow);
  ok('due now', enOf('dueNow') === strings.dueNow);
  ok('voucher', enOf('voucher') === strings.voucher);
  for (const lang of ['fr', 'de', 'es', 'it', 'ro']) {
    const dict = (WIDGET.match(new RegExp("\\n    " + lang + ": \\{([\\s\\S]*?)\\n    \\},")) || [])[1] || '';
    ok(lang + ' carries every new key', ['amountPayableNow', 'dueNow', 'voucher', 'payStatusSettled', 'payStatusPartly'].every((k) => new RegExp("\\n      " + k + ": '").test(dict)) && /payStatusPartly: '[^']*\{amount\}/.test(dict));
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
