/**
 * Travelgenix Control — Pay Balance BY CLIENT RECORD ID (internal endpoint)
 *
 * Server-to-server sibling of /api/pay-balance, the way retrieve-order-by-client
 * is the sibling of /api/retrieve-order. Where pay-balance is keyed by widgetId
 * (public, called by the embedded My Booking widget), this is keyed by a
 * Clients record id and is called ONLY by trusted Travelgenix services
 * (currently Luna Travel's traveller app) carrying the shared internal key.
 *
 * Why this exists:
 *   The traveller app shows what a booking still owes (it reads order.money
 *   from retrieve-order-by-client) and needs the same Pay button the My
 *   Booking widget has. It knows the agency by its Control record, not by a
 *   widget, so it cannot call /api/pay-balance.
 *
 * It is the SAME payment, not a second implementation:
 *   - the amount comes from decideCharge over an order fetched here, on the
 *     server, from Travelify: the calculation the widget, the PDF, the emails
 *     and the reminder cron all use. A requested amount is only a request, and
 *     is re-validated against the real outstanding exactly as for the widget.
 *   - the basket is raised by createBasket, the function /api/pay-balance
 *     itself calls.
 *
 * Auth:
 *   X-TG-Internal-Key header must match env TG_INTERNAL_KEY (timing-safe).
 *   No cookie, no CORS: this is never called from a browser. The traveller app
 *   supplies the lookup triplet from its own signed-in traveller record, never
 *   from anything the phone sends.
 *
 * Request (POST):
 *   { recordId, emailAddress, departDate, orderRef, amount? }
 * Response:
 *   200 { ok: true, url, payment: { amount, currency, remainingAmount, dueDate, isInstalment } }
 *   200 { ok: false, noBalance: true }        nothing is owed
 *   400 { error: 'invalid_amount', message }  a requested amount failed validation
 *   400 { error: 'bad_request' }
 *   401 { error: 'unauthorised' }
 *   404 { error: 'not_found' }                no credentials, or no such order
 *   429 { error: 'rate_limited' }
 *   502 { error: 'upstream' }                 Travelify would not raise a basket
 */

import { constantTimeEqual } from '../_lib/auth/crypto.js';
import { lookupClientCredentialsByRecordId } from '../_auth.js';
import {
  rateLimit,
  validateEmail,
  validateDate,
  validateOrderRef,
  fetchTravelifyOrderRaw,
  readOrderKey,
} from '../_lib/travelify.js';
import { decideCharge, createBasket } from '../pay-balance.js';

// Per booking. Generous for a person tapping Pay and coming back, far too low
// for anything automated to raise baskets in bulk.
const MAX_PER_BOOKING = 10;

function validateRecordId(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim();
  return /^rec[A-Za-z0-9]{14}$/.test(v) ? v : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const provided = typeof req.headers['x-tg-internal-key'] === 'string'
    ? req.headers['x-tg-internal-key'] : '';
  const expected = process.env.TG_INTERNAL_KEY;
  if (!expected || !constantTimeEqual(provided, expected)) {
    return res.status(401).json({ error: 'unauthorised' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'bad_request' });
  }

  const recordId = validateRecordId(body.recordId);
  const emailAddress = validateEmail(body.emailAddress);
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);
  if (!recordId || !emailAddress || !departDate || !orderRef) {
    return res.status(400).json({ error: 'bad_request' });
  }

  const limit = rateLimit(`pay:client:${recordId}:${orderRef}`, MAX_PER_BOOKING);
  if (!limit.ok) {
    console.warn('[pay-balance-by-client] rate limited', recordId, orderRef);
    return res.status(429).json({ error: 'rate_limited', retryAfterMs: limit.retryAfterMs });
  }

  try {
    let creds;
    try {
      creds = await lookupClientCredentialsByRecordId(recordId);
    } catch (e) {
      console.error('[pay-balance-by-client] cred lookup failed:', e.message);
      return res.status(404).json({ error: 'not_found' });
    }
    if (!creds || !creds.appId || !creds.apiKey) {
      console.warn('[pay-balance-by-client] no credentials for', recordId);
      return res.status(404).json({ error: 'not_found' });
    }

    const raw = await fetchTravelifyOrderRaw(creds, { emailAddress, departDate, orderRef });
    if (!raw) return res.status(404).json({ error: 'not_found' });

    const orderId = String(raw.id);
    const orderKey = readOrderKey(raw);
    if (!orderKey) {
      console.error('[pay-balance-by-client] order key missing on order', orderId, '— keys:', Object.keys(raw).join(','));
      return res.status(502).json({ error: 'upstream' });
    }

    const requested = (body.amount === undefined || body.amount === null || body.amount === '') ? null : body.amount;
    const decision = decideCharge(raw, requested);
    if (decision.invalid) {
      return res.status(400).json({ error: 'invalid_amount', message: decision.invalid });
    }

    console.log('[pay-balance-by-client] order', orderId,
      'total:', decision.total, 'paid:', decision.paid, 'outstanding:', decision.outstanding,
      'requested:', requested, 'charge:', decision.noBalance ? 'none' : decision.amount);

    if (decision.noBalance) return res.status(200).json({ ok: false, noBalance: true });

    const url = await createBasket(creds, { raw, orderId, orderKey, orderRef }, decision, 'pay-balance-by-client');
    if (!url) return res.status(502).json({ error: 'upstream' });

    return res.status(200).json({
      ok: true,
      url,
      payment: {
        amount: decision.amount,
        currency: decision.currency,
        remainingAmount: decision.remainingAmount,
        dueDate: decision.dueDate,
        isInstalment: decision.isInstalment,
      },
    });
  } catch (err) {
    console.error('[pay-balance-by-client] error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
}
