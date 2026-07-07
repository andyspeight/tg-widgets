/**
 * Unit tests for api/_lib/smartsection-rules.js — the trust boundary that
 * sanitises AI-generated Smart Section configs before they reach a client.
 *
 * Run: node tests/test-ai-rules.cjs   (imports the ESM module via import()).
 */
'use strict';

const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name); console.error('      ' + (e && e.message)); }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((msg || 'assertion failed') + ' — expected ' + B + ', got ' + A);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

(async () => {
  const mod = await import('../api/_lib/smartsection-rules.js');
  const S = mod.sanitiseSmartSectionConfig;

  console.log('smartsection AI validator tests');

  test('1. a clean config passes through intact', () => {
    const out = S({ match: 'any', rules: [{ type: 'device', devices: ['mobile', 'tablet'] }], dismissible: true, dismissDays: 14, maxShows: 3, reveal: 'none' });
    eq(out, { match: 'any', rules: [{ type: 'device', devices: ['mobile', 'tablet'] }], dismissible: true, dismissDays: 14, maxShows: 3, reveal: 'none' });
  });

  test('2. non-object input yields a safe empty config', () => {
    eq(S(null), { match: 'all', rules: [], dismissible: false, dismissDays: 30, maxShows: 0, reveal: 'fade' });
    eq(S('nope').rules, []);
    eq(S([1, 2]).rules, []);
  });

  test('3. unknown rule types are dropped, not guessed', () => {
    const out = S({ rules: [{ type: 'geolocation', country: 'FR' }, { type: 'exitIntent' }] });
    eq(out.rules, [{ type: 'exitIntent' }]);
  });

  test('4. malformed field values are dropped per rule', () => {
    const out = S({ rules: [
      { type: 'visitorType', value: 'alien' },        // invalid enum -> dropped
      { type: 'timeOfDay', from: '9am', to: '17:00' },// bad time -> dropped
      { type: 'dayOfWeek', days: [1, 9, 'x', 3] },    // keeps only 1 and 3
      { type: 'device', devices: ['watch', 'mobile'] },// keeps only mobile
    ] });
    eq(out.rules, [
      { type: 'dayOfWeek', days: [1, 3] },
      { type: 'device', devices: ['mobile'] },
    ]);
  });

  test('5. valid visitorType and timeOfDay survive', () => {
    const out = S({ rules: [
      { type: 'visitorType', value: 'returning' },
      { type: 'timeOfDay', from: '22:00', to: '06:00' },
    ] });
    eq(out.rules, [
      { type: 'visitorType', value: 'returning' },
      { type: 'timeOfDay', from: '22:00', to: '06:00' },
    ]);
  });

  test('6. utm defaults param/match and trims value; empty value dropped', () => {
    const a = S({ rules: [{ type: 'utm', param: 'nonsense', match: 'weird', value: '  Newsletter  ' }] });
    eq(a.rules, [{ type: 'utm', param: 'source', match: 'is', value: 'Newsletter' }]);
    const b = S({ rules: [{ type: 'utm', param: 'referrer', match: 'contains', value: '' }] });
    eq(b.rules, []); // empty value -> not a usable rule
  });

  test('7. numbers are clamped and coerced', () => {
    const out = S({ dismissDays: 9999, maxShows: -5, reveal: 'sparkle', match: 'weird' });
    eq(out.dismissDays, 365);
    eq(out.maxShows, 0);
    eq(out.reveal, 'fade');
    eq(out.match, 'all');
  });

  test('8. dismissible only true when strictly true', () => {
    eq(S({ dismissible: 'yes' }).dismissible, false);
    eq(S({ dismissible: 1 }).dismissible, false);
    eq(S({ dismissible: true }).dismissible, true);
  });

  test('9. rule count is capped at 12', () => {
    const many = Array.from({ length: 40 }, () => ({ type: 'exitIntent' }));
    eq(S({ rules: many }).rules.length, 12);
  });

  test('10. a prompt-injection payload cannot smuggle executable or extra fields', () => {
    const out = S({
      match: 'all',
      rules: [{ type: 'device', devices: ['mobile'], onclick: 'alert(1)', __proto__: { polluted: true } }],
      evil: 'DROP TABLE', script: '<script>x</script>',
    });
    // only the whitelisted device rule survives, rebuilt field-by-field
    eq(out.rules, [{ type: 'device', devices: ['mobile'] }]);
    ok(!('evil' in out) && !('script' in out), 'no extra top-level keys leak through');
    eq(Object.keys(out).sort(), ['dismissDays', 'dismissible', 'match', 'maxShows', 'reveal', 'rules']);
    ok(!('polluted' in {}), 'prototype not polluted');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
