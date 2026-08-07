/**
 * Group Trips capacity maths + availability (plain Node, no browser).
 * Run: node test/trips-capacity-smoke.mjs      (npm run test:trips-capacity)
 *
 * The GT-2 acceptance: capacity is unit-tested including expired holds. Also
 * checks getTripAvailability wires the right PostgREST query, and that the new
 * public endpoints are actually rate-limited (they used to fall through to no
 * limit).
 */
import assert from 'node:assert';

// The lib reads env at module load, so set it before importing.
process.env.TRIPS_SUPABASE_URL = 'https://trips.test';
process.env.TRIPS_SUPABASE_SERVICE_ROLE_KEY = 'test-key';

let ROWS = [];
let LAST_URL = '';
const realFetch = global.fetch;
global.fetch = async (url) => {
  LAST_URL = String(url);
  return { ok: true, status: 200, json: async () => ROWS, text: async () => '' };
};

const { computeSpotsTaken, getTripAvailability, tripsDbConfigured } =
  await import('../api/_lib/trips/supabase.js');

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const NOW = Date.parse('2027-01-01T12:00:00Z');
const FUTURE = '2027-01-01T13:00:00Z'; // hold still valid
const PAST = '2027-01-01T11:00:00Z';   // hold expired

ok(tripsDbConfigured(), 'lib: configured when env present');

// ── computeSpotsTaken ──
ok(computeSpotsTaken([{ party_size: 2, status: 'paid' }], NOW) === 2, 'paid counts');
ok(computeSpotsTaken([{ party_size: 3, status: 'deposit_paid' }], NOW) === 3, 'deposit_paid counts');
ok(computeSpotsTaken([{ party_size: 2, status: 'pending', hold_expires_at: FUTURE }], NOW) === 2, 'pending unexpired counts');
ok(computeSpotsTaken([{ party_size: 2, status: 'pending', hold_expires_at: PAST }], NOW) === 0, 'pending EXPIRED does not count');
ok(computeSpotsTaken([{ party_size: 2, status: 'pending' }], NOW) === 2, 'pending with no expiry counts (fresh hold)');
ok(computeSpotsTaken([{ party_size: 5, status: 'cancelled' }], NOW) === 0, 'cancelled never counts');
ok(computeSpotsTaken([{ party_size: 5, status: 'expired' }], NOW) === 0, 'expired never counts');
ok(computeSpotsTaken([{ party_size: 0, status: 'paid' }, { party_size: -3, status: 'paid' }, { party_size: 'x', status: 'paid' }], NOW) === 0, 'invalid sizes ignored');

const mixed = [
  { party_size: 2, status: 'paid' },                                 // 2
  { party_size: 1, status: 'deposit_paid' },                         // 1
  { party_size: 3, status: 'pending', hold_expires_at: FUTURE },     // 3
  { party_size: 4, status: 'pending', hold_expires_at: PAST },       // 0 (expired)
  { party_size: 9, status: 'cancelled' },                            // 0
];
ok(computeSpotsTaken(mixed, NOW) === 6, `mixed sums to 6 (got ${computeSpotsTaken(mixed, NOW)})`);
ok(computeSpotsTaken(null) === 0 && computeSpotsTaken(undefined) === 0, 'non-array -> 0');

// ── getTripAvailability (stubbed fetch) ──
ROWS = [
  { party_size: 2, status: 'paid' },
  { party_size: 3, status: 'pending', hold_expires_at: FUTURE },
  { party_size: 4, status: 'pending', hold_expires_at: PAST },   // expired, ignored
];
let a = await getTripAvailability('tgw_abc', 16, NOW);
ok(a.capacity === 16 && a.taken === 5 && a.remaining === 11 && a.soldOut === false, `availability math (got ${JSON.stringify(a)})`);
ok(/gt_bookings\?widget_id=eq\.tgw_abc/.test(LAST_URL), 'query filters by widget_id');
ok(/status=in\.\(pending,deposit_paid,paid\)/.test(LAST_URL), 'query filters to the counting statuses');
ok(/select=party_size,status,hold_expires_at/.test(LAST_URL), 'query selects only the fields needed (no PII)');

ROWS = [{ party_size: 16, status: 'paid' }];
a = await getTripAvailability('tgw_abc', 16, NOW);
ok(a.remaining === 0 && a.soldOut === true, 'sold out when exactly full');

ROWS = [{ party_size: 20, status: 'paid' }];
a = await getTripAvailability('tgw_abc', 16, NOW);
ok(a.remaining === 0 && a.soldOut === true, 'over capacity clamps remaining to 0');

ROWS = [];
a = await getTripAvailability('tgw_abc', 0, NOW);
ok(a.soldOut === false && a.remaining === 0, 'capacity 0 (unknown) is never sold out');

// ── the public endpoints must be rate-limited (regression guard) ──
const { limitsFor } = await import('../api/_lib/rate-limit-public.js');
ok(Array.isArray(limitsFor('trip-enquiry')) && limitsFor('trip-enquiry').length >= 1, 'trip-enquiry is rate-limited');
ok(Array.isArray(limitsFor('trip-availability')) && limitsFor('trip-availability').length >= 1, 'trip-availability is rate-limited');

global.fetch = realFetch;
console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'capacity smoke failures');
