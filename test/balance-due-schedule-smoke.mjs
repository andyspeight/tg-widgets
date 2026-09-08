/**
 * Balance due — the amount due must include the unpaid deposit initialAmount and
 * aggregate EVERYTHING due on or before today (Travelify defect report, Sep 2026).
 *
 * The old code read depositOption.breakdown alone and offered a single next
 * instalment, so it missed the unpaid initialAmount and understated "due now".
 * decideCharge (server) and the My Booking widget now build the full schedule
 * (initialAmount + breakdown), reconcile against paidToDate earliest-first, and
 * charge the sum of everything due <= today. The reminder email consumes those
 * figures, so it is fixed by the same change.
 *
 * Reference case (order 118823): total 413, nothing paid, initialAmount 1.00,
 * breakdown [200 due 2026-09-02, 212 due 2026-09-03], today 2026-09-02 →
 * due now 201, remaining 212, balance 413.
 *
 * Run: node test/balance-due-schedule-smoke.mjs   (npm run test:balance-due)
 */
import { readFileSync } from 'node:fs';
import { decideCharge } from '../api/pay-balance.js';
import { renderReminderEmail } from '../api/_lib/payment-reminder-email.js';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

const NOW = Date.parse('2026-09-02T09:00:00Z'); // "today" = 2026-09-02
// An order with a deposit schedule: initialAmount + breakdown, item total = the
// schedule total, and a paidToDate scalar.
const order = (initial, bk, paid = 0) => ({
  currency: 'GBP', paidToDate: paid,
  items: [{ price: initial + bk.reduce((s, b) => s + b.amount, 0) }],
  depositOption: { currency: 'GBP', initialAmount: initial, breakdown: bk },
});
const REF = () => order(1, [{ amount: 200, dueDate: '2026-09-02' }, { amount: 212, dueDate: '2026-09-03' }], 0);

console.log('Reference case 118823 — the acceptance criteria');
{
  const c = decideCharge(REF(), null, NOW);
  ok('due now is £201 (unpaid initial 1 + instalment 200 due today)', c.amount === 201);
  ok('remaining after this payment is £212', c.remainingAmount === 212);
  ok('balance remaining is £413', c.outstanding === 413);
  ok('total holiday cost is £413', c.total === 413);
  ok('due date is 2026-09-02', c.dueDate === '2026-09-02');
  ok('flagged as an instalment (more follows)', c.isInstalment === true);
}

console.log('The due date is TODAY for a due-now amount, never a past instalment date');
{
  // Overdue: an instalment due yesterday is still "due now" → the due date is
  // today, not the past date (the stale-date bug the email showed).
  const c = decideCharge(order(0, [{ amount: 300, dueDate: '2026-09-01' }, { amount: 100, dueDate: '2026-09-10' }], 0), null, NOW);
  ok('overdue instalment → due date is today 2026-09-02, not 2026-09-01', c.dueDate === '2026-09-02' && c.amount === 300);
  // Nothing due yet (initial paid, only future instalments) → the next instalment's own date.
  const f = decideCharge(order(1, [{ amount: 200, dueDate: '2026-09-10' }, { amount: 211, dueDate: '2026-09-20' }], 1), null, NOW);
  ok('future-only → due date is the next instalment date 2026-09-10', f.dueDate === '2026-09-10' && f.amount === 200);
}

console.log('The reminder email shows the corrected figures');
{
  const c = decideCharge(REF(), null, NOW);
  const { html } = renderReminderEmail({
    agency: { name: 'Demo', pageUrl: 'https://demo.example/mb' },
    customerFirstName: 'Sam', orderRef: '118823', charge: c,
    dueDateIso: '2026-09-02', payUrl: 'https://demo.example/mb#tg-pay=118823', sequence: { n: 1, of: 3 }, template: null,
  });
  ok('email "Due now" is £201.00', html.includes('Due now') && html.includes('£201.00'));
  ok('email states £212.00 remaining in later instalments', html.includes('£212.00'));
  ok('email total holiday cost is £413.00', html.includes('Total holiday cost') && html.includes('£413.00'));
  ok('email does NOT show the old £200.00 due', !html.includes('>£200.00<') && !/pay £200\.00 now/i.test(html));
}

console.log('The seven scenarios from the defect report');
{
  // 1. Nothing paid, initial + one instalment due today → both combined.
  ok('1: due now = 201', decideCharge(REF(), null, NOW).amount === 201);
  // 2. Initial already paid, one instalment due today → instalment only.
  ok('2: initial paid → due now 200', decideCharge(order(1, [{ amount: 200, dueDate: '2026-09-02' }, { amount: 212, dueDate: '2026-09-03' }], 1), null, NOW).amount === 200);
  // 3. Multiple instalments now overdue → aggregate all + unpaid initial.
  ok('3: two overdue + initial → due now 413', decideCharge(order(1, [{ amount: 200, dueDate: '2026-09-01' }, { amount: 212, dueDate: '2026-09-02' }], 0), null, NOW).amount === 413);
  // 4. Partial payment that does not cover the initial → shortfall + due.
  {
    const c = decideCharge(order(1, [{ amount: 200, dueDate: '2026-09-02' }, { amount: 212, dueDate: '2026-09-03' }], 0.5), null, NOW);
    ok('4: 0.50 paid → due now 200.50, outstanding 412.50', c.amount === 200.5 && c.outstanding === 412.5);
  }
  // 5. Payment exceeds due now → surplus reduces the next instalment.
  {
    const c = decideCharge(order(1, [{ amount: 200, dueDate: '2026-09-02' }, { amount: 212, dueDate: '2026-09-03' }], 250), null, NOW);
    ok('5: 250 paid → next instalment 163, outstanding 163', c.amount === 163 && c.outstanding === 163);
  }
  // 6. Full balance paid → no payment offered.
  ok('6: fully paid → noBalance', decideCharge(order(1, [{ amount: 200, dueDate: '2026-09-02' }, { amount: 212, dueDate: '2026-09-03' }], 413), null, NOW).noBalance === true);
  // 7. No depositOption → payable in full (existing behaviour unaffected).
  {
    const c = decideCharge({ currency: 'GBP', paidToDate: 100, items: [{ price: 500 }] }, null, NOW);
    ok('7: no schedule → pay full 400', c.amount === 400 && c.outstanding === 400 && !c.isInstalment);
  }
}

console.log('A part-payment request is still validated and capped at outstanding');
{
  ok('over-outstanding is rejected', !!decideCharge(REF(), 999, NOW).invalid);
  ok('a valid part payment is honoured', decideCharge(REF(), 50, NOW).amount === 50);
}

console.log('The My Booking widget runs the SAME schedule logic (a verbatim copy of the shared core)');
{
  // Since 8 Sep 2026 the widget no longer mirrors decideCharge by hand: both
  // run public/_order-money.js (the widget carries a verbatim copy, held in
  // step by test/order-money-drift-smoke.mjs). These checks pin the behaviour
  // the old mirror guaranteed, on the shared code as it sits in the widget.
  const w = readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8');
  ok('widget carries the shared core', /\/\/ >>> order-money core[\s\S]*?\/\/ <<< order-money core/.test(w));
  ok('the schedule reads depositOption.initialAmount as a due-now entry',
    /toMinor\(sched\.initialAmount, digits\)[\s\S]*?isInitial: true/.test(w));
  ok('payments (and voucher credit) settle the earliest entries first',
    /let left = paidM \+ creditM;[\s\S]*?const settle = Math\.min\(e\.amountM, left\);[\s\S]*?const unpaidM = e\.amountM - settle;/.test(w));
  ok('everything due on or before today is aggregated as due now',
    /e\.isInitial \|\| \(!!e\.dueDate && e\.dueDate\.slice\(0, 10\) <= today\)/.test(w));
  ok('the schedule display shows the initial payment as a "Due now" row',
    /b\.isInitial \? \(c\.labels\?\.dueNow \|\| c\.t\('dueNow'\)\)/.test(w));
  ok('the pay button reads the shared figures, not its own sums',
    /const money = orderMoney\(order\);\s*const outstanding = money\.outstanding;/.test(w) && !/function computeOutstanding\(/.test(w) && !/function reconcileSchedule\(order\)/.test(w));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
