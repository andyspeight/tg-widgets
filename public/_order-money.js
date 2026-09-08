// =============================================================================
//  /public/_order-money.js — the ONE calculation of what a booking still owes
// =============================================================================
//
//  Read by the on-page My Booking widget (which carries a verbatim copy of the
//  core below, held in step by test/order-money-drift-smoke.mjs because the
//  widget is a single script on customer sites and cannot import), the booking
//  PDF (public/_pdf-template.js), the confirmation email
//  (public/_booking-email-template.js), the balance chase emails and the
//  pay-balance charge (api/pay-balance.js). The server computes it once from
//  the raw Travelify order and attaches it to the order as `money`, so every
//  output reads the same figures and none of them does its own sums.
//
//  Why this exists (8 Sep 2026, Travelify developers' note on TG120193): a
//  £9.17 holiday paid for entirely with a £9.17 gift voucher was shown on the
//  page, the PDF and the email as £9.17 still due. Each output had its own
//  arithmetic, none of it read the order's vouchers[] list, and the one place
//  that did read a voucher (the top-level voucherValue) was ignored whenever
//  the order carried a payment schedule.
//
//  The model, from that note:
//    total          the holiday cost, unchanged by vouchers
//    paid           recorded payments
//    voucherCredit  gift vouchers (isGift true) deducted at their absolute
//                   value; a percentage voucher is a share of the TOTAL; the
//                   credit can never exceed the total, the surplus is dropped
//    balance        total - paid - voucherCredit, floored at zero
//    settled        balance is zero at the currency's minor-unit precision
//  Discount vouchers (isGift false) are NOT deducted until a real order proves
//  the discount is not already in the item prices; they are listed under
//  `excluded` so an output can say so. Flip with { deductNonGift: true }.
//
//  Every sum is done in whole minor units (pence), never in binary floating
//  point. Voucher codes leave this module MASKED and only masked.
//
//  Runtime-neutral: no Node imports, no DOM, no environment reads, no Node
//  byte buffers, so the editor previews run the exact code the server runs.
// =============================================================================

// >>> order-money core (verbatim copy lives in public/widget-mybooking.js)
const MINOR_DIGITS = { BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3, CLP: 0, ISK: 0, JPY: 0, KRW: 0, VND: 0, XAF: 0, XOF: 0 };

/** English wording shared by the PDF and the email; the widget translates it. */
const MONEY_STRINGS = {
  settled: 'Your booking is paid in full. No further payment is due.',
  partly: 'Your booking is secured. The remaining {amount} is due before you travel.',
  open: 'Your booking is secured. Any remaining balance is due before travel.',
  amountPayableNow: 'Amount payable now',
  dueNow: 'Due now',
  voucher: 'Voucher',
};

function minorDigits(currency) {
  const c = String(currency || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(MINOR_DIGITS, c) ? MINOR_DIGITS[c] : 2;
}

/** A money amount as whole minor units. Strings are accepted; junk is 0. */
function toMinor(amount, digits) {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.round(n * Math.pow(10, digits));
}

function fromMinor(minor, digits) {
  return minor / Math.pow(10, digits);
}

/**
 * A voucher code for display. Over 12 characters: the last 12 stay, every
 * earlier character becomes *. Five to twelve: the last 4 stay. Four or fewer:
 * all stars. Separators are masked like any other character so the shape of
 * the original is not given away. Empty in, empty out.
 */
function maskVoucherCode(code) {
  const s = String(code == null ? '' : code).trim();
  if (!s) return '';
  const chars = Array.from(s);
  const n = chars.length;
  const keep = n > 12 ? 12 : (n >= 5 ? 4 : 0);
  let stars = '';
  for (let i = 0; i < n - keep; i++) stars += '*';
  return stars + chars.slice(n - keep).join('');
}

function truthy(v) { return v === true || v === 1 || v === 'true' || v === 'True' || v === '1'; }
function falsy(v) { return v === false || v === 0 || v === 'false' || v === 'False' || v === '0'; }

/** One voucher in a known shape, or null when it carries no usable value. */
function normaliseVoucher(v) {
  if (!v || typeof v !== 'object') return null;
  const value = Number(v.value);
  if (!Number.isFinite(value) || value === 0) return null;
  return {
    id: v.id == null ? '' : String(v.id),
    code: v.code == null ? '' : String(v.code).trim(),
    name: typeof v.name === 'string' ? v.name.trim().slice(0, 120) : '',
    value: Math.abs(value),
    isPercent: truthy(v.isPercent),
    // true = gift card (credit), false = discount voucher, null = not stated
    isGift: truthy(v.isGift) ? true : (falsy(v.isGift) ? false : null),
  };
}

/**
 * The vouchers on an order. `vouchers[]` is authoritative. The order-level
 * voucherId / voucherCode / voucherName / voucherValue / voucherIsPercent /
 * voucherIsGift fields are read ONLY when the list is absent or empty and
 * voucherId is populated (or, for the older feed that predates voucherId, when
 * voucherValue alone is set). The two are never summed. Duplicates by id are
 * dropped, first one wins.
 */
function extractVouchers(raw) {
  if (!raw || typeof raw !== 'object') return [];
  let src = Array.isArray(raw.vouchers) ? raw.vouchers.map(normaliseVoucher).filter(Boolean) : [];
  if (!src.length) {
    const hasId = raw.voucherId != null && raw.voucherId !== '' && raw.voucherId !== 0;
    const legacy = raw.voucherId === undefined && typeof raw.voucherValue === 'number' && raw.voucherValue !== 0;
    if (hasId || legacy) {
      const one = normaliseVoucher({
        id: raw.voucherId, code: raw.voucherCode, name: raw.voucherName, value: raw.voucherValue,
        isPercent: raw.voucherIsPercent, isGift: raw.voucherIsGift,
      });
      if (one) src = [one];
    }
  }
  const seen = {};
  const out = [];
  for (const v of src) {
    if (v.id) { if (seen[v.id]) continue; seen[v.id] = true; }
    out.push(v);
  }
  return out;
}

/** Payments received: the recorded successful payments, else the paidToDate scalar. */
function paidFrom(raw) {
  if (!raw || typeof raw !== 'object') return 0;
  if (Array.isArray(raw.payments)) {
    let sum = 0;
    for (const p of raw.payments) {
      if (p && String(p.status || '').toLowerCase() === 'success' && typeof p.amount === 'number' && Number.isFinite(p.amount)) sum += p.amount;
    }
    return sum;
  }
  return (typeof raw.paidToDate === 'number' && Number.isFinite(raw.paidToDate)) ? raw.paidToDate : 0;
}

/**
 * The calculation. Input:
 *   currency       ISO code of the order
 *   total          the holiday cost (item prices summed), unchanged by vouchers
 *   paid           payments received
 *   vouchers       [{ id, code, name, value, isPercent, isGift }]
 *   schedule       { initialAmount, breakdown: [{ amount, dueDate }] } or null
 *   today          'YYYY-MM-DD' (injectable for tests)
 *   deductNonGift  true to treat discount vouchers as credit too (default false)
 *
 * Output carries only masked codes and only rounded, floored figures.
 */
function computeOrderMoney(input) {
  const inp = (input && typeof input === 'object') ? input : {};
  const currency = String(inp.currency || 'GBP').toUpperCase();
  const digits = minorDigits(currency);
  const totalM = Math.max(0, toMinor(inp.total, digits));
  const paidM = Math.max(0, toMinor(inp.paid, digits));
  const deductNonGift = inp.deductNonGift === true;
  const today = (typeof inp.today === 'string' && inp.today) ? inp.today : new Date().toISOString().slice(0, 10);

  const vouchers = [];
  const excluded = [];
  let creditM = 0;
  const list = Array.isArray(inp.vouchers) ? inp.vouchers : [];
  for (let i = 0; i < list.length; i++) {
    const nv = normaliseVoucher(list[i]);
    if (!nv) continue;
    // A percentage voucher is a share of the total holiday cost, never of the
    // balance after payments. Integer arithmetic throughout.
    const rawCreditM = nv.isPercent
      ? Math.round((totalM * Math.round(nv.value * 10000)) / 1000000)
      : toMinor(nv.value, digits);
    const row = {
      name: nv.name, code: maskVoucherCode(nv.code), isPercent: nv.isPercent,
      percent: nv.isPercent ? nv.value : null, isGift: nv.isGift, credit: 0, applied: false,
    };
    if (nv.isGift === false && !deductNonGift) {
      row.value = fromMinor(rawCreditM, digits);
      excluded.push(row);
      continue;
    }
    const room = Math.max(0, totalM - creditM);
    const appliedM = Math.min(rawCreditM, room); // anything over the total is dropped, never carried or refunded
    creditM += appliedM;
    row.credit = fromMinor(appliedM, digits);
    row.applied = true;
    vouchers.push(row);
  }

  const balanceM = Math.max(0, totalM - paidM - creditM);
  const applied = paidM > 0 || creditM > 0;
  const status = (totalM === 0 && !applied) ? 'none' : (balanceM === 0 ? 'settled' : (applied ? 'partly' : 'open'));

  // The payment schedule: the deposit initialAmount (due at once) plus every
  // breakdown instalment, earliest first. Payments AND voucher credit settle
  // the earliest entries first; what is left is what we show and charge.
  const sched = (inp.schedule && typeof inp.schedule === 'object') ? inp.schedule : null;
  const entries = [];
  if (sched) {
    const initialM = toMinor(sched.initialAmount, digits);
    if (initialM > 0) entries.push({ amountM: initialM, dueDate: '', due: -Infinity, isInitial: true });
    const bd = Array.isArray(sched.breakdown) ? sched.breakdown : [];
    for (let i = 0; i < bd.length; i++) {
      const b = bd[i];
      const amountM = toMinor(b && b.amount, digits);
      if (amountM <= 0) continue;
      const dueDate = (b && typeof b.dueDate === 'string') ? b.dueDate : '';
      const due = Date.parse(dueDate);
      entries.push({ amountM, dueDate, due: Number.isFinite(due) ? due : Infinity, isInitial: false });
    }
    entries.sort((a, b) => a.due - b.due);
  }
  const hasSchedule = entries.length > 0;
  let left = paidM + creditM;
  let outstandingM = 0;
  let dueNowM = 0;
  let firstFuture = null;
  const schedule = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const settle = Math.min(e.amountM, left);
    const unpaidM = e.amountM - settle;
    left -= settle;
    if (unpaidM <= 0) continue;
    const isDue = e.isInitial || (!!e.dueDate && e.dueDate.slice(0, 10) <= today);
    outstandingM += unpaidM;
    if (isDue) dueNowM += unpaidM;
    else if (!firstFuture) firstFuture = { unpaidM, dueDate: e.dueDate };
    schedule.push({ amount: fromMinor(unpaidM, digits), dueDate: e.dueDate, isInitial: e.isInitial, isDue });
  }
  const scheduleOutstandingM = hasSchedule ? outstandingM : null;
  // What can be collected: the unpaid schedule, but never more than the
  // balance (a schedule left stale by an amendment must not overcharge), or
  // the whole balance when there is no schedule.
  outstandingM = hasSchedule ? Math.min(outstandingM, balanceM) : balanceM;

  // What to collect now: everything due on or before today that is unpaid, or
  // the next instalment when nothing is due yet, or the whole balance when
  // there is no schedule. Never more than what is outstanding.
  let nextDue = null;
  if (outstandingM > 0) {
    let amountM = hasSchedule ? (dueNowM > 0 ? dueNowM : (firstFuture ? firstFuture.unpaidM : 0)) : outstandingM;
    if (amountM <= 0) amountM = outstandingM;
    amountM = Math.min(amountM, outstandingM);
    nextDue = {
      amount: fromMinor(amountM, digits),
      dueDate: hasSchedule ? (dueNowM > 0 ? today : (firstFuture ? firstFuture.dueDate : null)) : null,
      remainingAmount: fromMinor(outstandingM - amountM, digits),
      isInstalment: schedule.length > 1,
    };
  }
  const payableM = nextDue ? toMinor(nextDue.amount, digits) : 0;

  return {
    currency, digits,
    total: fromMinor(totalM, digits),
    paid: fromMinor(paidM, digits),
    voucherCredit: fromMinor(creditM, digits),
    balance: fromMinor(balanceM, digits),
    vouchers, excluded,
    status, settled: status === 'settled', applied,
    hasSchedule, schedule,
    scheduleOutstanding: scheduleOutstandingM == null ? null : fromMinor(scheduleOutstandingM, digits),
    outstanding: fromMinor(outstandingM, digits),
    isInstalment: schedule.length > 1,
    nextDue,
    payable: fromMinor(payableM, digits),
  };
}

/** The holiday cost of an order in either shape: item prices summed. */
function totalFrom(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  let sum = 0;
  let any = false;
  for (let i = 0; i < items.length; i++) {
    const p = items[i] && items[i].price;
    if (typeof p === 'number' && Number.isFinite(p)) { sum += p; any = true; }
  }
  if (any) return sum;
  const summary = (order.summary && typeof order.summary === 'object') ? order.summary : {};
  if (typeof summary.totalPrice === 'number' && summary.totalPrice > 0) return summary.totalPrice;
  const acc = items.find((it) => it && (it.product === 'Accommodation' || it.product === 'Packages')) || null;
  const pricing = acc && acc.accommodation && acc.accommodation.pricing;
  if (pricing && typeof pricing.memberPrice === 'number') return pricing.memberPrice;
  if (pricing && typeof pricing.price === 'number') return pricing.price;
  return 0;
}

function currencyFrom(order) {
  if (typeof order.currency === 'string' && order.currency.trim()) return order.currency.trim();
  const dep = order.depositOption;
  if (dep && typeof dep.currency === 'string' && dep.currency.trim()) return dep.currency.trim();
  const items = Array.isArray(order.items) ? order.items : [];
  for (let i = 0; i < items.length; i++) {
    if (items[i] && typeof items[i].currency === 'string' && items[i].currency.trim()) return items[i].currency.trim();
  }
  return 'GBP';
}

/**
 * The money block for an order in EITHER shape: the raw Travelify order (the
 * server) or the trimmed order the widget and templates receive (which carries
 * `money` already, or, for a hand-made sample, the fields to build it from).
 * The legacy single `voucher` object of the pre-Sep 2026 trim is honoured as
 * a gift credit so an old cached order still reads correctly.
 */
function moneyOf(order, opts) {
  const o = (order && typeof order === 'object') ? order : {};
  const m = o.money;
  if (m && typeof m === 'object' && typeof m.balance === 'number' && Array.isArray(m.vouchers)) return m;
  const options = (opts && typeof opts === 'object') ? opts : {};
  let vouchers = extractVouchers(o);
  if (!vouchers.length && o.voucher && typeof o.voucher === 'object' && typeof o.voucher.value === 'number') {
    vouchers = [{ code: o.voucher.code, name: o.voucher.name, value: o.voucher.value, isPercent: false, isGift: true }];
  }
  return computeOrderMoney({
    currency: currencyFrom(o),
    total: totalFrom(o),
    paid: paidFrom(o),
    vouchers,
    schedule: (o.depositOption && typeof o.depositOption === 'object') ? o.depositOption : null,
    today: options.today,
    deductNonGift: options.deductNonGift === true,
  });
}

/** The one-line payment status, in English, for the PDF and the email. */
function paymentStatusMessage(money, formatMoney) {
  if (!money || money.status === 'none') return '';
  if (money.status === 'settled') return MONEY_STRINGS.settled;
  if (money.status === 'partly') return MONEY_STRINGS.partly.replace('{amount}', formatMoney(money.balance, money.currency));
  return MONEY_STRINGS.open;
}

/** "Gift Card · ****1234" or "Spring offer (10%)" for a voucher row. */
function voucherLabel(v, fallback) {
  const name = (v && v.name) || fallback || MONEY_STRINGS.voucher;
  const pct = (v && v.isPercent && typeof v.percent === 'number') ? ` (${v.percent}%)` : '';
  const code = (v && v.code) ? ` · ${v.code}` : '';
  return `${name}${pct}${code}`;
}
// <<< order-money core

export {
  MINOR_DIGITS, MONEY_STRINGS, minorDigits, toMinor, fromMinor, maskVoucherCode, normaliseVoucher,
  extractVouchers, paidFrom, totalFrom, currencyFrom, computeOrderMoney, moneyOf, paymentStatusMessage, voucherLabel,
};
