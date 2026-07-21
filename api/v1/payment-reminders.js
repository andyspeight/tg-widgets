/**
 * POST /api/v1/payment-reminders — Payment Reminder intake (phase 1).
 *
 * The Travelify core platform calls this (roughly daily) to say an order has
 * a balance due. We validate, record to Airtable, atomically dedupe, answer
 * 202 fast, and hand the real work to the background worker. See
 * api/_lib/payment-reminders.js for the architecture and the contract
 * decisions; the worker is api/cron/payment-reminders.js.
 *
 * Contract (documented for the Travelify team):
 *   Auth      X-Api-Key: <shared secret>   (env PAYMENT_REMINDER_API_KEY,
 *             timing-safe compare, 401 with no detail on any mismatch)
 *   Body      { applicationId, orderId, orderKey, reminderType,
 *               amountDue, currency, dueDate? }
 *   202       { status: 'accepted', reference, receivedAtUtc }
 *   400       { error: 'validation_failed', fields: { <field>: <message> } }
 *   401       {}                            missing/wrong key
 *   409       { status: 'duplicate', reference }   same notification already
 *             accepted today (retries are safe; log the returned reference)
 *   429       { error: 'rate_limited' }
 *   500       { error: 'server_error' }     recording failed — please retry
 *
 * Optional Idempotency-Key request header is honoured in preference to the
 * natural dedupe key when present.
 *
 * Server-to-server only: no CORS headers on purpose — a browser should never
 * call this, so no origin is ever allowed one.
 */

import crypto from 'node:crypto';
import { rateLimit, getClientIp } from '../_lib/travelify.js';
import {
  resolveExpectedApiKey,
  timingSafeMatch,
  validateReminderPayload,
  validateCallerIdempotencyKey,
  resolveApplication,
  buildIdempotencyKey,
  claimIdempotency,
  releaseIdempotencyClaim,
  findReminderByIdempotencyKey,
  createReminderRecord,
} from '../_lib/payment-reminders.js';

// Generous ceiling: the core pushes its whole daily batch in one burst from
// one IP, so this only needs to stop runaway loops and abuse, not shape
// legitimate traffic. (In-memory per instance, same pattern as the other
// public endpoints.)
const IP_RATE_MAX = 2000; // per 15-minute window

// The stable production origin for the self-kick. Never derived from request
// headers: the kick carries CRON_SECRET, and a spoofable Host header must
// not be able to point that secret at someone else's server.
const SELF_ORIGIN = process.env.TG_SELF_ORIGIN || 'https://tg-widgets.vercel.app';

/**
 * Best-effort nudge so the worker picks the item up within seconds instead
 * of waiting for the next cron sweep. Runs AFTER the 202 has been sent.
 * Failure is fine — the cron sweep is the durable consumer.
 */
async function kickWorker() {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  try {
    await fetch(`${SELF_ORIGIN}/api/cron/payment-reminders`, {
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
  const gate = rateLimit(`payrem:ip:${ip}`, IP_RATE_MAX);
  if (!gate.ok) return res.status(429).json({ error: 'rate_limited' });

  // ── Auth (before any body handling) ───────────────────────────────────────
  const expected = resolveExpectedApiKey();
  if (!expected) {
    // Never fall open to unauthenticated intake because config is missing.
    console.error('[payment-reminders] PAYMENT_REMINDER_API_KEY is not set — rejecting');
    return res.status(500).json({ error: 'server_error' });
  }
  const provided = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '';
  if (!timingSafeMatch(provided, expected)) {
    console.warn('[payment-reminders] rejected bad api key from', ip);
    return res.status(401).json({});
  }

  // ── Parse + validate ──────────────────────────────────────────────────────
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: 'validation_failed', fields: { body: 'Body must be valid JSON' } }); }
  }
  const { errors, value } = validateReminderPayload(body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'validation_failed', fields: errors });
  }

  // ── Caller registry: the applicationId must belong to a known client ──────
  let application;
  try {
    application = await resolveApplication(value.applicationId);
  } catch (err) {
    console.error('[payment-reminders] registry lookup failed:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
  if (!application) {
    return res.status(400).json({
      error: 'validation_failed',
      fields: { applicationId: 'Unknown applicationId' },
    });
  }

  // ── Record + dedupe + queue ───────────────────────────────────────────────
  const receivedAt = new Date();
  const reference = crypto.randomUUID();
  const callerKey = validateCallerIdempotencyKey(req.headers['idempotency-key']);
  const idemKey = buildIdempotencyKey(value, receivedAt, callerKey);

  let claim = await claimIdempotency(idemKey, reference);
  if (claim.state === 'duplicate') {
    return res.status(409).json({ status: 'duplicate', reference: claim.reference });
  }
  if (claim.state === 'unavailable') {
    console.warn('[payment-reminders] idempotency degraded to Airtable lookup');
  }
  // Storage is consulted on BOTH remaining paths, not just 'unavailable'.
  // A record with this key can predate the Redis claim: a notification
  // accepted while Redis was down never wrote one, so after recovery a
  // same-day retry looks brand new to Redis. Without this check that retry
  // would be accepted twice (double order fetch now, double email in
  // phase 2). One extra read per genuinely-new notification is nothing at
  // the core's daily-batch volume.
  try {
    const existing = await findReminderByIdempotencyKey(idemKey);
    if (existing) {
      // Our just-taken claim holds a reference that was never used; drop it
      // so later retries keep resolving to the ORIGINAL reference.
      if (claim.state === 'new') await releaseIdempotencyClaim(idemKey);
      return res.status(409).json({ status: 'duplicate', reference: existing.fields?.Reference || null });
    }
  } catch (err) {
    if (claim.state === 'unavailable') {
      // Can't dedupe AND can't check storage: refuse rather than risk a
      // double-send in phase 2. The core retries on 500 by contract.
      console.error('[payment-reminders] dedupe fallback failed:', err.message);
      return res.status(500).json({ error: 'server_error' });
    }
    // Redis already arbitrated atomically; the storage check only guards the
    // outage-predating case, so a failed read here is safe to proceed past.
    console.warn('[payment-reminders] storage dedupe check failed (claim held):', err.message);
  }

  try {
    await createReminderRecord({
      reference,
      value,
      idemKey,
      receivedAt,
      clientName: application.clientName || '',
    });
  } catch (err) {
    console.error('[payment-reminders] record create failed:', err.message);
    if (claim.state === 'new') await releaseIdempotencyClaim(idemKey);
    return res.status(500).json({ error: 'server_error' });
  }

  if (claim.state === 'unavailable') {
    // Best-effort claim back-fill so Redis resumes arbitration the moment it
    // recovers; while it stays down, the storage check above keeps covering.
    await claimIdempotency(idemKey, reference);
  }

  console.log('[payment-reminders] accepted', reference,
    'app', value.applicationId, 'order', value.orderId, value.reminderType,
    value.amountDue, value.currency);

  res.status(202).json({
    status: 'accepted',
    reference,
    receivedAtUtc: receivedAt.toISOString(),
  });

  // The 202 is already on the wire; this nudge costs the core nothing.
  await kickWorker();
}
