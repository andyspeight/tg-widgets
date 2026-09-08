/**
 * GET /api/admin/order-shape
 *
 * Staff-only inspector: what does a Travelify ORDER actually carry, and what
 * does our shared money calculation make of it?
 *
 * Why this exists (8 Sep 2026): the Travelify developers reported order
 * TG120193, a £9.17 holiday paid with a £9.17 gift voucher, showing £9.17
 * still due on the page, the PDF and the email. The fix reads the order's
 * vouchers[] list through ONE calculation (api/_lib/order-money.js). Two
 * things can only be settled against real orders, and Travelify's API cannot
 * be reached from a development sandbox:
 *   1. that TG120193 now comes out at a zero balance, and
 *   2. whether a DISCOUNT voucher (isGift false) is already inside the item
 *      prices (items carry ruleIds / priceChanged / priceBeforeChange) or must
 *      be deducted as well. Until an order with one is seen, discount vouchers
 *      are listed but NOT deducted.
 * This runs where our functions already reach Travelify and hands the shape
 * back to a signed-in member of staff.
 *
 *   No parameters                    a small form
 *   ?widgetId=&orderRef=&email=&departDate=   the same lookup triplet the
 *                                    customer types into the My Booking widget,
 *                                    plus the client's My Booking widget id
 *                                    (blank = the demo account)
 *
 * What comes back is a MONEY report, not the order: currency, the vouchers[]
 * list and the order-level voucher fields (codes MASKED), every payment
 * (amount, status, date), the deposit schedule, each item's product, price and
 * pricing flags, and the money block our outputs render. No customer name,
 * email, phone or address. The same report is logged with an [order-shape]
 * marker as a second channel.
 *
 * Auth: requireAdmin (admin role or the admin email list). GET only. Rate
 * limited per user. Same-origin CORS like every admin route.
 */
import { requireAdmin, setAdminCors } from './_guard.js';
import { applyRateLimit, RATE_LIMITS } from '../_auth.js';
import {
  validateWidgetId, validateEmail, validateDate, validateOrderRef,
  resolveWidgetCredentials, fetchTravelifyOrderRaw, DEMO_WIDGET_SENTINEL, DEMO_APP_ID, DEMO_PUBLIC_KEY,
} from '../_lib/travelify.js';
import { moneyOf, moneyOptsFromEnv, maskVoucherCode, extractVouchers } from '../_lib/order-money.js';

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : (v == null ? null : String(v).slice(0, 40));
const str = (v, n = 80) => (v == null ? null : String(v).slice(0, n));

/** Every key on an item's pricing object that looks like a discount trail. */
function pricingFlags(it) {
  const out = {};
  const sources = [it, it.dataObject, it.pricing, it.dataObject && it.dataObject.pricing, it.accommodation && it.accommodation.pricing]
    .filter(isPlainObject);
  for (const src of sources) {
    for (const k of Object.keys(src)) {
      if (/^(ruleIds|priceChanged|priceBeforeChange|discount|discounts|promo|promotion|voucher|vouchers|markup|margin|memberPrice|price|currency)$/i.test(k)) {
        const v = src[k];
        out[k] = Array.isArray(v) ? v.slice(0, 20) : (isPlainObject(v) ? Object.keys(v).slice(0, 30) : v);
      }
    }
  }
  return out;
}

/**
 * Build the money report for a raw Travelify order. Pure; no network. Codes
 * are masked before they leave; nothing personal is copied.
 */
export function buildOrderShapeReport(raw, opts) {
  const r = isPlainObject(raw) ? raw : {};
  const items = Array.isArray(r.items) ? r.items : [];
  const maskList = (list) => (Array.isArray(list) ? list : []).filter(isPlainObject).map((v) => ({
    id: str(v.id), code: maskVoucherCode(v.code), name: str(v.name, 120), value: num(v.value),
    isPercent: v.isPercent, isGift: v.isGift, keys: Object.keys(v),
  }));
  return {
    orderId: str(r.id), status: str(r.status, 30), currency: str(r.currency, 10),
    topLevelKeys: Object.keys(r).filter((k) => !/^(customer|contact|email|phone|tel|address|name)/i.test(k)),
    vouchersList: maskList(r.vouchers),
    orderLevelVoucher: {
      voucherId: str(r.voucherId), voucherCode: maskVoucherCode(r.voucherCode), voucherName: str(r.voucherName, 120),
      voucherValue: num(r.voucherValue), voucherIsPercent: r.voucherIsPercent, voucherIsGift: r.voucherIsGift,
    },
    vouchersRead: extractVouchers(r).map((v) => ({ id: v.id, code: maskVoucherCode(v.code), name: v.name, value: v.value, isPercent: v.isPercent, isGift: v.isGift })),
    payments: (Array.isArray(r.payments) ? r.payments : []).slice(0, 40).map((p) => ({
      amount: num(p && p.amount), status: str(p && p.status, 30), date: str(p && (p.date || p.created || p.paidAt), 40), type: str(p && (p.type || p.method), 40),
    })),
    paidToDate: num(r.paidToDate),
    depositOption: isPlainObject(r.depositOption) ? {
      initialAmount: num(r.depositOption.initialAmount), currency: str(r.depositOption.currency, 10),
      breakdown: (Array.isArray(r.depositOption.breakdown) ? r.depositOption.breakdown : []).slice(0, 24).map((b) => ({ num: num(b && b.num), amount: num(b && b.amount), dueDate: str(b && b.dueDate, 30) })),
    } : null,
    items: items.slice(0, 12).map((it, i) => ({
      index: i, product: str(it && it.product, 40), price: num(it && it.price), currency: str(it && it.currency, 10),
      status: str(it && it.status, 30), pricingFlags: isPlainObject(it) ? pricingFlags(it) : {},
    })),
    money: moneyOf(r, opts),
    deductNonGift: !!(opts && opts.deductNonGift),
  };
}

const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Order money</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Inter,-apple-system,"Segoe UI",sans-serif;background:#F5F8FB;color:#0F172A;margin:0;padding:40px 20px}
main{max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 6px;color:#1B2B5B}p{margin:0 0 18px;color:#475569;line-height:1.5}
label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #CBD5E1;border-radius:9px;margin-bottom:16px}
button{font:inherit;font-weight:700;background:#1B2B5B;color:#fff;border:0;border-radius:9px;padding:11px 18px;cursor:pointer}</style></head>
<body><main><h1>What does this order owe?</h1>
<p>Enter the same three details the customer types into the My Booking widget, plus the client's My Booking widget id (leave it blank for the demo account). You will get the vouchers, payments and schedule Travelify sends, with codes masked and no customer details, and the balance our page, PDF and email will show.</p>
<form method="get" action="/api/admin/order-shape">
<label for="widgetId">My Booking widget id of the client (optional)</label><input id="widgetId" name="widgetId" placeholder="tgw_...">
<label for="orderRef">Order reference</label><input id="orderRef" name="orderRef" placeholder="TG120193" required>
<label for="email">Customer email on the booking</label><input id="email" name="email" type="email" required>
<label for="departDate">Departure date</label><input id="departDate" name="departDate" type="date" required>
<button type="submit">Go</button></form></main></body></html>`;

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });
  const who = String((gate.user && (gate.user.email || gate.user.userId || gate.user.id)) || 'staff').toLowerCase();
  if (!applyRateLimit(res, `order-shape:${who}`, RATE_LIMITS.widgetRead)) return;

  const q = req.query || {};
  const hasLookup = q.orderRef || q.email || q.departDate;
  if (!hasLookup) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(FORM);
  }
  const orderRef = validateOrderRef(String(q.orderRef || ''));
  const emailAddress = validateEmail(String(q.email || ''));
  const departDate = validateDate(String(q.departDate || ''));
  const widgetId = q.widgetId ? validateWidgetId(String(q.widgetId)) : DEMO_WIDGET_SENTINEL;
  if (!orderRef || !emailAddress || !departDate) return res.status(400).json({ error: 'Order reference, customer email and departure date are all needed, in the form the widget accepts.' });
  if (!widgetId) return res.status(400).json({ error: 'That widget id is not in the expected form.' });

  try {
    const creds = widgetId === DEMO_WIDGET_SENTINEL
      ? { appId: DEMO_APP_ID, apiKey: DEMO_PUBLIC_KEY }
      : await resolveWidgetCredentials(widgetId, 'My Booking');
    if (!creds) return res.status(404).json({ error: 'That widget id was not found, or its client has no Travelify credentials on file.' });
    const raw = await fetchTravelifyOrderRaw(creds, { emailAddress, departDate, orderRef });
    if (!raw) return res.status(404).json({ error: 'Travelify did not return an order for those details with these credentials. Check the widget id belongs to the client who holds the booking.' });
    const report = buildOrderShapeReport(raw, moneyOptsFromEnv());
    report.orderRef = orderRef;
    report.widgetId = widgetId === DEMO_WIDGET_SENTINEL ? 'demo' : widgetId;
    console.error('[order-shape] ' + JSON.stringify(report).slice(0, 6000));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify(report, null, 2));
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || 'failed') });
  }
}
