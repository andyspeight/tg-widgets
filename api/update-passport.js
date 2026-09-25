/**
 * Travelgenix Widget Suite — Update passport details on a flight (public endpoint)
 *
 * Called by the embedded My Booking widget when a customer adds or changes the
 * passport details (Travelify's FOID, form of identification) of the people on
 * a flight. Built 25 Sep 2026 from the spec "My Booking widget: passenger FOID
 * (passport) capture for flights". The rules themselves are in
 * public/_passport-rules.js; this endpoint applies them again, server-side,
 * before anything leaves for Travelify.
 *
 * Same security model as /api/amend-order and /api/cancel-product:
 *   1. Rate limiting (per IP and per IP+widget)
 *   2. Server-side credential lookup (creds never touch the browser)
 *   3. The order is found again from the customer's own three details, and its
 *      id and per-order key are read here. The key never goes to, or comes
 *      from, the browser.
 *   4. Everything the page decided is decided again: the item is a Flights
 *      item on THIS order, canEditFOID is true, departure is at least a day
 *      away, nobody sent is an infant, every field passes, and each person
 *      actually changed. A page left open past the cut-off cannot submit.
 *   5. Every non-FOID field of a passenger comes from OUR fetch of the order,
 *      never from the browser, so the page cannot change a name or a date of
 *      birth through this door.
 *
 * Travelify contract:
 *   POST https://api.travelify.io/updatepaxfoid/{orderId}/{orderKey}/{itemId}
 *   { "Passengers": [ { Type, Title, Firstname, ..., FOIDType: "Passport",
 *     FOIDNumber, FOIDIssuingCountry, FOIDStartDate, FOIDExpiryDate } ] }
 *   success → { "success": true }
 *   failure → { "success": false, "error": "Could not update order" }
 *
 * Request (POST /api/update-passport):
 *   { widgetId, emailAddress, departDate, orderRef, itemId,
 *     passengers: [ { index, number, country, issued, expires } ] }
 *   `index` is the person's position in the flight item's own travellers list,
 *   as /api/retrieve-order reported it.
 *
 * Response (HTTP 200 unless rate-limited or a bad method):
 *   ok:       { success: true, saved: <n> }
 *   nothing:  { success: false, nothing: true, error }   nothing had changed
 *   invalid:  { success: false, error, fields: { <index>: { <field>: <code> } } }
 *   closed:   { success: false, closed: true, error }    no longer editable
 *   fail:     { success: false, error }                  Travelify's words, or ours
 *
 * Passport numbers are never logged, anywhere in here.
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
} from './_lib/travelify.js';
import { classifyItem } from './_lib/travelify-items.js';
import {
  ppField, ppEligibility, ppExisting, ppValidate, ppChanged, ppIsInfant, ppToday,
  passengerBody, callUpdatePaxFoid,
} from './_lib/passport-foid.js';

const GENERIC_FAIL = "We couldn't save your passport details just now. Please try again, or contact us if it keeps happening.";
const NOT_FOUND = "We couldn't find that booking. Please check your details and try again.";
const CLOSED = 'Passport details for this flight can no longer be changed online. Please contact us if they need updating.';
const NOTHING = 'Nothing has changed, so there is nothing to save.';
const INVALID = 'Please check the details marked below.';
const MAX_PASSENGERS = 12;

function fail(res, message, extra) {
  return res.status(200).json(Object.assign({ success: false, error: message || GENERIC_FAIL }, extra || {}));
}

function safeText(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export default async function handler(req, res) {
  setCors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  const ipLimit = rateLimit(`passport:ip:${ip}`, 10);
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
    return fail(res, GENERIC_FAIL);
  }

  const widgetId = validateWidgetId(body.widgetId);
  const emailAddress = validateEmail(body.emailAddress);
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);
  const itemId = /^\d{1,15}$/.test(String(body.itemId == null ? '' : body.itemId)) ? String(body.itemId) : '';
  const sent = Array.isArray(body.passengers) ? body.passengers.slice(0, MAX_PASSENGERS) : [];
  if (!widgetId || !emailAddress || !departDate || !orderRef || !itemId) return fail(res, GENERIC_FAIL);
  if (!sent.length) return fail(res, NOTHING, { nothing: true });

  const widgetLimit = rateLimit(`passport:ipw:${ip}:${widgetId}`, 30);
  if (!widgetLimit.ok) {
    return res.status(429).json({
      success: false,
      error: 'Too many attempts for this booking. Please try again later.',
      retryAfterMs: widgetLimit.retryAfterMs,
    });
  }

  try {
    const creds = await resolveWidgetCredentials(widgetId, 'My Booking');
    if (!creds) return fail(res, GENERIC_FAIL);

    const raw = await fetchTravelifyOrderRaw(creds, { emailAddress, departDate, orderRef });
    if (!raw) return fail(res, NOT_FOUND);
    const orderId = String(raw.id);
    const orderKey = readOrderKey(raw);
    if (!orderKey) {
      console.error('[update-passport] order key missing on Travelify order', orderId);
      return fail(res, GENERIC_FAIL);
    }

    // The item must be a Flights item on THIS order. Its dataObject may arrive
    // as a JSON string, which classifyItem unwraps like every other reader.
    const item = (Array.isArray(raw.items) ? raw.items : []).find((it) => it && String(it.id) === itemId);
    const { productType, dataObject } = item ? classifyItem(item) : {};
    if (!item || productType !== 'Flights' || !dataObject) {
      console.warn('[update-passport] order', orderId, 'item', itemId, 'is not a flight on this order');
      return fail(res, GENERIC_FAIL);
    }

    // Eligibility, again, on today's date. The page decided the same thing
    // when it drew the form; it may have been open for days since.
    const today = ppToday();
    const e = ppEligibility(dataObject, today);
    if (!e.editable) return fail(res, CLOSED, { closed: true });

    const travellers = Array.isArray(ppField(dataObject, 'travellers')) ? ppField(dataObject, 'travellers') : [];
    const fields = {};
    const passengers = [];
    const seen = new Set();
    for (const entry of sent) {
      const index = Number(entry && entry.index);
      if (!Number.isInteger(index) || index < 0 || index >= travellers.length || seen.has(index)) continue;
      seen.add(index);
      const traveller = travellers[index];
      // Infants are never sent, whatever the page asked for.
      if (!traveller || typeof traveller !== 'object' || ppIsInfant(traveller)) continue;
      const { value, errors } = ppValidate(entry, e.lastDay, today);
      if (Object.keys(errors).length) { fields[index] = errors; continue; }
      if (!ppChanged(ppExisting(traveller), value)) continue;
      passengers.push(passengerBody(traveller, value));
    }
    if (Object.keys(fields).length) return fail(res, INVALID, { fields });
    if (!passengers.length) return fail(res, NOTHING, { nothing: true });

    const r = await callUpdatePaxFoid(creds, { orderId, orderKey, itemId }, passengers);
    const ok = !!(r.ok && r.json && r.json.success === true);
    console.log('[update-passport] order', orderId, 'item', itemId, passengers.length, 'passenger(s):', ok ? 'saved' : 'failed', 'HTTP', r.status);
    if (ok) return res.status(200).json({ success: true, saved: passengers.length });

    // Travelify's own words when it gave some on a proper answer; ours when the
    // answer was not one (a 5xx, a timeout, a body that is not JSON).
    if (r.ok && r.json && r.json.success === false && typeof r.json.error === 'string' && r.json.error.trim()) {
      return fail(res, safeText(r.json.error.trim(), 300));
    }
    return fail(res, GENERIC_FAIL);
  } catch (err) {
    // err.message only: an error thrown while a request body was in hand must
    // never carry that body into the log.
    console.error('[update-passport] error:', err && err.name, err && err.message ? String(err.message).slice(0, 160) : '');
    return fail(res, GENERIC_FAIL);
  }
}
