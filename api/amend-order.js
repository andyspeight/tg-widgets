/**
 * Travelgenix Widget Suite — Amend Order (public endpoint)
 *
 * Called by the embedded My Booking widget to send the travel company an
 * AMENDMENT REQUEST for an order. This does NOT change the booking — it
 * forwards the customer's free-text request to the company, who action it
 * separately. The widget makes that clear to the customer.
 *
 * Unlike cancellation this is whole-order (no product id) and a single step.
 *
 * Same security model as /api/cancel-product and /api/retrieve-order:
 *   1. Rate limiting (per IP and per IP+widget)
 *   2. Server-side credential lookup (creds never touch the browser)
 *   3. The per-order key is read server-side from a fresh order fetch and
 *      NEVER sent to or accepted from the browser
 *   4. Only the documented Travelify response shape is forwarded back
 *
 * Travelify contract (https://api.travelify.io/amend/{orderId}/{orderKey}):
 *   POST { "AmendmentDetails": "<text>" }
 *   success → { "success": true }                 (no data field)
 *   failure → { "success": false, "error": ".." } (error shown to customer)
 *
 * Request (POST /api/amend-order):
 *   { widgetId, emailAddress, departDate, orderRef, amendmentDetails }
 * The lookup triplet is the same one the customer already used to retrieve the
 * order, so no extra identifying input is required.
 *
 * Response (always HTTP 200 unless rate-limited / bad method):
 *   ok:   { success: true }
 *   fail: { success: false, error: "<message to show the customer>" }
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

const AMEND_API_BASE = 'https://api.travelify.io/amend';

// Travelify states no maximum for AmendmentDetails. We cap it (client + server)
// so a customer is warned rather than failing on submit, and a malformed/huge
// payload can't be forwarded upstream.
const DETAILS_MAX = 1000;

const GENERIC_FAIL = "We couldn't send your amendment request right now. Please try again, or contact us if the problem continues.";

function fail(res, message) {
  return res.status(200).json({ success: false, error: message || GENERIC_FAIL });
}

// Clamp + strip control characters from the free-text request. The widget also
// enforces the limit, but never trust the client.
function sanitiseDetails(v) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim().slice(0, DETAILS_MAX);
}

function safeText(v, max) {
  if (typeof v !== 'string') return '';
  return v.slice(0, max);
}

// POST the amendment request to Travelify.
async function callTravelifyAmend({ appId, apiKey }, { orderId, orderKey }, amendmentDetails) {
  const url = `${AMEND_API_BASE}/${encodeURIComponent(orderId)}/${encodeURIComponent(orderKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${appId}:${apiKey}`,
      'Content-Type': 'application/json',
      'Origin': TRAVELIFY_ORIGIN,
    },
    body: JSON.stringify({ AmendmentDetails: amendmentDetails }),
    signal: AbortSignal.timeout(15000),
  });
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

  // Per-IP cap — same tight cap the order lookup / cancellation use.
  const ipLimit = rateLimit(`amend:ip:${ip}`, 5);
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
  const amendmentDetails = sanitiseDetails(body.amendmentDetails);

  if (!widgetId || !emailAddress || !departDate || !orderRef) {
    return fail(res, GENERIC_FAIL);
  }
  if (!amendmentDetails) {
    return fail(res, 'Please describe the change you would like before sending your request.');
  }

  // Per-IP+widget cap
  const widgetLimit = rateLimit(`amend:ipw:${ip}:${widgetId}`, 30);
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

    // 2. Re-fetch the order server-side to obtain its id + per-order key. The
    //    key is required by the amend endpoint and must never round-trip
    //    through the browser.
    const raw = await fetchTravelifyOrderRaw(creds, { emailAddress, departDate, orderRef });
    if (!raw) return fail(res, "We couldn't find that booking. Please check your details and try again.");

    const orderId = String(raw.id);
    const orderKey = readOrderKey(raw);
    if (!orderKey) {
      console.error('[amend-order] order key missing on Travelify order', orderId,
        '— available keys:', Object.keys(raw).join(','));
      return fail(res, GENERIC_FAIL);
    }

    // 3. Send the amendment request.
    const r = await callTravelifyAmend(creds, { orderId, orderKey }, amendmentDetails);

    console.log('[amend-order] order', orderId, 'amend request:', r.json && r.json.success === true ? 'sent' : 'failed');

    if (r.json && r.json.success === true) {
      return res.status(200).json({ success: true });
    }

    const errMsg = r.json && typeof r.json.error === 'string'
      ? safeText(r.json.error, 300)
      : GENERIC_FAIL;
    return fail(res, errMsg);

  } catch (err) {
    console.error('[amend-order] error:', err.message);
    return fail(res, GENERIC_FAIL);
  }
}
