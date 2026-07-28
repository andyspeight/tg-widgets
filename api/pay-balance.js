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

// A scheduled payment is treated as already settled if the raw entry carries
// any of the common paid markers. Field names aren't confirmed against a live
// payload yet, so we check the obvious candidates defensively.
function isPaidEntry(b) {
  if (!b || typeof b !== 'object') return false;
  if (b.paid === true || b.isPaid === true || b.settled === true) return true;
  const status = String(b.status || b.state || '').toLowerCase();
  return /paid|settled|complete/.test(status);
}

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

// Determine the next payment to collect + how many remain after it.
// `outstanding` (total − paidToDate) is the authority on what's still owed:
// Travelify leaves the breakdown unchanged after payments are taken (online
// OR added manually by the agent), so the genuinely remaining schedule is the
// TAIL of the plan that sums to the outstanding — payments settle the
// earliest entries first. Walk from the last entry backwards, capping the
// boundary entry if a payment part-covered it. This stops an already-settled
// instalment being offered (and charged) again.
function computeNextPayment(plan, outstanding) {
  if (!plan) return null;

  const entries = plan.breakdown
    .map(b => ({
      amount: Number(b.amount),
      dueDate: typeof b.dueDate === 'string' ? b.dueDate : '',
      due: parseDate(b.dueDate),
      paid: isPaidEntry(b),
    }))
    .filter(e => Number.isFinite(e.amount) && e.amount > 0);

  if (!entries.length) return null;

  // Prefer entries not flagged paid. If nothing carries a paid flag, treat all
  // scheduled payments as candidates — the reconciliation below settles them
  // against the real outstanding.
  const unpaid = entries.filter(e => !e.paid);
  const pool = unpaid.length ? unpaid : entries;

  pool.sort((a, b) => {
    if (a.due == null && b.due == null) return 0;
    if (a.due == null) return 1;
    if (b.due == null) return -1;
    return a.due - b.due;
  });

  // Reconcile: keep only the latest entries summing to the outstanding.
  let remaining = pool;
  if (Number.isFinite(outstanding) && outstanding > 0) {
    let need = Math.round(outstanding * 100) / 100;
    const left = [];
    for (let i = pool.length - 1; i >= 0 && need > 0.004; i--) {
      const take = Math.min(pool[i].amount, need);
      left.unshift({ ...pool[i], amount: Math.round(take * 100) / 100 });
      need = Math.round((need - take) * 100) / 100;
    }
    if (left.length) remaining = left;
  }

  const next = remaining[0];
  const rest = remaining.slice(1);
  return {
    amount: Math.round(next.amount * 100) / 100,
    currency: plan.currency,
    dueDate: next.dueDate || null,
    remaining: rest.length,
    remainingAmount: Math.round(rest.reduce((s, e) => s + e.amount, 0) * 100) / 100,
    isInstalment: remaining.length > 1,
  };
}

// Sum of successful payments already taken against the order.
function computePaidToDate(raw) {
  const ps = Array.isArray(raw?.payments) ? raw.payments : [];
  const sum = ps
    .filter(p => p && String(p.status || '').toLowerCase() === 'success')
    .reduce((s, p) => s + (typeof p.amount === 'number' ? p.amount : 0), 0);
  return Math.round(sum * 100) / 100;
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

// Single source of truth for "what (if anything) do we collect now". The
// depositOption.breakdown is only a SCHEDULE — Travelify does NOT clear it
// after a payment is taken — so the authoritative outstanding figure is
// total - paidToDate, never the raw breakdown sum. We use the breakdown only
// to pick the next instalment's amount/date, and we cap that at outstanding.
// Minimum a customer can choose to part-pay. Full settlement is always allowed
// even if the outstanding is below this floor.
const MIN_PART_PAYMENT = 1;

// Decide what to actually collect.
//   - requested == null  → the default (next instalment, or full balance).
//   - requested provided → the customer's chosen amount, RE-VALIDATED here
//     against the real outstanding. The client figure is only a request; the
//     server is the authority on what may be charged.
export function decideCharge(raw, requested) {
  const plan = findPaymentPlan(raw);
  const paid = computePaidToDate(raw);
  const total = computeOrderTotal(raw);
  const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);
  const next = computeNextPayment(plan, outstanding);

  if (!(outstanding > 0)) return { noBalance: true, total, paid, outstanding };

  // `next` comes from the payment SCHEDULE and is used ONLY to pick an
  // instalment amount. A booking can owe money with NO schedule — paid in full
  // at booking, or Travelify attached no deposit breakdown — in which case
  // `next` is null but the FULL outstanding is still payable. The widget already
  // shows the balance as owed, so the server must agree and collect the full
  // outstanding rather than report "nothing to pay". Bailing here on a missing
  // schedule made a genuine £1,800 balance uncollectable (Karen / My Booking,
  // 28 Jul 2026). Only a real multi-instalment plan caps the default below the
  // outstanding.
  const currency = (next && next.currency) || raw.currency || 'GBP';
  const isInstalment = !!(next && next.isInstalment && next.amount > 0);

  // Default (no custom amount): the next instalment (capped at outstanding) when
  // a plan is running; otherwise the full outstanding balance.
  const defaultAmount = isInstalment
    ? Math.min(Math.round(next.amount * 100) / 100, outstanding)
    : outstanding;

  let chargeAmount = defaultAmount;

  if (requested != null && requested !== '') {
    const amt = Math.round(Number(requested) * 100) / 100;
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

  const followAmount = Math.max(0, Math.round((outstanding - chargeAmount) * 100) / 100);
  return {
    noBalance: false,
    total, paid, outstanding,
    amount: chargeAmount,
    currency,
    dueDate: (next && next.dueDate) || null,
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
