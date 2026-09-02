/**
 * Travelgenix Widget Suite — Pay Balance (public endpoint)
 *
 * Called by the embedded My Booking widget to take a balance / next-instalment
 * payment on an order. Creates a Travelify basket via /addgenericitem and
 * returns the basket URL; the widget redirects the customer there to pay.
 *
 * Same security model as /api/retrieve-order and /api/cancel-product:
 *   1. Rate limiting (per IP and per IP+widget)
 *   2. Server-side credential lookup (creds never touch the browser)
 *   3. The per-order key is read server-side and joined into OrderRef
 *      (orderId/orderKey) — it is never sent to or accepted from the browser
 *   4. The amount charged is computed SERVER-SIDE from the order's own deposit
 *      schedule — never taken from the request, so a tampered widget can't set
 *      its own price
 *   5. Only an https basket URL is ever returned for redirect
 *
 * Amount logic:
 *   - Reads the deposit schedule from the raw order (item.dataObject.pricing
 *     .depositOptions — same path the widget reads).
 *   - Charges the NEXT unpaid scheduled payment (earliest by due date), and
 *     reports how many further payments remain.
 *   - For a standard deposit booking that's a single "balance due" payment
 *     (0 remaining). For an instalment plan it's the next instalment.
 *
 * Request (POST /api/pay-balance):
 *   { widgetId, emailAddress, departDate, orderRef }
 *   (the same lookup triplet the customer used to retrieve the order)
 *
 * Response (HTTP 200 unless rate-limited / bad method):
 *   Success:    { success: true, url: "<basket url>", payment: { amount, currency, remaining, dueDate } }
 *   No balance: { success: false, noBalance: true }
 *   Failure:    { success: false }
 */

import { setCors } from './_auth.js';
import {
  rateLimit,
  getClientIp,
  validateWidgetId,
  validateEmail,
  validateDate,
  validateOrderRef,
  resolveWidgetCredentials,
  fetchTravelifyOrderRaw,
  readOrderKey,
  TRAVELIFY_ORIGIN,
} from './_lib/travelify.js';

const ADDGENERICITEM_API = 'https://api.travelify.io/addgenericitem';

function isHttpsUrl(u) {
  return typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u.trim());
}

function parseDate(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// Round to whole pennies.
function p2(n) { return Math.round(n * 100) / 100; }

// Today's date as YYYY-MM-DD (UTC). Injectable so tests can pin "today".
function todayIso(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }

// Find the order's outstanding payment schedule. It lives at the ORDER level
// as `depositOption` (singular); its `breakdown` is the set of payments still
// owed (the taken deposit is `initialAmount`, not in the breakdown).
function findPaymentPlan(raw) {
  const opt = raw?.depositOption;
  const breakdown = (opt && Array.isArray(opt.breakdown)) ? opt.breakdown : [];
  if (!breakdown.length) return null;
  return {
    opt,
    breakdown,
    currency: opt.currency || raw.currency || 'GBP',
    isInstalment: breakdown.length > 1,
  };
}

// Build the order's FULL payment schedule: the deposit `initialAmount` (due
// immediately, carrying no explicit due date) PLUS every `breakdown` instalment.
// The initialAmount is the piece the old code missed — it is due from the moment
// the order is created and is always "due now" until it is paid, so it belongs in
// the schedule, not outside it. Returns null when the order has no depositOption
// schedule at all (a booking payable in full).
function buildSchedule(raw) {
  const opt = raw && raw.depositOption;
  if (!opt || typeof opt !== 'object') return null;
  const currency = opt.currency || raw.currency || 'GBP';
  const entries = [];
  const initial = Number(opt.initialAmount);
  if (Number.isFinite(initial) && initial > 0) {
    // due: -Infinity sorts it first and always counts as "due now".
    entries.push({ amount: p2(initial), day: '', due: -Infinity, isInitial: true });
  }
  const breakdown = Array.isArray(opt.breakdown) ? opt.breakdown : [];
  for (const b of breakdown) {
    const amount = Number(b && b.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const day = (typeof b.dueDate === 'string' && b.dueDate) ? b.dueDate.slice(0, 10) : '';
    const due = parseDate(b.dueDate);
    entries.push({ amount: p2(amount), day, due: due == null ? Infinity : due });
  }
  if (!entries.length) return null;
  entries.sort((a, b) => a.due - b.due);
  return { currency, entries, isInstalment: entries.length > 1 };
}

// Reconcile a schedule against the amount paid to date, allocating payments to
// the EARLIEST outstanding amounts first (so a partial payment settles the
// initial, then instalment 1, and any residual reduces the next). Then split the
// unpaid remainder into what is due on or before `todayStr` and what is still to
// come.
//
// Returns:
//   charge       — the amount to collect now: everything due on or before today
//                  that is still unpaid (initial + due instalments); if nothing
//                  is due yet, the next unpaid instalment.
//   outstanding  — the whole unpaid balance (all remaining schedule entries).
//   dueDate      — the due date the "charge" hangs off (latest due-now instalment
//                  date, or the next instalment's date), or null for initial-only.
function reconcileSchedule(schedule, paid, todayStr) {
  let leftToApply = p2(Math.max(0, paid));
  let dueNow = 0;
  let outstanding = 0;
  let dueNowDate = null;
  let firstFuture = null; // earliest still-unpaid entry that is NOT yet due
  for (const e of schedule.entries) {
    const settled = Math.min(e.amount, leftToApply);
    const unpaid = p2(e.amount - settled);
    leftToApply = p2(leftToApply - settled);
    if (unpaid <= 0) continue;
    outstanding = p2(outstanding + unpaid);
    const isDue = e.isInitial || (e.day && e.day <= todayStr);
    if (isDue) {
      dueNow = p2(dueNow + unpaid);
      if (!e.isInitial && e.day) dueNowDate = e.day;
    } else if (!firstFuture) {
      firstFuture = { unpaid, day: e.day || null };
    }
  }
  const charge = dueNow > 0 ? dueNow : (firstFuture ? firstFuture.unpaid : 0);
  const dueDate = dueNow > 0 ? dueNowDate : (firstFuture ? firstFuture.day : null);
  return { charge, outstanding, dueDate };
}

// Amount already paid against the order. Travelify gives an authoritative
// `paidToDate` scalar; use it when present, else sum the successful payments.
function computePaidToDate(raw) {
  if (typeof raw?.paidToDate === 'number' && Number.isFinite(raw.paidToDate)) {
    return p2(Math.max(0, raw.paidToDate));
  }
  const ps = Array.isArray(raw?.payments) ? raw.payments : [];
  const sum = ps
    .filter(p => p && String(p.status || '').toLowerCase() === 'success')
    .reduce((s, p) => s + (typeof p.amount === 'number' ? p.amount : 0), 0);
  return p2(sum);
}

// The order's payable total (sum of item prices — the holiday cost the
// payments are taken against; in-resort/pay-at-location fees are separate).
function computeOrderTotal(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const sum = items.reduce((s, it) => s + (typeof it.price === 'number' ? it.price : 0), 0);
  // Order-level voucher/promo discount. Travelify stores it as a signed
  // top-level voucherValue (negative = money off) that is NOT reflected in
  // item.price, so the payable total must add it (it only ever reduces). Without
  // this we over-charge by the discount; with it the total matches Travelify's
  // own remaining schedule.
  const voucher = (typeof raw?.voucherValue === 'number' && raw.voucherValue < 0) ? raw.voucherValue : 0;
  return Math.round((sum + voucher) * 100) / 100;
}

// Minimum a customer can choose to part-pay. Full settlement is always allowed
// even if the outstanding is below this floor.
const MIN_PART_PAYMENT = 1;

// Single source of truth for "what (if anything) do we collect now". Everything
// is derived from the order's full payment SCHEDULE — the deposit initialAmount
// plus the breakdown instalments — reconciled against paidToDate, per the
// Travelify contract: the amount due at a date is the sum of every scheduled
// amount due on or before that date, minus payments recorded, applied
// earliest-first. The unpaid initialAmount is ALWAYS due now until settled (the
// bug this fixes: the old code read the breakdown alone and missed it). With no
// depositOption schedule the whole balance is payable in full.
//
//   - requested == null  → the default: everything due on or before today (or the
//     next instalment when nothing is due yet).
//   - requested provided → the customer's chosen amount, RE-VALIDATED here
//     against the real outstanding. The client figure is only a request; the
//     server is the authority on what may be charged.
// `now` is injectable so tests can pin "today".
export function decideCharge(raw, requested, now = Date.now()) {
  const paid = computePaidToDate(raw);
  const total = computeOrderTotal(raw);
  const schedule = buildSchedule(raw);

  let outstanding, defaultAmount, currency, dueDate, isInstalment;
  if (schedule) {
    const r = reconcileSchedule(schedule, paid, todayIso(now));
    outstanding = r.outstanding;
    defaultAmount = r.charge;
    currency = schedule.currency;
    dueDate = r.dueDate;
    isInstalment = schedule.isInstalment;
  } else {
    // No deposit schedule → the whole balance (total − paid) is payable in full.
    // Bailing on a missing schedule once made a genuine £1,800 balance
    // uncollectable (Karen / My Booking, 28 Jul 2026).
    outstanding = Math.max(0, p2(total - paid));
    defaultAmount = outstanding;
    currency = raw.currency || 'GBP';
    dueDate = null;
    isInstalment = false;
  }

  if (!(outstanding > 0)) return { noBalance: true, total, paid, outstanding };

  // A schedule fully caught up (nothing due, only future instalments, all paid
  // down) can leave defaultAmount 0 while a balance still exists — fall back to
  // the outstanding so the customer can always pay.
  let chargeAmount = defaultAmount > 0 ? Math.min(defaultAmount, outstanding) : outstanding;

  if (requested != null && requested !== '') {
    const amt = p2(Number(requested));
    if (!Number.isFinite(amt) || amt <= 0) {
      return { invalid: 'Please enter a valid amount.', outstanding, currency };
    }
    if (amt > outstanding + 0.001) {
      return { invalid: `That's more than the balance on this booking. You can pay up to ${money(outstanding, currency)}.`, outstanding, currency };
    }
    // Allow full settlement of any size; otherwise enforce the part-payment floor.
    const isFull = Math.abs(amt - outstanding) < 0.005;
    if (!isFull && amt < MIN_PART_PAYMENT) {
      return { invalid: `The smallest part payment is ${money(MIN_PART_PAYMENT, currency)}. Pay ${money(outstanding, currency)} to settle in full.`, outstanding, currency };
    }
    chargeAmount = amt;
  }

  if (!(chargeAmount > 0)) return { noBalance: true, total, paid, outstanding };

  const followAmount = Math.max(0, p2(outstanding - chargeAmount));
  return {
    noBalance: false,
    total, paid, outstanding,
    amount: chargeAmount,
    currency,
    dueDate,
    isInstalment: isInstalment && followAmount > 0,
    remainingAmount: followAmount,
  };
}

// Minimal money formatter for server-side validation messages.
function money(n, currency) {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(n);
  } catch {
    return `${currency || 'GBP'} ${Number(n).toFixed(2)}`;
  }
}

// Build ContactInfo from the raw order, omitting anything we don't have (per
// the API guide — never send empty strings). Field paths are best-effort; the
// logged key dump on first run lets us pin the exact raw shape.
function buildContactInfo(raw) {
  const ci = {};
  const put = (k, v) => { if (typeof v === 'string' && v.trim()) ci[k] = v.trim(); };
  const addr = (raw.contact && typeof raw.contact === 'object') ? raw.contact : {};

  put('EmailAddress', raw.customerEmail);
  put('Title', raw.customerTitle);
  put('Firstname', raw.customerFirstname);
  put('Surname', raw.customerSurname);
  put('Address1', raw.customerAddress1 || raw.address1 || addr.address1);
  put('City', raw.customerCity || raw.city || addr.city);
  put('State', raw.customerState || raw.state || addr.state);
  put('PostalCode', raw.customerPostalCode || raw.customerPostcode || raw.postalCode || raw.postcode || addr.postalCode);
  put('CountryCode', raw.customerCountryCode || raw.countryCode || addr.countryCode);

  // Phone is flat fields on the order: customerTelPrefix + customerTelNum.
  const prefix = raw.customerTelPrefix != null ? String(raw.customerTelPrefix).trim() : '';
  const number = raw.customerTelNum != null ? String(raw.customerTelNum).trim() : '';
  if (prefix || number) {
    ci.Telephone = {};
    if (prefix) ci.Telephone.countryPrefix = prefix;
    if (number) ci.Telephone.Number = number;
  }
  return ci;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);

  const ipLimit = rateLimit(`pay:ip:${ip}`, 8);
  if (!ipLimit.ok) {
    return res.status(429).json({
      success: false,
      error: 'Too many attempts. Please wait a few minutes and try again.',
      retryAfterMs: ipLimit.retryAfterMs,
    });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(200).json({ success: false });
  }

  const widgetId = validateWidgetId(body.widgetId);
  const emailAddress = validateEmail(body.emailAddress);
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);

  if (!widgetId || !emailAddress || !departDate || !orderRef) {
    return res.status(200).json({ success: false });
  }

  const widgetLimit = rateLimit(`pay:ipw:${ip}:${widgetId}`, 30);
  if (!widgetLimit.ok) {
    return res.status(429).json({
      success: false,
      error: 'Too many attempts for this booking. Please try again later.',
      retryAfterMs: widgetLimit.retryAfterMs,
    });
  }

  try {
    // 1. Resolve credentials (never sent to browser).
    const creds = await resolveWidgetCredentials(widgetId, 'My Booking');
    if (!creds) return res.status(200).json({ success: false });

    // 2. Fetch the raw order for the order key + payment schedule + contact.
    const raw = await fetchTravelifyOrderRaw(creds, { emailAddress, departDate, orderRef });
    if (!raw) return res.status(200).json({ success: false });

    const orderId = String(raw.id);
    const orderKey = readOrderKey(raw);
    if (!orderKey) {
      console.error('[pay-balance] order key missing on order', orderId, '— keys:', Object.keys(raw).join(','));
      return res.status(200).json({ success: false });
    }

    // 3. Work out what to collect — reconciled against payments already taken,
    //    NOT the raw breakdown (which Travelify leaves in place after payment).
    //    A customer-chosen amount (body.amount) is re-validated server-side.
    const requestedAmount = (body.amount === undefined || body.amount === null || body.amount === '')
      ? null
      : body.amount;
    const decision = decideCharge(raw, requestedAmount);

    if (decision.invalid) {
      // The chosen amount didn't pass server validation (too big, too small,
      // not a number). Tell the widget why so it can show the message.
      return res.status(400).json({ success: false, error: decision.invalid });
    }

    console.log('[pay-balance] order', orderId,
      'total:', decision.total, 'paid:', decision.paid, 'outstanding:', decision.outstanding,
      'requested:', requestedAmount, 'charge:', decision.noBalance ? 'none' : decision.amount);

    if (decision.noBalance) {
      // Nothing left to pay (fully paid, or no schedule we could read).
      return res.status(200).json({ success: false, noBalance: true });
    }

    // 4. Build the addgenericitem payload.
    //    Reference / Description use the human-readable orderRef.
    //    OrderRef is the order id + key joined with a slash (NOT orderRef).
    const payload = {
      Reference: orderRef,
      Title: 'Balance Payment',
      Description: `Balance Payment for Order ${orderRef}`,
      Price: decision.amount,
      Currency: decision.currency,
      OrderRef: `${orderId}/${orderKey}`,
      ContactInfo: buildContactInfo(raw),
    };

    // 5. Create the basket.
    let apiRes;
    try {
      apiRes = await fetch(ADDGENERICITEM_API, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${creds.appId}:${creds.apiKey}`,
          'Content-Type': 'application/json',
          'Origin': TRAVELIFY_ORIGIN,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      console.error('[pay-balance] addgenericitem network error:', err.message);
      return res.status(200).json({ success: false });
    }

    const text = await apiRes.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }

    // 6. Treat anything that isn't success:true with a usable https URL as a
    //    failure (per the guide — generic failure, no redirect).
    const url = json && json.success === true ? json.data : null;
    if (!isHttpsUrl(url)) {
      console.error(`[pay-balance] addgenericitem did not return a basket url for order ${orderId} (status ${apiRes.status})`);
      return res.status(200).json({ success: false });
    }

    return res.status(200).json({
      success: true,
      url: url.trim(),
      payment: {
        amount: decision.amount,
        currency: decision.currency,
        remainingAmount: decision.remainingAmount,
        dueDate: decision.dueDate,
        isInstalment: decision.isInstalment,
      },
    });
  } catch (err) {
    console.error('[pay-balance] error:', err.message);
    return res.status(200).json({ success: false });
  }
}
