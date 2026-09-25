/**
 * POST /api/v1/booking-confirmations — send a booking's confirmation email,
 * on request from the Travelify core (25 Sep 2026).
 *
 * Andy: "We did an balance reminder API endpoint and now we want to add similar
 * functionality for sending the booking confirmation. We need an endpoint that
 * Darren can post to and then we will send the email."
 *
 * So this is /api/v1/payment-reminders' shape for the confirmation: the core
 * says "confirm this order", we validate, record to Airtable, answer 202 fast,
 * and the confirmation worker (api/cron/booking-confirmations.js) does the rest
 * off the request path. The worker is the one the signed webhook
 * (/api/v1/booking-webhook) already feeds, so the email is the same email: the
 * client's own layout, the A4 pack and any ATOL certificate, sent through
 * /api/booking-email, behind the same switches (global, per client, demo app).
 * See api/_lib/booking-confirmations.js for the decisions.
 *
 * Contract (published for the Travelify team at /booking-confirmations-api):
 *   Auth      X-Api-Key: <shared secret>   (env BOOKING_CONFIRMATION_API_KEY,
 *             else PAYMENT_REMINDER_API_KEY; timing-safe compare, 401 with no
 *             detail on any mismatch)
 *   Body      { applicationId, orderId, orderKey, email? }
 *             email: the address to send to (Andy, 25 Sep 2026: "Darren will
 *             send you the email address to send to"). Without it, the
 *             customer email on the order.
 *   202       { status: 'accepted', reference, receivedAtUtc }
 *   400       { error: 'validation_failed', fields: { <field>: <message> } }
 *   401       {}                            missing/wrong key
 *   429       { error: 'rate_limited' }
 *   500       { error: 'server_error' }     nothing was queued — please retry
 *
 * ONE REQUEST, ONE EMAIL, exactly as for the reminders (Andy, 25 Sep 2026:
 * "The email confirmation can get sent multiple times, but you have limited to
 * only send once - this needs changing"). The caller decides when a
 * confirmation is wanted, so every accepted request is queued and sends,
 * including a second request for a booking already confirmed. The first
 * version answered a repeat 409; that is gone. The booking's key is still
 * stored on each row, for audit and so the WEBHOOK does not add an automatic
 * confirmation for a booking the core has already confirmed.
 *
 * Server-to-server only: no CORS headers on purpose — a browser should never
 * call this, so no origin is ever allowed one.
 */

import crypto from 'node:crypto';
import { rateLimit, getClientIp } from '../_lib/travelify.js';
import { afterResponse } from '../_lib/after-response.js';
import { resolveApplication, timingSafeMatch } from '../_lib/payment-reminders.js';
import {
  resolveConfirmationApiKey,
  validateConfirmationRequest,
  confirmationKey,
  createConfirmationRecord,
} from '../_lib/booking-confirmations.js';

// The same generous ceiling as the reminders: a burst from one platform is
// fine, this only stops a runaway loop. In-memory per instance.
const IP_RATE_MAX = 2000; // per 15-minute window

// Never derived from request headers: the kick carries CRON_SECRET, and a
// spoofable Host must not be able to point that secret at someone else.
const SELF_ORIGIN = process.env.TG_SELF_ORIGIN || 'https://tg-widgets.vercel.app';

/**
 * Best-effort nudge so the worker sends within seconds instead of at the next
 * five-minute sweep. Runs AFTER the 202 has gone back; the sweep is the durable
 * consumer, so a failed kick costs nothing but a few minutes.
 */
async function kickWorker() {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  try {
    await fetch(`${SELF_ORIGIN}/api/cron/booking-confirmations`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(2000),
    });
  } catch { /* the sweep will get it */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const ip = getClientIp(req);
  if (!rateLimit(`bookconfapi:ip:${ip}`, IP_RATE_MAX).ok) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  // ── Auth (before any body handling) ───────────────────────────────────────
  const expected = resolveConfirmationApiKey();
  if (!expected) {
    // Never fall open to unauthenticated intake because config is missing.
    console.error('[booking-confirmations] no API key configured — rejecting');
    return res.status(500).json({ error: 'server_error' });
  }
  const provided = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '';
  if (!timingSafeMatch(provided, expected)) {
    console.warn('[booking-confirmations] rejected bad api key from', ip);
    return res.status(401).json({});
  }

  // ── Parse + validate ──────────────────────────────────────────────────────
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: 'validation_failed', fields: { body: 'Body must be valid JSON' } }); }
  }
  const { errors, value } = validateConfirmationRequest(body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'validation_failed', fields: errors });
  }

  // ── The applicationId must belong to a client we hold ─────────────────────
  let application;
  try {
    application = await resolveApplication(value.applicationId);
  } catch (err) {
    console.error('[booking-confirmations] registry lookup failed:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
  if (!application) {
    return res.status(400).json({
      error: 'validation_failed',
      fields: { applicationId: 'Unknown applicationId' },
    });
  }

  // ── Record + queue ────────────────────────────────────────────────────────
  // NO duplicate suppression: every accepted request is one row and one send,
  // the same order included (see the header). The key is stored, not enforced.
  const idemKey = confirmationKey(value);
  const reference = 'bc_' + crypto.randomUUID();
  const receivedAt = new Date();
  try {
    await createConfirmationRecord({
      reference, value, idemKey, receivedAt,
      clientName: application.clientName || '',
    });
  } catch (err) {
    console.error('[booking-confirmations] record create failed:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }

  console.log('[booking-confirmations] accepted', reference,
    'app', value.applicationId, 'order', value.orderId);

  res.status(202).json({
    status: 'accepted',
    reference,
    receivedAtUtc: receivedAt.toISOString(),
  });

  // The 202 is already on the wire; this nudge costs the caller nothing.
  // Held open with waitUntil: without it Vercel freezes the function once the
  // answer has gone, and the nudge never left (25 Sep 2026).
  await afterResponse(kickWorker());
  return undefined;
}
