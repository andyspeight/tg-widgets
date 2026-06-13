/**
 * Currency Converter smoke test.
 * Covers the pure, importable bits of the FX proxy (validation + symbol
 * parsing) plus the conversion maths the widget relies on. Run:
 *   node test/currency-smoke.mjs
 */
import assert from 'node:assert';

let passed = 0, failed = 0;
function ok(cond, label) { if (cond) { passed++; } else { failed++; console.error('  FAIL:', label); } }

const fx = await import('../api/fx-rates.js');

// ── validCode ──
ok(fx.validCode('gbp') === 'GBP', 'validCode uppercases');
ok(fx.validCode('  eur ') === 'EUR', 'validCode trims');
ok(fx.validCode('xxx') === '', 'validCode rejects unsupported');
ok(fx.validCode('') === '' && fx.validCode(null) === '', 'validCode handles empty/null');

// ── parseSymbols ──
ok(JSON.stringify(fx.parseSymbols('EUR,usd,EUR,GBP,zzz', 'GBP')) === JSON.stringify(['EUR', 'USD']), 'parseSymbols dedups, drops base + invalid');
ok(fx.parseSymbols('', 'GBP').length === 0, 'parseSymbols empty');
ok(fx.parseSymbols(Array(60).fill('EUR').join(','), 'GBP').length <= 40, 'parseSymbols caps');

// ── currency set ──
const codes = Object.keys(fx.CURRENCIES);
ok(codes.length >= 30, 'currency set has 30+ entries');
ok(['GBP', 'EUR', 'USD', 'JPY', 'AUD'].every(c => fx.CURRENCIES[c]), 'currency set has the common travel currencies');

// ── handler is the default export ──
ok(typeof fx.default === 'function', 'default export is the handler');

// ── conversion maths (mirrors widget _compute: amount * rateTo/rateFrom) ──
// rates relative to base GBP; base present as 1.
const rates = { GBP: 1, EUR: 1.2, USD: 1.25 };
const convert = (amt, from, to) => amt * (rates[to] / rates[from]);
ok(Math.abs(convert(100, 'GBP', 'EUR') - 120) < 1e-9, 'GBP→EUR converts via base');
ok(Math.abs(convert(120, 'EUR', 'GBP') - 100) < 1e-9, 'EUR→GBP is the inverse');
ok(Math.abs(convert(100, 'EUR', 'USD') - (100 * 1.25 / 1.2)) < 1e-9, 'cross rate EUR→USD');
ok(Math.abs(convert(50, 'USD', 'USD') - 50) < 1e-9, 'same currency is identity');

// ── flag from currency code (mirrors widget flagFor) ──
const flagFor = (code) => {
  const cc = String(code || '').slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
};
ok([...flagFor('GBP')].length === 2, 'flagFor yields a two-codepoint flag');
ok(flagFor('GBP') === '\u{1F1EC}\u{1F1E7}', 'flagFor GBP is the UK flag');

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'currency smoke failures');
