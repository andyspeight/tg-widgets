// A zero price means "not priced yet" and must never render as free.
// Locked 10 Aug 2026, after £0 safaris appeared on a live tour page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { format, isPriced, toPence, splitDeposit } from '../src/lib/money.ts';

test('zero is not a price', () => {
  assert.equal(isPriced(0), false);
  assert.equal(format(0), null);
  assert.equal(format(0, 'gbp'), null);
});

test('null, undefined and negatives are not prices either', () => {
  for (const v of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(isPriced(v as never), false, `${String(v)} should not be priced`);
    assert.equal(format(v as never), null);
  }
});

test('a real price formats as money', () => {
  assert.equal(format(129900, 'gbp'), '£1,299');
  assert.equal(format(129950, 'gbp'), '£1,299.50');
});

test('whole amounts drop the pence, part amounts keep them', () => {
  assert.equal(format(5000, 'gbp'), '£50');
  assert.equal(format(5099, 'gbp'), '£50.99');
});

test('other currencies are honoured', () => {
  assert.equal(format(10000, 'eur'), '€100');
  assert.equal(format(10000, 'usd'), '$100');
});

test('an unknown currency falls back instead of throwing mid-render', () => {
  const out = format(10000, 'zzz');
  assert.equal(typeof out, 'string');
  assert.ok(out!.includes('100'));
});

test('toPence rejects rubbish rather than returning zero', () => {
  assert.equal(toPence(''), null);
  assert.equal(toPence(null), null);
  assert.equal(toPence('not a number'), null);
  assert.equal(toPence('-5'), null);
});

test('toPence handles typed money', () => {
  assert.equal(toPence('1299'), 129900);
  assert.equal(toPence('£1,299.50'), 129950);
  assert.equal(toPence(50), 5000);
});

test('a fixed deposit splits and never exceeds the total', () => {
  assert.deepEqual(splitDeposit(100000, 20000, null), { deposit: 20000, balance: 80000 });
  assert.deepEqual(splitDeposit(10000, 50000, null), { deposit: 10000, balance: 0 });
});

test('a percentage deposit rounds to whole pence', () => {
  assert.deepEqual(splitDeposit(99999, null, 15), { deposit: 15000, balance: 84999 });
});

test('no deposit set means the whole amount is due now', () => {
  assert.deepEqual(splitDeposit(50000, null, null), { deposit: 50000, balance: 0 });
  // Zero is "not set", not "no deposit required".
  assert.deepEqual(splitDeposit(50000, 0, null), { deposit: 50000, balance: 0 });
});
