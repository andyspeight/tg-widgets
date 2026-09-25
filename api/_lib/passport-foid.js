// =============================================================================
//  /api/_lib/passport-foid.js — passports on a flight, the server's half
// =============================================================================
//
//  The rules live in public/_passport-rules.js (read that first). This file is
//  the server-only part:
//    - passportState(): what /api/retrieve-order puts on a Flights item so the
//      My Booking page knows whether to offer the form and what to fill it with;
//    - passengerBody(): one passenger for Travelify's updatepaxfoid body;
//    - contactBody(): the emergency contact that goes with every save;
//    - callUpdatePaxFoid(): the call itself.
//
//  A passport number reaches the page in full only while the customer may
//  still edit it, because the form opens pre-filled with it. Once editing has
//  closed, the page gets the last four characters and nothing more. The
//  emergency contact reaches the page only while the form can be used, for
//  the same reason. Neither is ever logged (the spec: "Do not write passport
//  numbers, email addresses or telephone numbers to console output, analytics
//  or client-side logs").

import { travelifyAuthHeaders } from './travelify.js';
import {
  ppField, ppList, ppEligibility, ppExisting, ppComplete, ppMask, ppContactExisting,
} from '../../public/_passport-rules.js';

export * from '../../public/_passport-rules.js';

const UPDATE_PAX_FOID_BASE = 'https://api.travelify.io/updatepaxfoid';

function str(v, max) {
  if (v == null) return '';
  return String(v).slice(0, max);
}

/**
 * The passport block for a Flights item's dataObject, or null when the page
 * has nothing to show (no form to offer and no passport already on file).
 * `order` is the raw order, for the booking's own email and telephone.
 *
 *   { editable, departDay, lastDay,
 *     contact: { email, prefix, number },                                 // editable only
 *     travellers: [{ index, type, title, firstname, surname,
 *                    passport: { number, country, issued, expires }   // editable
 *                           or { masked, country, expires } | null }] }  // read-only
 */
export function passportState(dataObject, today, order) {
  const e = ppEligibility(dataObject, today);
  const travellers = e.people.map(({ index, traveller }) => {
    const p = ppExisting(traveller);
    const has = !!(p.number || p.country || p.issued || p.expires);
    return {
      index,
      type: str(ppField(traveller, 'type'), 30),
      title: str(ppField(traveller, 'title'), 30),
      firstname: str(ppField(traveller, 'firstname'), 80),
      surname: str(ppField(traveller, 'surname'), 80),
      complete: ppComplete(p),
      passport: !has ? null
        : e.editable ? { number: p.number, country: p.country, issued: p.issued, expires: p.expires }
          : { masked: ppMask(p.number), country: p.country, expires: p.expires },
    };
  });
  if (!e.editable && !travellers.some((t) => t.passport)) return null;
  const out = {
    editable: e.editable,
    departDay: e.departDay,
    lastDay: e.lastDay,
    travellers,
  };
  // The emergency contact the form starts from: travellers[0], the primary
  // passenger, whoever they are, else the booking. Only while it can be used.
  if (e.editable) {
    const c = ppContactExisting(order || {}, ppList(ppField(dataObject, 'travellers'))[0]);
    out.contact = { email: str(c.email, 254), prefix: str(c.prefix, 4), number: str(c.number, 20) };
  }
  return out;
}

/**
 * One passenger for the request: every field the order holds for them, as
 * the order holds it, under PascalCase names (the spec's own mapping:
 * firstname to Firstname, middleNames to MiddleNames, dateOfBirth to
 * DateOfBirth), then the five FOID fields from the form. The API reads either
 * case, and one convention per request is the spec's rule, so every key is
 * PascalCase. Nothing that is not a FOID field is changed, reformatted or
 * dropped; any FOID field the order already carried is replaced, not doubled.
 */
export function passengerBody(traveller, value) {
  const out = {};
  for (const k of Object.keys(traveller || {})) {
    if (/^foid/i.test(k)) continue;
    const pascal = k.charAt(0).toUpperCase() + k.slice(1);
    if (!Object.prototype.hasOwnProperty.call(out, pascal)) out[pascal] = traveller[k];
  }
  out.FOIDType = 'Passport';
  out.FOIDNumber = value.number;
  out.FOIDIssuingCountry = value.country;
  out.FOIDStartDate = value.issued;
  out.FOIDExpiryDate = value.expires;
  return out;
}

/**
 * The emergency contact as the request carries it, next to Passengers:
 * { EmailAddress, Telephone: { CountryPrefix, Number } }. Both telephone parts
 * are strings, so a leading zero survives; the prefix has no "+". `value` is
 * what ppValidateContact returned.
 */
export function contactBody(value) {
  return {
    EmailAddress: String(value.email),
    Telephone: { CountryPrefix: String(value.prefix), Number: String(value.number) },
  };
}

/**
 * POST https://api.travelify.io/updatepaxfoid/{orderId}/{orderKey}/{itemId}.
 * `contact` is contactBody()'s result, or null to send passengers alone.
 */
export async function callUpdatePaxFoid({ appId, apiKey }, { orderId, orderKey, itemId }, passengers, contact) {
  const url = `${UPDATE_PAX_FOID_BASE}/${encodeURIComponent(orderId)}/${encodeURIComponent(orderKey)}/${encodeURIComponent(itemId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: travelifyAuthHeaders(appId, apiKey),
    body: JSON.stringify(Object.assign({}, contact || {}, { Passengers: passengers })),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, ok: res.ok, json };
}
