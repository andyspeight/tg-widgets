/**
 * POST /api/v1/booking-webhook — the Travelgenix booking webhook.
 *
 * Travelgenix pushes here when something happens to an order. We verify the
 * signature, record the notification, answer 200, and hand the real work to the
 * background worker (api/cron/booking-confirmations.js). See
 * api/_lib/booking-confirmations.js for the architecture and the decisions.
 *
 * Setting it up (Suppliers Directory → CRM, Marketing & Backoffice → Add):
 *   Endpoint URL      https://widgets.travelify.io/api/v1/booking-webhook
 *   Custom endpoint   on
 *   Events            Order Complete  (Order Update / Order Cancel may be
 *                     ticked too; they are recorded and never emailed)
 *   Security Key      the value of BOOKING_WEBHOOK_SECRET in Vercel
 *
 * Contract (documented for the Travelgenix team):
 *   Headers   Content-Type: application/json; charset=utf-8
 *             Travelgenix-Signature: <base64 HMAC-SHA256 of the raw body>
 *   Body      { eventtype, appid, appidentifier?, data: { id, key, ... },
 *               url, timestamp }
 *   200       { status: 'accepted' | 'duplicate' | 'ignored', reference? }
 *   400       { error: 'validation_failed', fields: { <field>: <message> } }
 *   401       {}   missing or wrong signature
 *   429       { error: 'rate_limited' }
 *   500       { error: 'server_error' }   recording failed — please retry
 *
 * Why an UNKNOWN application still answers 200: the push succeeded, we simply
 * have nothing to do with it. Answering 500 would make Travelgenix retry a
 * message that can never be processed, and eventually mark a healthy
 * connection failed.
 *
 * The five-second budget is the whole reason this endpoint is so short.
 *
 * Server-to-server only: no CORS headers on purpose.
 */

import crypto from 'node:crypto';
import { rateLimit, getClientIp } from '../_lib/travelify.js';
import { resolveApplication } from '../_lib/payment-reminders.js';
import {
  resolveWebhookSecret,
  verifyWebhookSignature,
  validateWebhookPayload,
  buildIdempotencyKey,
  findByIdempotencyKey,
  createConfirmationRecord,
} from '../_lib/booking-confirmations.js';

// We read the body ourselves: the signature covers the RAW bytes, and letting
// the platform parse and re-serialise it would change the whitespace and never
// verify.
export const config = { api: { bodyParser: false } };

// One platform sends its whole burst from one address, so this only has to
// stop a runaway loop, not shape real traffic.
const IP_RATE_MAX = 2000;            // per 15-minute window
const MAX_BODY_BYTES = 256 * 1024;

// Never derived from request headers: the kick carries CRON_SECRET, and a
// spoofable Host must not be able to point that secret at someone else.
const SELF_ORIGIN = process.env.TG_SELF_ORIGIN || 'https://tg-widgets.vercel.app';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Best-effort nudge so the worker picks the booking up within seconds rather
 * than waiting for the next sweep. Runs AFTER the 200 has gone back, and its
 * failure is fine: the cron is the durable consumer.
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const ip = getClientIp(req);
  if (!rateLimit(`bookconf:ip:${ip}`, IP_RATE_MAX).ok) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  // ── The raw body, then the signature, before anything is trusted ──────────
  let raw;
  try { raw = await readRawBody(req); }
  catch (err) {
    console.warn('[booking-webhook] body read failed:', err.message);
    return res.status(400).json({ error: 'bad_request' });
  }

  const secret = resolveWebhookSecret();
  if (!secret) {
    // Never fall open to unauthenticated intake because config is missing.
    console.error('[booking-webhook] BOOKING_WEBHOOK_SECRET is not set — rejecting');
    return res.status(500).json({ error: 'server_error' });
  }
  const signature = req.headers['travelgenix-signature'];
  if (!verifyWebhookSignature(raw, Array.isArray(signature) ? signature[0] : signature, secret)) {
    console.warn('[booking-webhook] rejected bad signature from', ip);
    return res.status(401).json({});
  }

  let body;
  try { body = JSON.parse(raw.toString('utf8')); }
  catch { return res.status(400).json({ error: 'validation_failed', fields: { body: 'body must be JSON' } }); }

  const { errors, value } = validateWebhookPayload(body);
  if (Object.keys(errors).length) {
    console.warn('[booking-webhook] validation failed:', JSON.stringify(errors));
    return res.status(400).json({ error: 'validation_failed', fields: errors });
  }

  // ── Whose booking is this? ────────────────────────────────────────────────
  let application = null;
  try { application = await resolveApplication(value.applicationId); }
  catch (err) { console.warn('[booking-webhook] application lookup failed:', err.message); }
  if (!application) {
    // A real push for an application we do not hold credentials for. Nothing to
    // do, and nothing gained by making them retry it.
    console.warn('[booking-webhook] no client for appid', value.applicationId);
    return res.status(200).json({ status: 'ignored' });
  }

  // ── One booking, one confirmation ─────────────────────────────────────────
  const idemKey = buildIdempotencyKey(value);
  try {
    const existing = await findByIdempotencyKey(idemKey);
    if (existing) {
      return res.status(200).json({
        status: 'duplicate',
        reference: existing.fields?.Reference || null,
      });
    }
  } catch (err) {
    // A lookup failure must not become a silent second confirmation, so we ask
    // for a retry rather than queueing a row we could not check.
    console.error('[booking-webhook] duplicate check failed:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }

  const reference = 'bc_' + crypto.randomUUID();
  const receivedAt = new Date();
  try {
    await createConfirmationRecord({
      reference, value, idemKey, receivedAt,
      clientName: application.clientName || '',
    });
  } catch (err) {
    console.error('[booking-webhook] record failed:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }

  res.status(200).json({ status: 'accepted', reference, receivedAtUtc: receivedAt.toISOString() });
  await kickWorker();
  return undefined;
}
