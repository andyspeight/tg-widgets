/**
 * Travelgenix Widget Suite — Cancel Product (public endpoint)
 *
 * Called by the embedded My Booking widget to cancel a single product within
 * an order. NO auth header — widgets embed on any client site. Security relies
 * on the same model as /api/retrieve-order:
 *   1. Rate limiting (per IP and per IP+widget)
 *   2. Server-side credential lookup (creds never touch the browser)
 *   3. The per-order key is read server-side from a fresh order fetch and
 *      NEVER sent to or accepted from the browser
 *   4. A product can only be cancelled if it actually exists in the resolved
 *      order (membership check)
 *   5. Only the documented Travelify response fields are forwarded back —
 *      raw Travelify JSON is never returned
 *
 * Two-step Travelify contract (https://api.travelify.io/cancel/...):
 *   - GET  → fetch cancellation policies + costs (no booking change)
 *   - POST → confirm the cancellation
 * Both are driven from this single POST endpoint:
 *   - body without confirm:true  → we GET the policies and return them
 *   - body with    confirm:true  → we POST the confirmation
 *
 * Request (POST /api/cancel-product):
 *   {
 *     widgetId, emailAddress, departDate, orderRef, productId,   // always
 *     confirm: true, cancellationReason: "<=250 chars"           // step 2 only
 *   }
 * The lookup triplet is the same one the customer already used to retrieve the
 * order, so no extra customer input is required.
 *
 * Response (always HTTP 200 unless rate-limited / bad method):
 *   Step 1 ok:   { success: true,  step: 'policies', data: { supplier, bookingReference, requiresConfirmation, policies: [..] } }
 *   Step 2 ok:   { success: true,  step: 'confirmed', data: { supplier, bookingReference, cancellationReference } }
 *   Either fail: { success: false, error: "<message to show the customer>" }
 */

import { setCors } from './_auth.js';
import {
  rateLimit,
  getClientIp,
  validateWidgetId,
  validateEmail,
  validateDate,
  validateOrderRef,
  validateProductId,
  resolveWidgetCredentials,
  fetchTravelifyOrderRaw,
  readOrderKey,
  TRAVELIFY_ORIGIN,
} from './_lib/travelify.js';
import { renderCancellationEmail } from './_lib/cancellation-email-template.js';
import { sendViaSendGrid, buildFromField, isValidEmail } from './_lib/sendgrid.js';

const CANCEL_API_BASE = 'https://api.travelify.io/cancel';
const REASON_MAX = 250;

// Generic, customer-safe failure. Used for any infrastructure-side problem so
// we never leak which internal step failed.
const GENERIC_FAIL = "We couldn't process this cancellation right now. Please try again, or contact us if the problem continues.";

function fail(res, message) {
  return res.status(200).json({ success: false, error: message || GENERIC_FAIL });
}

// Clamp + strip control characters from a free-text reason. The widget also
// enforces the limit, but never trust the client.
function sanitiseReason(v) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, REASON_MAX);
}

// Forward only the documented fields from a Travelify cancel response. Caps
// string lengths and the number of policy lines so a malformed upstream can't
// be reflected wholesale to the browser.
function safeText(v, max) {
  if (typeof v !== 'string') return '';
  return v.slice(0, max);
}

function shapePolicies(data) {
  const policies = Array.isArray(data?.policies)
    ? data.policies.filter(p => typeof p === 'string').slice(0, 20).map(p => safeText(p, 600))
    : [];
  return {
    supplier: safeText(data?.supplier, 80),
    bookingReference: safeText(data?.bookingReference, 100),
    requiresConfirmation: data?.requiresConfirmation !== false, // default true
    policies,
  };
}

function shapeConfirmation(data) {
  return {
    supplier: safeText(data?.supplier, 80),
    bookingReference: safeText(data?.bookingReference, 100),
    cancellationReference: safeText(data?.cancellationReference, 120),
  };
}

// ----- Cancellation confirmation email -----

const PRODUCT_LABELS = {
  Accommodation: 'Accommodation',
  Packages: 'Package',
  Flights: 'Flights',
  Transfers: 'Transfer',
  CarRental: 'Car hire',
  TicketsAttractions: 'Tickets & attractions',
  AirportExtras: 'Airport extras',
};
function productLabel(item) {
  return PRODUCT_LABELS[item?.product] || item?.product || 'Booked item';
}

// Pull brand + the agency's saved Settings (config JSON) off the widget record,
// mirroring how /api/booking-email reads brand. Returns null-safe defaults.
function readBrandAndSettings(widget) {
  const fields = widget?.fields || {};
  let settings = {};
  const s = fields.Settings;
  if (s) {
    if (typeof s === 'object') settings = s;
    else { try { settings = JSON.parse(s); } catch { settings = {}; } }
  }
  const fromName = (fields.FromName || '').toString().trim();
  const fromEmail = (fields.FromEmail || '').toString().trim().toLowerCase();
  const logoUrl = (fields.LogoUrl || '').toString().trim();
  const emailFooter = (fields.EmailFooter || '').toString().trim();
  const clientName = (fields.ClientName || '').toString().trim();

  let replyTo = null;
  if (fromEmail && isValidEmail(fromEmail)) replyTo = fromEmail;
  else {
    const fb = (fields.ClientEmail || '').toString().trim().toLowerCase();
    if (fb && isValidEmail(fb)) replyTo = fb;
  }

  return {
    settings: settings || {},
    brand: {
      name: fromName || settings?.brand?.name || clientName || 'Travel Team',
      logoUrl: (logoUrl && /^https:\/\//i.test(logoUrl)) ? logoUrl : '',
      footerLine: emailFooter,
      primary: settings?.colors?.primary || '',
    },
    replyTo,
    supportEmail: settings?.support?.email || replyTo || null,
    supportPhone: settings?.support?.phone || null,
  };
}

// Sends the traveller a cancellation confirmation, IF the agency's saved
// config has it enabled (default ON). Never throws — a failed/disabled email
// must NOT fail the cancellation, which has already succeeded upstream.
// Returns true only if an email was actually sent.
async function maybeSendCancellationEmail({ creds, raw, item, emailAddress, confirmed }) {
  try {
    let settings = {};
    let brand = { name: 'Travelgenix Demo', logoUrl: '', footerLine: '', primary: '' };
    let replyTo = null, supportEmail = null, supportPhone = null;

    if (creds.widget) {
      const r = readBrandAndSettings(creds.widget);
      settings = r.settings;
      brand = r.brand;
      replyTo = r.replyTo;
      supportEmail = r.supportEmail;
      supportPhone = r.supportPhone;
    }

    // Agency toggle — default ON unless explicitly disabled in their config.
    if (settings?.display?.cancelEmail === false) return false;

    // Only ever email the traveller's own booking address.
    const to = (raw.customerEmail || emailAddress || '').toLowerCase().trim();
    if (!to || !isValidEmail(to)) return false;

    const { subject, html, text } = renderCancellationEmail({
      brand,
      customerName: raw.customerFirstname || '',
      productLabel: productLabel(item),
      bookingReference: confirmed.bookingReference || item?.bookingReference || '',
      cancellationReference: confirmed.cancellationReference || '',
      message: typeof settings?.cancelEmailMessage === 'string' ? settings.cancelEmailMessage : '',
      supportEmail,
      supportPhone,
    });

    const sendResult = await sendViaSendGrid({
      from: buildFromField(brand.name),
      to,
      replyTo: replyTo || undefined,
      subject,
      html,
      text,
      categoryTag: 'cancellation-confirmation',
      headers: { 'X-TG-Widget-Cancel': '1' },
    });

    if (!sendResult || sendResult.status !== 'sent') {
      console.error('[cancel-product] confirmation email not sent:', sendResult && sendResult.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[cancel-product] confirmation email error:', err.message);
    return false;
  }
}

// Call the Travelify cancel endpoint (GET for policies, POST to confirm).
async function callTravelifyCancel({ appId, apiKey }, { orderId, orderKey, productId }, confirmBody) {
  const url = `${CANCEL_API_BASE}/${encodeURIComponent(orderId)}/${encodeURIComponent(orderKey)}/${encodeURIComponent(productId)}`;
  const opts = {
    method: confirmBody ? 'POST' : 'GET',
    headers: {
      'Authorization': `Token ${appId}:${apiKey}`,
      'Content-Type': 'application/json',
      'Origin': TRAVELIFY_ORIGIN,
    },
    signal: AbortSignal.timeout(15000),
  };
  if (confirmBody) opts.body = JSON.stringify(confirmBody);

  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, ok: res.ok, json };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);

  // Per-IP cap. Cancellation is destructive, so keep it at the same tight cap
  // the order lookup uses for public callers.
  const ipLimit = rateLimit(`cancel:ip:${ip}`, 5);
  if (!ipLimit.ok) {
    return res.status(429).json({
      success: false,
      error: 'Too many attempts. Please wait a few minutes and try again.',
      retryAfterMs: ipLimit.retryAfterMs,
    });
  }

  // Parse body
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return fail(res, GENERIC_FAIL);
  }

  // Validate inputs
  const widgetId = validateWidgetId(body.widgetId);
  const emailAddress = validateEmail(body.emailAddress);
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);
  const productId = validateProductId(body.productId);
  const confirm = body.confirm === true;
  const cancellationReason = sanitiseReason(body.cancellationReason);

  if (!widgetId || !emailAddress || !departDate || !orderRef || !productId) {
    return fail(res, GENERIC_FAIL);
  }

  // Per-IP+widget cap
  const widgetLimit = rateLimit(`cancel:ipw:${ip}:${widgetId}`, 30);
  if (!widgetLimit.ok) {
    return res.status(429).json({
      success: false,
      error: 'Too many attempts for this booking. Please try again later.',
      retryAfterMs: widgetLimit.retryAfterMs,
    });
  }

  try {
    // 1. Resolve the owning client's Travelify credentials (never sent to browser)
    const creds = await resolveWidgetCredentials(widgetId, 'My Booking');
    if (!creds) return fail(res, GENERIC_FAIL);

    // 2. Re-fetch the order server-side to obtain its id + per-order key.
    //    The key is required by the cancel endpoint and must never round-trip
    //    through the browser.
    const raw = await fetchTravelifyOrderRaw(creds, { emailAddress, departDate, orderRef });
    if (!raw) return fail(res, "We couldn't find that booking. Please check your details and try again.");

    const orderId = String(raw.id);
    const orderKey = readOrderKey(raw);
    if (!orderKey) {
      console.error('[cancel-product] order key missing on Travelify order', orderId,
        '— available keys:', Object.keys(raw).join(','));
      return fail(res, GENERIC_FAIL);
    }

    // 3. Membership check — only allow cancelling a product that is actually
    //    part of THIS order. Prevents a valid order's session being used to
    //    aim a cancel at an arbitrary product id.
    const items = Array.isArray(raw.items) ? raw.items : [];
    const item = items.find(it => it && String(it.id) === productId) || null;
    if (!item) {
      return fail(res, "That item could not be found on this booking.");
    }

    // 4. Drive the two-step Travelify cancel contract.
    const target = { orderId, orderKey, productId };

    if (!confirm) {
      // Step 1 — fetch policies + costs. No booking change.
      const r = await callTravelifyCancel(creds, target, null);
      if (r.json && r.json.success === true) {
        return res.status(200).json({ success: true, step: 'policies', data: shapePolicies(r.json.data) });
      }
      const errMsg = r.json && typeof r.json.error === 'string'
        ? safeText(r.json.error, 300)
        : GENERIC_FAIL;
      return fail(res, errMsg);
    }

    // Step 2 — confirm the cancellation.
    const r = await callTravelifyCancel(creds, target, {
      confirm: true,
      cancellationReason: cancellationReason || 'Customer requested cancellation',
    });
    if (r.json && r.json.success === true) {
      const confirmed = shapeConfirmation(r.json.data);
      // Fire the traveller confirmation email (agency toggle, default on).
      // Never let an email problem fail a cancellation that already succeeded.
      const emailSent = await maybeSendCancellationEmail({ creds, raw, item, emailAddress, confirmed });
      return res.status(200).json({ success: true, step: 'confirmed', data: confirmed, emailSent });
    }
    const errMsg = r.json && typeof r.json.error === 'string'
      ? safeText(r.json.error, 300)
      : GENERIC_FAIL;
    return fail(res, errMsg);

  } catch (err) {
    console.error('[cancel-product] error:', err.message);
    return fail(res, GENERIC_FAIL);
  }
}
