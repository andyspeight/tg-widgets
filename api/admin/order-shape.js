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
  resolveWidgetCredentials, fetchTravelifyOrderDetailed, DEMO_WIDGET_SENTINEL, DEMO_APP_ID, DEMO_PUBLIC_KEY,
} from '../_lib/travelify.js';
import { moneyOf, moneyOptsFromEnv, maskVoucherCode, extractVouchers } from '../_lib/order-money.js';
import { describeOrderShape } from '../_lib/travelify-items.js';

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
 * Every money-ish NUMBER anywhere in the order, with the path it sits at.
 *
 * TG121758 (18 Sep 2026) came back with payments: [] and a $43 gap between a
 * $143 car rental and a $100 gift card, while the customer had paid in full.
 * The order carries `data` and `sources` containers we have never looked
 * inside, so a payment recorded there is invisible to us and indistinguishable
 * from one that was never recorded at all. This finds it, or proves it is not
 * in the order.
 *
 * NUMBERS ONLY, and only under money-ish keys. A number is not a name, an
 * email or an address, so this cannot leak a customer into a support report.
 */
const MONEYISH = /(amount|paid|payment|total|price|balance|due|charge|value|net|gross|deposit|credit|refund|fee|tax)/i;
function moneyTrail(root, maxDepth = 8) {
  const out = [];
  const walk = (node, path, depth) => {
    if (out.length >= 80 || depth > maxDepth || node == null) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length && i < 30; i++) walk(node[i], path + '[' + i + ']', depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    for (const k of Object.keys(node)) {
      const v = node[k];
      const at = path ? path + '.' + k : k;
      if (typeof v === 'number' && Number.isFinite(v) && MONEYISH.test(k)) out.push({ at, value: v });
      else if (v && typeof v === 'object') walk(v, at, depth + 1);
    }
  };
  walk(root, '', 0);
  return out;
}

/**
 * What the order says about the PEOPLE, without saying who they are.
 *
 * Added 23 Sep 2026. The My Booking upsell searches for the party on the
 * booking, and a child needs an age in the deep link. Andy: "you do get either
 * the date of birth or the age of any child or infant." Travelify's own order
 * model documents the car rental driver as `Driver.DOB`, and their JSON moves
 * between casings, so we read the key case-insensitively rather than guess. This
 * block is how that guess gets CHECKED against a real order: it reports which
 * key names each traveller list carries and the counts by type.
 *
 * Names only, never values. No name, no date of birth, no age — a traveller's
 * age on a report that goes in a support thread is exactly what we are trying
 * not to hand around. A key name tells us what to read; the value tells us
 * about a child.
 */
function partyShape(items) {
  const seenKeys = new Set();
  const types = {};
  let lists = 0;
  let people = 0;
  const walk = (list) => {
    if (!Array.isArray(list) || !list.length) return;
    lists++;
    for (const p of list.slice(0, 24)) {
      if (!isPlainObject(p)) continue;
      people++;
      for (const k of Object.keys(p)) seenKeys.add(k);
      const t = str(p.type, 30) || '(none)';
      types[t] = (types[t] || 0) + 1;
    }
  };
  for (const it of (Array.isArray(items) ? items : []).slice(0, 12)) {
    const d = isPlainObject(it) && isPlainObject(it.dataObject) ? it.dataObject : it;
    if (!isPlainObject(d)) continue;
    walk(d.travellers);
    walk(d.guests);
    if (isPlainObject(d.driver)) walk([d.driver]);
  }
  const keys = [...seenKeys].sort();
  return {
    lists, people, byType: types, keys,
    // The answer we came for, spelled out so nobody has to read the key list.
    ageKeys: keys.filter((k) => /^(age|paxage)$/i.test(k)),
    dobKeys: keys.filter((k) => /^(dob|dateofbirth|birthdate|birthday)$/i.test(k)),
  };
}

/**
 * Every field anywhere in the order whose NAME speaks of ATOL or financial
 * protection, with the path it sits at.
 *
 * Added 24 Sep 2026 for ATOL certificates. A client that holds its own ATOL
 * must give the customer a certificate when a booking is protected under it,
 * and nothing we read so far says so: the one flag we know is a Packages
 * item's inclusions list naming 'ATOLProtection', which is the TOUR OPERATOR's
 * licence (Jet2 Holidays and the like), not the agency's. Travelify's order
 * model is not published, so this is how the question gets answered: run it
 * on a booking the agency sold under its own ATOL and read what comes back.
 *
 * Values only when they are a flag or a code: a boolean, a number, or text
 * with no spaces of up to 40 characters (an ATOL number, 'ATOLProtection', a
 * type such as 'PackageSingle'). Anything with a space in it could be a
 * person's name, so it is reported by its length only, in a list as well.
 */
const ATOLISH = /(atol|protect|bond|licen[cs]e|caa|abta|pkgtype|packagetype|contracttype)/i;

/**
 * Passport details on each Flights item (25 Sep 2026), to settle the spec's
 * first open point: which field names Travelify uses for a passport already on
 * a booking. Field NAMES and whether each person has a value, never a value:
 * a passport number does not belong in a support report. canEditFOID is shown
 * as it came (a boolean, or its type when it is anything else), because the
 * form only appears for boolean true.
 */
function passportShape(items) {
  return (Array.isArray(items) ? items : []).slice(0, 12).map((it, index) => {
    if (!isPlainObject(it) || !/^flights$/i.test(String(it.product || ''))) return null;
    const d = isPlainObject(it.dataObject) ? it.dataObject : null;
    if (!d) return { index, itemId: str(it.id), dataObject: typeof it.dataObject };
    const flagKey = Object.keys(d).find((k) => /^caneditfoid$/i.test(k));
    const flag = flagKey ? d[flagKey] : undefined;
    const travellersKey = Object.keys(d).find((k) => /^travellers$/i.test(k));
    const people = Array.isArray(d[travellersKey]) ? d[travellersKey].filter(isPlainObject) : [];
    const foidKeys = new Set();
    for (const p of people) for (const k of Object.keys(p)) if (/foid|passport/i.test(k)) foidKeys.add(k);
    return {
      index, itemId: str(it.id),
      canEditFOID: flag === undefined ? '(missing)' : (typeof flag === 'boolean' ? flag : '(' + typeof flag + ')'),
      travellers: people.length,
      foidKeys: [...foidKeys].sort(),
      withPassportValue: people.map((p) => Object.keys(p).some((k) => /foidnumber/i.test(k) && p[k] != null && String(p[k]).trim() !== '')),
    };
  }).filter(Boolean);
}
export function atolTrail(root, maxDepth = 8) {
  const out = [];
  const code = (x) => (/^[A-Za-z0-9_.\/-]{1,40}$/.test(x) ? x : '(text, ' + x.length + ' characters)');
  const shown = (v) => {
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
    if (typeof v === 'string') return code(v);
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => (typeof x === 'string' ? code(x) : typeof x));
    if (v && typeof v === 'object') return '{' + Object.keys(v).slice(0, 20).join(', ') + '}';
    return v === null ? null : typeof v;
  };
  const walk = (node, path, depth) => {
    if (out.length >= 60 || depth > maxDepth || node == null) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length && i < 30; i++) {
        const x = node[i];
        // A string in a list (inclusions: ['ATOLProtection', ...]) is the flag.
        if (typeof x === 'string' && ATOLISH.test(x)) out.push({ at: path + '[' + i + ']', value: code(x) });
        else walk(x, path + '[' + i + ']', depth + 1);
      }
      return;
    }
    if (typeof node !== 'object') return;
    for (const k of Object.keys(node)) {
      const v = node[k];
      const at = path ? path + '.' + k : k;
      if (ATOLISH.test(k)) out.push({ at, value: shown(v) });
      if (v && typeof v === 'object') walk(v, at, depth + 1);
    }
  };
  walk(root, '', 0);
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
    party: partyShape(items),
    // Passport details on each flight: field names and flags only.
    passports: passportShape(items),
    // Travelify's upsellsActive (24 Sep 2026): which upsells the application is
    // selling against this order. Product type names, nothing personal, so it
    // is shown as it came. If My Booking's "Add to your trip" has vanished,
    // this is the first thing to read: missing or empty means no upsells, by
    // their rule.
    upsellsActive: Array.isArray(r.upsellsActive) ? r.upsellsActive.slice(0, 20).map((v) => str(v, 40)) : (r.upsellsActive === undefined ? '(missing)' : r.upsellsActive),
    // Every upsell link must end with the order's id and KEY, and has no link at
    // all without both. Whether they are there, never the key itself.
    upsellLinkable: { hasId: r.id != null && r.id !== '', hasKey: typeof r.key === 'string' && r.key.length > 0 },
    money: moneyOf(r, opts),
    deductNonGift: !!(opts && opts.deductNonGift),
    // The two containers we have never opened, as TYPES not values, plus every
    // money-ish number anywhere in the order. Added for TG121758: payments was
    // empty and $43 was missing, and we could not tell "recorded somewhere we
    // do not read" from "never recorded at all".
    shape: describeOrderShape(r),
    moneyTrail: moneyTrail(r),
    // How Travelify marks ATOL protection, and under whose licence. See
    // atolTrail above. Empty means the order says nothing about it at all.
    atolTrail: atolTrail(r),
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
    const got = await fetchTravelifyOrderDetailed(creds, { emailAddress, departDate, orderRef });
    if (got.outcome !== 'found') {
      // One message for four different faults sent staff guessing through 21
      // clients on 18 Sep 2026. Say which one it was.
      const why = {
        'not-found': 'No order with that reference, email and departure date in THIS client\'s Travelify account. Either the details differ (the date must be the real departure) or the booking belongs to another client.',
        'credentials-refused': 'Travelify refused this client\'s credentials — the lookup never ran, so this says nothing about whether the order exists.',
        'upstream-error': 'Travelify answered with an error, so the lookup did not complete.',
        'network-error': 'Could not reach Travelify.',
        'bad-body': 'Travelify answered with something that was not an order.',
      }[got.outcome] || 'The lookup did not return an order.';
      return res.status(got.outcome === 'not-found' ? 404 : 502).json({
        error: why,
        outcome: got.outcome,
        travelifyStatus: got.status,
        travelifySaid: got.detail || undefined,
        appId: String(creds.appId || ''),
      });
    }
    const raw = got.order;
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
