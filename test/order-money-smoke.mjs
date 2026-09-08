/**
 * My Booking: vouchers count, and every output agrees (8 Sep 2026).
 *
 * The Travelify developers' report on order TG120193: a £9.17 holiday paid in
 * full with a £9.17 gift voucher was shown on the page, the PDF and the email
 * as £9.17 still due, and the PDF's bold summary row repeated "Total holiday
 * cost". Each output had its own sums and none read the order's vouchers[].
 *
 * Now ONE calculation (public/_order-money.js) is run on the raw order by the
 * server and attached as order.money; the page, the PDF, the email and the
 * pay-balance charge all read it. This suite drives the seven acceptance
 * cases from the note, the edge cases, the masking table, and renders all
 * three outputs for TG120193's shape to prove they agree and that the raw
 * voucher code appears in none of them.
 *
 * Run: node test/order-money-smoke.mjs   (npm run test:order-money)
 */
import { readFileSync } from 'node:fs';
import {
  computeOrderMoney, maskVoucherCode, extractVouchers, moneyOf, paymentStatusMessage, voucherLabel, MONEY_STRINGS,
} from '../public/_order-money.js';
import { renderPdfHtml } from '../public/_pdf-template.js';
import { renderBookingEmail } from '../api/_lib/booking-email-template.js';
import { decideCharge } from '../api/pay-balance.js';
import { buildOrderShapeReport } from '../api/admin/order-shape.js';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };
const TODAY = '2026-09-08';
const RAW_CODE = '50aa07d4-cbd8-4e41-9c16-f2174294dd07';
const MASKED = '************************f2174294dd07';
const calc = (o) => computeOrderMoney(Object.assign({ currency: 'GBP', today: TODAY }, o));
const gift = (value, extra) => Object.assign({ id: 'v' + Math.random().toString(36).slice(2, 8), code: RAW_CODE, name: 'Gift Card', value, isPercent: false, isGift: true }, extra || {});

console.log('Voucher codes are masked, per the table');
{
  ok('over 12 characters: last 12 stay, every earlier character (separators too) becomes *', maskVoucherCode(RAW_CODE) === MASKED);
  ok('13 characters: one star then twelve', maskVoucherCode('ABCDEFGHIJKLM') === '*BCDEFGHIJKLM');
  ok('12 characters: last 4 stay', maskVoucherCode('ABCD-EFGH-IJ') === '********H-IJ');
  ok('5 characters: last 4 stay', maskVoucherCode('AB123') === '*B123');
  ok('4 characters: all stars', maskVoucherCode('AB12') === '****');
  ok('1 character: all stars', maskVoucherCode('A') === '*');
  ok('empty or absent: empty', maskVoucherCode('') === '' && maskVoucherCode(null) === '' && maskVoucherCode(undefined) === '' && maskVoucherCode('   ') === '');
  ok('a number code is masked like text', maskVoucherCode(123456) === '**3456');
}

console.log('\nVouchers are read from vouchers[] first, the order-level fields only as a fallback');
{
  const both = { vouchers: [{ id: 7, code: RAW_CODE, name: 'Gift Card', value: -9.17, isPercent: false, isGift: true }], voucherId: 7, voucherCode: RAW_CODE, voucherName: 'Gift Card', voucherValue: -9.17, voucherIsPercent: false, voucherIsGift: true };
  ok('both present: ONE voucher, never summed', extractVouchers(both).length === 1 && extractVouchers(both)[0].value === 9.17);
  const fallback = { vouchers: [], voucherId: 7, voucherCode: 'ABC12', voucherName: 'Gift', value: 0, voucherValue: -5, voucherIsGift: true };
  ok('vouchers[] empty + voucherId populated: the order-level fields are read', extractVouchers(fallback).length === 1 && extractVouchers(fallback)[0].value === 5 && extractVouchers(fallback)[0].code === 'ABC12');
  ok('vouchers[] empty + voucherId empty: nothing', extractVouchers({ vouchers: [], voucherId: null, voucherValue: -5 }).length === 0 && extractVouchers({ vouchers: [], voucherId: '', voucherValue: -5 }).length === 0);
  ok('the older feed (no voucherId field at all, a signed voucherValue) still reads', extractVouchers({ voucherValue: -12.5, voucherCode: 'OLD', voucherName: 'Promo' }).length === 1);
  ok('absent entirely: nothing', extractVouchers({}).length === 0 && extractVouchers(null).length === 0);
  const dup = { vouchers: [{ id: 1, value: -10, isGift: true }, { id: 1, value: -10, isGift: true }, { id: 2, value: -5, isGift: true }] };
  ok('duplicates by id are dropped, first wins', extractVouchers(dup).length === 2);
  ok('the sign is ignored: the magnitude is the credit', extractVouchers({ vouchers: [{ id: 1, value: 9.17 }] })[0].value === 9.17 && extractVouchers({ vouchers: [{ id: 1, value: '-9.17' }] })[0].value === 9.17);
  ok('a zero or junk value is no voucher', extractVouchers({ vouchers: [{ id: 1, value: 0 }, { id: 2, value: 'abc' }, null, 'x'] }).length === 0);
}

console.log('\nThe seven acceptance cases');
{
  const c1 = calc({ total: 9.17, paid: 0, vouchers: [gift(-9.17)] });
  ok('1. total 9.17, gift voucher -9.17: credit 9.17, balance 0.00, settled', c1.voucherCredit === 9.17 && c1.balance === 0 && c1.settled && c1.status === 'settled');
  ok('1. the voucher row shows Gift Card, the masked code and the credit', c1.vouchers.length === 1 && c1.vouchers[0].name === 'Gift Card' && c1.vouchers[0].code === MASKED && c1.vouchers[0].credit === 9.17);
  ok('1. paid-in-full message', paymentStatusMessage(c1, (n) => '£' + n.toFixed(2)) === MONEY_STRINGS.settled);
  ok('1. nothing payable now, no pay prompt', c1.payable === 0 && c1.nextDue === null && c1.outstanding === 0);

  const c2 = calc({ total: 500, paid: 100, vouchers: [gift(-50)] });
  ok('2. total 500, payment 100, gift voucher -50: balance 350, both rows', c2.balance === 350 && c2.paid === 100 && c2.vouchers.length === 1 && c2.vouchers[0].credit === 50 && c2.status === 'partly');
  ok('2. the part-paid message names the remaining amount', paymentStatusMessage(c2, (n) => '£' + n.toFixed(2)) === 'Your booking is secured. The remaining £350.00 is due before you travel.');

  const c3 = calc({ total: 500, paid: 0, vouchers: [gift(10, { isPercent: true })] });
  ok('3. total 500, voucher 10 percent: credit 50.00, balance 450.00', c3.voucherCredit === 50 && c3.balance === 450 && c3.vouchers[0].percent === 10);
  ok('3. the label carries the percentage but the row shows the money', voucherLabel(c3.vouchers[0]) === 'Gift Card (10%) · ' + MASKED);

  const c4 = calc({ total: 20, paid: 0, vouchers: [gift(-50)] });
  ok('4. total 20, voucher -50: credit capped at 20.00, balance 0.00, nothing negative anywhere', c4.voucherCredit === 20 && c4.vouchers[0].credit === 20 && c4.balance === 0 && c4.settled && !JSON.stringify(c4).includes('-'));

  const c5 = calc({ total: 500, paid: 0, vouchers: [gift(-50), gift(-25)] });
  ok('5. two vouchers -50 and -25: credit 75, balance 425, two rows', c5.voucherCredit === 75 && c5.balance === 425 && c5.vouchers.length === 2);

  const c6 = calc({ total: 500, paid: 100, vouchers: [] });
  ok('6. no vouchers: total, paid and balance as before, no voucher rows', c6.total === 500 && c6.paid === 100 && c6.balance === 400 && c6.vouchers.length === 0 && c6.voucherCredit === 0 && c6.status === 'partly');
  const c6b = calc({ total: 500, paid: 0 });
  ok('6. no vouchers, nothing paid: the balance is the total and the status is open (current wording)', c6b.balance === 500 && c6b.status === 'open' && paymentStatusMessage(c6b, String) === MONEY_STRINGS.open);
}

console.log('\nEdge cases');
{
  ok('voucher plus part payment settling exactly', calc({ total: 100, paid: 60, vouchers: [gift(-40)] }).settled === true);
  const frac = calc({ total: 333.33, paid: 0, vouchers: [gift(10, { isPercent: true })] });
  ok('a percentage voucher with a fractional result rounds to 2 places (333.33 at 10% = 33.33)', frac.voucherCredit === 33.33 && frac.balance === 299.99 + 0.01 ? frac.balance === 300 : frac.balance === 300);
  ok('percentages are taken off the TOTAL, not the post-payment balance', calc({ total: 500, paid: 400, vouchers: [gift(10, { isPercent: true })] }).voucherCredit === 50);
  const nocode = calc({ total: 50, paid: 0, vouchers: [gift(-10, { code: null })] });
  ok('a voucher with a null code: name only, no code element', nocode.vouchers[0].code === '' && voucherLabel(nocode.vouchers[0]) === 'Gift Card');
  ok('a voucher with no name: the fallback word', voucherLabel({ name: '', code: '' }) === 'Voucher' && voucherLabel({ name: '', code: '' }, 'Bon') === 'Bon');
  const zero = calc({ total: 0, paid: 0, vouchers: [] });
  ok('a zero-total order: nothing to show and nothing to pay', zero.status === 'none' && zero.balance === 0 && zero.payable === 0);
  ok('a zero-total order with a voucher: no negative, no credit beyond the total', calc({ total: 0, vouchers: [gift(-5)] }).voucherCredit === 0);
  ok('binary float traps do not leak (1.10 less 1.00 less 0.10 is exactly zero)', calc({ total: 1.1, paid: 1, vouchers: [gift(-0.1)] }).settled === true);
  ok('settled is judged at minor-unit precision, not on raw floats', calc({ total: 9.17, paid: 9.166 }).settled === true && calc({ total: 9.17, paid: 9.16 }).settled === false);
  ok('a balance is never negative (overpaid)', calc({ total: 100, paid: 150 }).balance === 0);
  ok('yen has no minor units: 1000 less a 1000 voucher settles, and shows 1000 not 10.00', (() => { const y = calc({ currency: 'JPY', total: 1000, vouchers: [gift(-1000)] }); return y.settled && y.total === 1000 && y.digits === 0; })());
  ok('dinar has three: 10.005 less 10.005 settles', calc({ currency: 'KWD', total: 10.005, vouchers: [gift(-10.005)] }).settled === true);
  ok('amended total: the balance is recomputed from current values (the schedule is capped, never trusted over the balance)', (() => { const m = calc({ total: 300, paid: 100, vouchers: [gift(-50)], schedule: { initialAmount: 100, breakdown: [{ amount: 400, dueDate: '2026-12-01' }] } }); return m.balance === 150 && m.outstanding === 150 && m.nextDue.amount === 150; })());
}

console.log('\nGift vouchers are credit; discount vouchers wait for evidence');
{
  const disc = calc({ total: 500, paid: 0, vouchers: [gift(-50, { isGift: false, name: 'Spring offer' })] });
  ok('isGift false: listed under excluded, NOT deducted', disc.vouchers.length === 0 && disc.excluded.length === 1 && disc.excluded[0].name === 'Spring offer' && disc.balance === 500 && disc.voucherCredit === 0);
  ok('the excluded row still carries a masked code only', disc.excluded[0].code === MASKED && !JSON.stringify(disc).includes(RAW_CODE));
  const on = calc({ total: 500, paid: 0, vouchers: [gift(-50, { isGift: false })], deductNonGift: true });
  ok('the switch deducts discount vouchers too (TG_DEDUCT_NON_GIFT_VOUCHERS=1 on the server)', on.vouchers.length === 1 && on.balance === 450);
  ok('isGift not stated: treated as credit, like the feed before the flag existed', calc({ total: 500, vouchers: [{ id: 1, value: -50 }] }).balance === 450);
  ok('string flags are understood', calc({ total: 500, vouchers: [{ id: 1, value: -50, isGift: 'false' }] }).balance === 500 && calc({ total: 500, vouchers: [{ id: 1, value: 10, isPercent: 'true', isGift: 'true' }] }).voucherCredit === 50);
}

console.log('\nThe schedule: payments and voucher credit settle the earliest entries first');
{
  const sched = { initialAmount: 100, breakdown: [{ amount: 200, dueDate: '2026-10-01' }, { amount: 200, dueDate: '2026-11-01' }] };
  const m = calc({ total: 500, paid: 100, vouchers: [gift(-50)], schedule: sched });
  ok('the initial is settled by the payment, the voucher reduces the first instalment', m.schedule.length === 2 && m.schedule[0].amount === 150 && m.schedule[1].amount === 200 && m.balance === 350 && m.scheduleOutstanding === 350);
  ok('next due is the first future instalment (nothing due yet)', m.nextDue.amount === 150 && m.nextDue.dueDate === '2026-10-01' && m.nextDue.isInstalment === true && m.nextDue.remainingAmount === 200);
  ok('payable now is that instalment', m.payable === 150);
  const due = calc({ total: 500, paid: 0, vouchers: [], schedule: sched, today: '2026-10-15' });
  ok('everything due on or before today is due now, dated today', due.nextDue.amount === 300 && due.nextDue.dueDate === '2026-10-15' && due.schedule[0].isInitial && due.schedule[0].isDue && due.schedule[1].isDue && !due.schedule[2].isDue);
  const settledBySched = calc({ total: 500, paid: 0, vouchers: [gift(-500)], schedule: sched });
  ok('a voucher covering the whole schedule leaves nothing due', settledBySched.settled && settledBySched.schedule.length === 0 && settledBySched.nextDue === null && settledBySched.payable === 0);
  ok('no schedule: the whole balance is payable now', calc({ total: 500, paid: 100 }).nextDue.amount === 400 && calc({ total: 500, paid: 100 }).nextDue.dueDate === null);
}

// A raw Travelify order in TG120193's shape: one product at 9.17, a gift
// voucher for the same amount in vouchers[] AND the order-level fields.
function rawOrder(over) {
  return Object.assign({
    id: 120193, status: 'Confirmed', currency: 'GBP', created: '2026-09-01T10:00:00',
    customerTitle: 'Ms', customerFirstname: 'Test', customerSurname: 'Customer', customerEmail: 'test@example.com',
    items: [{ id: 1, status: 'Confirmed', product: 'Accommodation', bookingReference: 'HOTEL1', price: 9.17, currency: 'GBP', startDate: '2026-12-05T00:00:00', duration: 7,
      dataObject: { ruleIds: [], priceChanged: false, priceBeforeChange: null },
      accommodation: { name: 'Test Hotel', rating: 4, location: { city: 'Palma', country: 'ES' }, units: [{ name: 'Double Room', nights: 7, sleepsAdults: 2 }], pricing: { currency: 'GBP', price: 9.17 }, guests: [{ type: 'Adult', title: 'Ms', firstname: 'Test', surname: 'Customer' }], media: [], descriptions: [], amenities: [], goodFor: [] } }],
    payments: [],
    vouchers: [{ id: 'e1b2', code: RAW_CODE, name: 'Gift Card', value: -9.17, isPercent: false, isGift: true }],
    voucherId: 'e1b2', voucherCode: RAW_CODE, voucherName: 'Gift Card', voucherValue: -9.17, voucherIsPercent: false, voucherIsGift: true,
    depositOption: null, documents: [],
  }, over || {});
}
// The trimmed shape the endpoints hand to the widget and the templates, with
// the money block computed from the raw order (what retrieve-order does).
function trimmed(raw) {
  const items = raw.items;
  return {
    id: raw.id, status: raw.status, customerTitle: raw.customerTitle, customerFirstname: raw.customerFirstname, customerSurname: raw.customerSurname,
    customerEmail: raw.customerEmail, currency: raw.currency, created: raw.created, items,
    summary: { totalPrice: items.reduce((a, i) => a + i.price, 0), hasAccommodation: true, hasFlights: false, earliestStart: items[0].startDate, travellers: items[0].accommodation.guests },
    money: moneyOf(raw, { today: TODAY }),
    paidToDate: (raw.payments || []).filter((p) => p.status === 'success').reduce((a, p) => a + p.amount, 0),
    depositOption: raw.depositOption, documents: [],
  };
}

async function renderPage(order) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { runScripts: 'outside-only', url: 'https://agency.example.com/', pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  window.eval(readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8'));
  const host = window.document.getElementById('host');
  const inst = new window.TGMyBookingWidget(host, {});
  inst.lookup = { email: order.customerEmail, date: '2026-12-05', ref: 'TG120193' };
  inst.state = { stage: 'found', order, error: null };
  inst._render();
  return host.shadowRoot.innerHTML;
}

console.log('\nTG120193: the page, the PDF and the email agree, and none of them shows the code');
{
  const raw = rawOrder();
  const order = trimmed(raw);
  const page = await renderPage(order);
  const pdf = renderPdfHtml(order, { brandName: 'Test Travel' });
  const email = renderBookingEmail({ order, orderRef: 'TG120193', brand: { name: 'Test Travel' } });
  const outputs = { page, pdf, emailHtml: email.html, emailText: email.text };
  for (const [name, out] of Object.entries(outputs)) {
    // The PDF's own money formatter writes a negative as "– £9.17" (its
    // column typography); the page and the email write "-£9.17". Same figure.
    ok(name + ': total 9.17, voucher row -£9.17 with Gift Card and the masked code', /£9\.17/.test(out) && /(-|– )£9\.17/.test(out) && /Gift Card/.test(out) && out.includes(MASKED));
    ok(name + ': balance £0.00 and nothing payable now', /Balance remaining[\s\S]{0,400}?£0\.00/.test(out) && new RegExp(MONEY_STRINGS.amountPayableNow + '[\\s\\S]{0,400}?£0\\.00').test(out));
    ok(name + ': the paid-in-full message', out.includes(MONEY_STRINGS.settled));
    ok(name + ': the raw voucher code appears nowhere', !out.includes(RAW_CODE) && !out.includes('50aa07d4'));
  }
  ok('the page shows no Pay button', !/data-tgm-pay-open/.test(page));
  ok('the PDF summary row is "Amount payable now", not a second "Total holiday cost"', (pdf.match(/Total holiday cost/g) || []).length === 1 && /pdf-pay-row total[\s\S]*?Amount payable now/.test(pdf));
  ok('the email says paid in full in words and in the text part', /Paid in full|paid in full/.test(email.html) && email.text.includes(MONEY_STRINGS.settled));
  ok('the trimmed order carries only the masked code (what the browser receives)', !JSON.stringify(order.money).includes(RAW_CODE) && order.money.vouchers[0].code === MASKED);
  const charge = decideCharge(raw, null, Date.parse(TODAY));
  ok('pay-balance would not charge anything', charge.noBalance === true && charge.outstanding === 0 && charge.voucherCredit === 9.17);
}

console.log('\nCase 2 across the outputs, and a partly paid message that names the amount');
{
  const raw = rawOrder({ items: [Object.assign({}, rawOrder().items[0], { price: 500 })], payments: [{ amount: 100, status: 'success', date: '2026-09-02' }], vouchers: [{ id: 'g2', code: 'GIFT-2026-ABCD', name: 'Gift Card', value: -50, isPercent: false, isGift: true }], voucherId: 'g2', voucherCode: 'GIFT-2026-ABCD', voucherValue: -50 });
  const order = trimmed(raw);
  const page = await renderPage(order);
  const pdf = renderPdfHtml(order, { brandName: 'Test Travel' });
  const email = renderBookingEmail({ order, orderRef: 'TG120193', brand: { name: 'Test Travel' } });
  for (const [name, out] of Object.entries({ page, pdf, emailHtml: email.html, emailText: email.text })) {
    // GIFT-2026-ABCD is 14 characters, so the last 12 stay: **FT-2026-ABCD
    ok(name + ': paid £100.00, voucher -£50.00 (masked **FT-2026-ABCD), balance £350.00', /£100\.00/.test(out) && /(-|– )£50\.00/.test(out) && out.includes('**FT-2026-ABCD') && /Balance remaining[\s\S]{0,400}?£350\.00/.test(out) && !out.includes('GIFT-2026-ABCD'));
    ok(name + ': the remaining amount is named as due before travel', out.includes('The remaining £350.00 is due before you travel.'));
  }
  ok('the page offers to pay £350.00', /data-tgm-pay-open/.test(page) && /350\.00/.test(page));
  const charge = decideCharge(raw, null, Date.parse(TODAY));
  ok('pay-balance charges the same £350.00', charge.amount === 350 && charge.outstanding === 350 && charge.voucherCredit === 50 && charge.total === 500);
  ok('the rows come in the required order: paid, voucher, balance, amount payable', (() => { const i = (s) => page.indexOf(s); return i('Paid so far') < i('Gift Card') && i('Gift Card') < i('Balance remaining') && i('Balance remaining') < i('Amount payable now'); })());
}

console.log('\nNo vouchers: nothing new appears');
{
  const raw = rawOrder({ items: [Object.assign({}, rawOrder().items[0], { price: 500 })], payments: [{ amount: 100, status: 'success' }], vouchers: [], voucherId: null, voucherCode: null, voucherName: null, voucherValue: 0 });
  const order = trimmed(raw);
  const page = await renderPage(order);
  const pdf = renderPdfHtml(order, { brandName: 'Test Travel' });
  const email = renderBookingEmail({ order, orderRef: 'TG120193', brand: { name: 'Test Travel' } });
  for (const [name, out] of Object.entries({ page, pdf, emailHtml: email.html })) {
    ok(name + ': no voucher row, paid £100.00, balance £400.00', !/Gift Card|Voucher/.test(out.replace(/vouchers, tickets/g, '')) && /£100\.00/.test(out) && /Balance remaining[\s\S]{0,400}?£400\.00/.test(out));
  }
  const untouched = trimmed(rawOrder({ items: [Object.assign({}, rawOrder().items[0], { price: 500 })], vouchers: [], voucherId: null, voucherValue: 0 }));
  const pdf2 = renderPdfHtml(untouched, { brandName: 'Test Travel' });
  ok('nothing applied: the PDF keeps its current wording', pdf2.includes(MONEY_STRINGS.open));
  const page2 = await renderPage(untouched);
  ok('nothing applied: the page shows no status line (as before)', !/class="tgm-pay-status/.test(page2));
}

console.log('\nThe staff inspector reports the money, masks the code and copies nothing personal');
{
  const raw = rawOrder();
  const report = buildOrderShapeReport(raw, {});
  const json = JSON.stringify(report);
  ok('the money block is there, settled', report.money.settled === true && report.money.balance === 0);
  ok('both voucher sources are shown, masked, with the item pricing flags', report.vouchersList[0].code === MASKED && report.orderLevelVoucher.voucherCode === MASKED && report.items[0].pricingFlags.priceChanged === false && !json.includes(RAW_CODE));
  ok('no customer name or email', !json.includes('test@example.com') && !json.includes('Customer'));
}

console.log('\nThe editor sample and an old cached order still read');
{
  const legacy = { summary: { totalPrice: 500 }, items: [{ product: 'Accommodation', price: 500 }], paidToDate: 100, voucher: { code: RAW_CODE, name: 'Promo', value: -50 }, depositOption: null };
  const m = moneyOf(legacy, { today: TODAY });
  ok('the pre-Sep-2026 single voucher object is honoured as credit, masked', m.balance === 350 && m.vouchers[0].code === MASKED);
  ok('a sample with no money block is computed by the same code', moneyOf({ summary: { totalPrice: 1409.6 }, items: [{ product: 'Accommodation', price: 1409.6 }], paidToDate: 352.4, depositOption: { initialAmount: 352.4, breakdown: [{ amount: 352.4, dueDate: '2026-10-08' }, { amount: 352.4, dueDate: '2026-11-08' }, { amount: 352.4, dueDate: '2026-12-08' }] } }, { today: TODAY }).balance === 1057.2);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
