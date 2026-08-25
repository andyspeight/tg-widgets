// The capacity rule is the one piece of arithmetic that decides whether we
// oversell a trip, so it is tested at the edges rather than the happy path.
// Rule locked 7 Aug 2026, ported unchanged from tg-widgets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSpotsTaken, summarise } from '../src/lib/capacity.ts';

const NOW = Date.parse('2026-08-25T12:00:00Z');
const FUTURE = '2026-08-25T12:30:00Z';
const PAST = '2026-08-25T11:30:00Z';

test('deposit_paid and paid always occupy a place', () => {
  assert.equal(
    computeSpotsTaken(
      [
        { party_size: 2, status: 'deposit_paid' },
        { party_size: 3, status: 'paid' },
      ],
      NOW,
    ),
    5,
  );
});

test('a paid booking counts even with an expired hold', () => {
  assert.equal(
    computeSpotsTaken([{ party_size: 4, status: 'paid', hold_expires_at: PAST }], NOW),
    4,
  );
});

test('pending counts while the hold is in the future', () => {
  assert.equal(
    computeSpotsTaken([{ party_size: 2, status: 'pending', hold_expires_at: FUTURE }], NOW),
    2,
  );
});

test('pending does NOT count once the hold has expired', () => {
  assert.equal(
    computeSpotsTaken([{ party_size: 2, status: 'pending', hold_expires_at: PAST }], NOW),
    0,
  );
});

test('pending with no hold is treated as a fresh hold and counts', () => {
  assert.equal(computeSpotsTaken([{ party_size: 2, status: 'pending' }], NOW), 2);
  assert.equal(
    computeSpotsTaken([{ party_size: 2, status: 'pending', hold_expires_at: null }], NOW),
    2,
  );
});

test('an unparseable hold counts rather than silently freeing a place', () => {
  assert.equal(
    computeSpotsTaken([{ party_size: 2, status: 'pending', hold_expires_at: 'not a date' }], NOW),
    2,
  );
});

test('a hold expiring exactly now has expired', () => {
  assert.equal(
    computeSpotsTaken(
      [{ party_size: 2, status: 'pending', hold_expires_at: new Date(NOW).toISOString() }],
      NOW,
    ),
    0,
  );
});

test('cancelled and expired never count', () => {
  assert.equal(
    computeSpotsTaken(
      [
        { party_size: 5, status: 'cancelled' },
        { party_size: 5, status: 'expired' },
        { party_size: 5, status: 'something_new' },
      ],
      NOW,
    ),
    0,
  );
});

test('junk rows are skipped, not counted as one', () => {
  const rows = [
    { party_size: 0, status: 'paid' },
    { party_size: -3, status: 'paid' },
    { party_size: Number.NaN, status: 'paid' },
    { party_size: 2, status: 'paid' },
  ];
  assert.equal(computeSpotsTaken(rows as never, NOW), 2);
});

test('a non-array is zero rather than a throw', () => {
  assert.equal(computeSpotsTaken(null as never, NOW), 0);
  assert.equal(computeSpotsTaken(undefined as never, NOW), 0);
});

test('summarise reports remaining and sold out', () => {
  const rows = [{ party_size: 8, status: 'paid' }];
  assert.deepEqual(summarise(10, rows, NOW), {
    capacity: 10,
    taken: 8,
    remaining: 2,
    soldOut: false,
  });
  assert.deepEqual(summarise(8, rows, NOW), {
    capacity: 8,
    taken: 8,
    remaining: 0,
    soldOut: true,
  });
});

test('remaining never goes negative when a trip is oversold', () => {
  const seats = summarise(5, [{ party_size: 9, status: 'paid' }], NOW);
  assert.equal(seats.remaining, 0);
  assert.equal(seats.soldOut, true);
});

test('capacity of zero is "not set", never sold out', () => {
  // A trip with no capacity entered must not advertise itself as sold out.
  const seats = summarise(0, [{ party_size: 3, status: 'paid' }], NOW);
  assert.equal(seats.soldOut, false);
  assert.equal(seats.remaining, 0);
});
