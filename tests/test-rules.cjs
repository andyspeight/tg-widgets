/**
 * Unit tests for public/tgse-rules.js (the shell-level rule engine).
 * Plain Node, no dependencies. The repo is type:module so this file is .cjs.
 *
 * Run: node tests/test-rules.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    _data: data,
  };
}

function loadEngine(extraGlobals) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'tgse-rules.js'), 'utf8');
  const sandbox = Object.assign(
    {
      console,
      URLSearchParams,
      localStorage: makeStorage(),
      sessionStorage: makeStorage(),
    },
    extraGlobals || {}
  );
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'tgse-rules.js' });
  return sandbox;
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    console.error('FAIL  ' + name);
    console.error('      ' + (e && e.message));
  }
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'assertion failed') + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

// A fixed context so tests never depend on the machine's clock or size.
// Tuesday 10:30 local time.
const TUE_1030 = new Date(2026, 6, 7, 10, 30); // 7 Jul 2026 is a Tuesday
const CTX = { now: TUE_1030, device: 'desktop', returning: false, entrySource: { referrer: '', source: '', medium: '', campaign: '' } };
function ctx(over) { return Object.assign({}, CTX, over); }

const g = loadEngine();
const R = g.tgseRules;

console.log('tgse-rules unit tests');

// --- engine surface -------------------------------------------------------
test('1. engine loads once and exposes the public surface', () => {
  eq(typeof R.evaluate, 'function', 'evaluate');
  eq(typeof R.armDeferred, 'function', 'armDeferred');
  eq(R.types.length, 6, 'six rule types');
  eq(typeof R.version, 'string', 'version');
});

test('2. empty rule group shows (nothing to check)', () => {
  eq(R.evaluate({ match: 'all', rules: [] }, CTX).show, true);
});

test('3. invalid group fails open', () => {
  eq(R.evaluate(null, CTX).show, true);
  eq(R.evaluate('nonsense', CTX).show, true);
});

test('4. unknown rule type fails open (counts as pass)', () => {
  const r = R.evaluate({ match: 'all', rules: [{ type: 'astrology', sign: 'leo' }] }, CTX);
  eq(r.show, true);
});

// --- visitorType ----------------------------------------------------------
test('5. visitorType new passes for a new visitor', () => {
  eq(R.evaluate({ rules: [{ type: 'visitorType', value: 'new' }] }, ctx({ returning: false })).show, true);
});

test('6. visitorType new fails for a returning visitor', () => {
  eq(R.evaluate({ rules: [{ type: 'visitorType', value: 'new' }] }, ctx({ returning: true })).show, false);
});

test('7. visitorType returning passes for a returning visitor', () => {
  eq(R.evaluate({ rules: [{ type: 'visitorType', value: 'returning' }] }, ctx({ returning: true })).show, true);
});

// --- timeOfDay ------------------------------------------------------------
test('8. timeOfDay passes inside the window', () => {
  eq(R.evaluate({ rules: [{ type: 'timeOfDay', from: '09:00', to: '17:00' }] }, CTX).show, true);
});

test('9. timeOfDay fails outside the window', () => {
  eq(R.evaluate({ rules: [{ type: 'timeOfDay', from: '12:00', to: '14:00' }] }, CTX).show, false);
});

test('10. overnight window passes late at night', () => {
  const night = ctx({ now: new Date(2026, 6, 7, 23, 15) });
  eq(R.evaluate({ rules: [{ type: 'timeOfDay', from: '22:00', to: '06:00' }] }, night).show, true);
});

test('11. overnight window fails at midday', () => {
  eq(R.evaluate({ rules: [{ type: 'timeOfDay', from: '22:00', to: '06:00' }] }, CTX).show, false);
});

test('12. malformed timeOfDay fails open', () => {
  eq(R.evaluate({ rules: [{ type: 'timeOfDay', from: 'noonish', to: '17:00' }] }, CTX).show, true);
});

// --- dayOfWeek ------------------------------------------------------------
test('13. dayOfWeek passes on a listed day', () => {
  eq(R.evaluate({ rules: [{ type: 'dayOfWeek', days: [1, 2, 3] }] }, CTX).show, true); // Tuesday = 2
});

test('14. dayOfWeek fails on an unlisted day', () => {
  eq(R.evaluate({ rules: [{ type: 'dayOfWeek', days: [0, 6] }] }, CTX).show, false);
});

test('15. empty dayOfWeek list fails open', () => {
  eq(R.evaluate({ rules: [{ type: 'dayOfWeek', days: [] }] }, CTX).show, true);
});

// --- device ---------------------------------------------------------------
test('16. device passes on a listed device', () => {
  eq(R.evaluate({ rules: [{ type: 'device', devices: ['desktop', 'tablet'] }] }, CTX).show, true);
});

test('17. device fails on an unlisted device', () => {
  eq(R.evaluate({ rules: [{ type: 'device', devices: ['mobile'] }] }, CTX).show, false);
});

// --- utm ------------------------------------------------------------------
test('18. utm exact match passes', () => {
  const c = ctx({ entrySource: { referrer: '', source: 'newsletter', medium: '', campaign: '' } });
  eq(R.evaluate({ rules: [{ type: 'utm', param: 'source', value: 'Newsletter', match: 'is' }] }, c).show, true);
});

test('19. utm exact mismatch fails', () => {
  const c = ctx({ entrySource: { referrer: '', source: 'google', medium: '', campaign: '' } });
  eq(R.evaluate({ rules: [{ type: 'utm', param: 'source', value: 'newsletter', match: 'is' }] }, c).show, false);
});

test('20. utm contains match passes', () => {
  const c = ctx({ entrySource: { referrer: 'https://www.facebook.com/x', source: '', medium: '', campaign: '' } });
  eq(R.evaluate({ rules: [{ type: 'utm', param: 'referrer', value: 'facebook', match: 'contains' }] }, c).show, true);
});

test('21. utm with empty wanted value fails open', () => {
  eq(R.evaluate({ rules: [{ type: 'utm', param: 'source', value: '', match: 'is' }] }, CTX).show, true);
});

test('22. utm with unknown param fails open', () => {
  eq(R.evaluate({ rules: [{ type: 'utm', param: 'gclid', value: 'x', match: 'is' }] }, CTX).show, true);
});

// --- match any / all combinators -------------------------------------------
test('23. match any shows when one of two rules passes', () => {
  const r = R.evaluate({ match: 'any', rules: [{ type: 'device', devices: ['mobile'] }, { type: 'dayOfWeek', days: [2] }] }, CTX);
  eq(r.show, true);
});

test('24. match any hides when every rule fails', () => {
  const r = R.evaluate({ match: 'any', rules: [{ type: 'device', devices: ['mobile'] }, { type: 'dayOfWeek', days: [0] }] }, CTX);
  eq(r.show, false);
  eq(r.defer, false);
});

test('25. match all hides when one rule fails', () => {
  const r = R.evaluate({ match: 'all', rules: [{ type: 'dayOfWeek', days: [2] }, { type: 'device', devices: ['mobile'] }] }, CTX);
  eq(r.show, false);
});

// --- exit intent deferral ---------------------------------------------------
test('26. exitIntent alone defers instead of showing', () => {
  const r = R.evaluate({ rules: [{ type: 'exitIntent' }] }, CTX);
  eq(r.show, false);
  eq(r.defer, true);
});

test('27. deferral combines with the other rules correctly', () => {
  // all non-deferrable rules pass and only exit intent is pending -> defer
  const pend = R.evaluate({ match: 'all', rules: [{ type: 'dayOfWeek', days: [2] }, { type: 'exitIntent' }] }, CTX);
  eq(pend.show, false, 'all+pending show');
  eq(pend.defer, true, 'all+pending defer');
  // a failing non-deferrable rule beats the deferral -> plain hide
  const dead = R.evaluate({ match: 'all', rules: [{ type: 'dayOfWeek', days: [0] }, { type: 'exitIntent' }] }, CTX);
  eq(dead.show, false, 'all+failed show');
  eq(dead.defer, false, 'all+failed defer');
  // match any with only failures + a deferrable still waits for the trigger
  const anyPend = R.evaluate({ match: 'any', rules: [{ type: 'device', devices: ['mobile'] }, { type: 'exitIntent' }] }, CTX);
  eq(anyPend.defer, true, 'any+pending defer');
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
