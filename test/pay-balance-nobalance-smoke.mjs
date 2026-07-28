/**
 * pay-balance decideCharge — a booking that owes money with NO payment schedule
 * must be payable, not reported as "nothing to pay".
 *
 * Karen (My Booking, 28 Jul 2026): a £1,800 booking with £0 paid and no deposit
 * schedule showed "Pay balance · £1,800" but clicking it returned "There's
 * nothing left to pay on this booking." decideCharge bailed to noBalance whenever
 * the payment SCHEDULE produced no "next instalment" — but a paid-in-full booking
 * (or one Travelify attached no deposit breakdown to) has no schedule while still
 * owing the full balance. The schedule is only used to pick an instalment amount;
 * the outstanding (total − paidToDate) is the authority on whether anything is owed.
 *
 * Drives the REAL exported decideCharge.
 * Run: node test/pay-balance-nobalance-smoke.mjs
 */
import { decideCharge } from '../api/pay-balance.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const order = (over = {}) => ({
  id: 100500,
  currency: 'GBP',
  items: [{ price: 1800 }],
  payments: [],
  ...over,
});

// ── Karen's case: owes £1,800, no payments, NO schedule ───────────────────────
let d = decideCharge(order(), null);
ok(d.noBalance === false, 'no schedule + full balance owed → NOT noBalance (the bug)');
ok(d.outstanding === 1800, 'outstanding is total − paid = 1800');
ok(d.amount === 1800, 'default charge is the full outstanding when there is no schedule');
ok(d.currency === 'GBP', 'currency falls back to the order currency when there is no plan');
ok(d.isInstalment === false && d.remainingAmount === 0, 'a no-schedule payment settles in one go');

// The widget sends the amount from its "Amount to pay" box — 1800 must also work.
d = decideCharge(order(), 1800);
ok(d.noBalance === false && d.amount === 1800, 'requested full amount (1800) with no schedule → charges 1800');

// A part payment against a no-schedule balance is allowed.
d = decideCharge(order(), 500);
ok(d.noBalance === false && d.amount === 500 && d.remainingAmount === 1300, 'part payment (500) leaves 1300 outstanding');

// More than the balance is rejected, not silently charged.
d = decideCharge(order(), 2000);
ok(d.invalid && /more than the balance/i.test(d.invalid), 'over-payment is rejected with a clear message');

// Currency follows the order when there is no plan.
ok(decideCharge(order({ currency: 'EUR' }), null).currency === 'EUR', 'EUR order → EUR charge (no plan)');

// ── Genuinely fully paid → still noBalance ────────────────────────────────────
d = decideCharge(order({ payments: [{ status: 'Success', amount: 1800 }] }), null);
ok(d.noBalance === true && d.outstanding === 0, 'fully paid → noBalance (unchanged)');

// Partly paid, no schedule → the remainder is payable.
d = decideCharge(order({ payments: [{ status: 'Success', amount: 500 }] }), null);
ok(d.noBalance === false && d.outstanding === 1300 && d.amount === 1300, 'part-paid, no schedule → owe the remainder (1300)');

// ── An instalment plan still drives the default amount (unchanged) ────────────
const planOrder = order({
  items: [{ price: 1490 }],
  payments: [{ status: 'Success', amount: 740.5 }],
  depositOption: { currency: 'GBP', breakdown: [{ amount: 740.5, dueDate: '2026-07-01' }, { amount: 749.5, dueDate: '2026-08-15' }] },
});
d = decideCharge(planOrder, null);
ok(d.noBalance === false && d.outstanding === 749.5, 'running instalment plan: outstanding 749.5');
ok(d.amount === 749.5, 'instalment plan charges the remaining instalment');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
