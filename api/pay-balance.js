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
function computeNextPayment(plan) {
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
  // scheduled payments as still collectable (next = earliest by date).
  const unpaid = entries.filter(e => !e.paid);
  const pool = unpaid.length ? unpaid : entries;

  pool.sort((a, b) => {
    if (a.due == null && b.due == null) return 0;
    if (a.due == null) return 1;
    if (b.due == null) return -1;
    return a.due - b.due;
  });

  const next = pool[0];
  const rest = pool.slice(1);
  return {
    amount: Math.round(next.amount * 100) / 100,
    currency: plan.currency,
    dueDate: next.dueDate || null,
    remaining: rest.length,
    remainingAmount: Math.round(rest.reduce((s, e) => s + e.amount, 0) * 100) / 100,
    isInstalment: plan.isInstalment,
  };
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

    // 3. Work out the next payment to collect (server-authoritative amount).
    const plan = findPaymentPlan(raw);
    const next = computeNextPayment(plan);

    // One-time shape dump (keys only, no PII values) so we can pin the real
    // field names for paid-status and contact/address against live data.
    console.log('[pay-balance] order', orderId, 'rawKeys:', Object.keys(raw).join(','),
      'firstBreakdownKeys:', plan?.breakdown?.[0] ? Object.keys(plan.breakdown[0]).join(',') : 'none');

    if (!next || !(next.amount > 0)) {
      // Nothing left to pay (or no schedule we could read).
      return res.status(200).json({ success: false, noBalance: true });
    }

    // 4. Build the addgenericitem payload.
    //    Reference / Description use the human-readable orderRef.
    //    OrderRef is the order id + key joined with a slash (NOT orderRef).
    const payload = {
      Reference: orderRef,
      Title: 'Balance Payment',
      Description: `Balance Payment for Order ${orderRef}`,
      Price: next.amount,
      Currency: next.currency,
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
        amount: next.amount,
        currency: next.currency,
        remaining: next.remaining,
        remainingAmount: next.remainingAmount,
        dueDate: next.dueDate,
        isInstalment: next.isInstalment,
      },
    });
  } catch (err) {
    console.error('[pay-balance] error:', err.message);
    return res.status(200).json({ success: false });
  }
}
