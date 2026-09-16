/**
 * Booking Confirmation pipeline — shared library.
 *
 * Andy, 16 Sep 2026: "We are going to add more functionality to the My Booking
 * widget using webhooks to be told when there is a new booking, and then use
 * the existing API to call the booking details and then send out a
 * confirmation to the client (this is something we are taking over from
 * Travelify, which used to send the email)."
 *
 * The Travelgenix platform pushes an `order.complete` webhook when a booking is
 * paid and confirmed (contract: https://university.travelgenix.io/webhooks).
 * POST /api/v1/booking-webhook verifies it, records it, answers 200 fast, and a
 * cron worker (api/cron/booking-confirmations.js) fetches the full order and
 * sends the client's own confirmation email with the PDF pack attached.
 *
 * This is deliberately the SAME SHAPE as the payment reminder pipeline, and
 * reuses its parts rather than growing a second copy of each: the application
 * lookup, the order fetch by id + key, the branding resolver, the processing
 * lock and the send guard are all imported from api/_lib/payment-reminders.js.
 * What is genuinely different lives here.
 *
 * The contract, and why:
 *
 *  - FIVE SECONDS. Travelgenix marks the push failed if we have not answered
 *    in five, so the endpoint does nothing but verify, write one Airtable row
 *    and reply. Fetching an order, drawing a PDF and handing it to SendGrid
 *    does not fit in that budget and must not be attempted on the request.
 *
 *  - SIGNATURE. When a Security Key is set on the webhook connection,
 *    Travelgenix signs the RAW body with HMAC-SHA256 and sends it base64 in
 *    `Travelgenix-Signature`. We require it: an unsigned push is refused,
 *    because the alternative is an open endpoint that emails a stranger's
 *    customers on request. The key is one platform key (env
 *    BOOKING_WEBHOOK_SECRET) exactly as PAYMENT_REMINDER_API_KEY is, and
 *    resolveWebhookSecret takes the application id so per-client keys can
 *    arrive later without the endpoint changing shape.
 *
 *  - ONE EMAIL PER BOOKING. Unlike the reminders, where the caller decides
 *    when a chase is warranted, a confirmation must never go twice. The
 *    natural key applicationId|orderId|eventtype is stored AND enforced: a
 *    repeat is answered 200 (the push succeeded, we simply already have it)
 *    rather than queued again.
 *
 *  - PER CLIENT (Andy, same day: "Per client as the booking gets notified to
 *    us"). The client switches the confirmation on in their My Booking editor.
 *    Nothing is sent for a client who has not, even once their webhook is
 *    wired up, so a client can be connected and watched before they go live.
 *
 *  - NEW BOOKINGS ONLY, to start with (Andy: "New booking to start with").
 *    order.update and order.cancel are accepted and recorded so the connection
 *    stays healthy and we can see the traffic, but they are marked Skipped and
 *    never email anyone. order.update is not implemented upstream anyway.
 *
 *  - OFF BY DEFAULT. BOOKING_CONFIRMATION_SEND_ENABLED must be set to true in
 *    Vercel before a single email leaves. Travelify still sends its own
 *    confirmation until each client is switched over there (Andy: "It will be
 *    a setting in Travelify as not everyone will move over to the new
 *    version"), and the cost of getting the changeover wrong is a customer
 *    receiving two confirmations for the same booking.
 */

import crypto from 'node:crypto';
import { claimNxEx } from '../_redis.js';
import { sanitiseForFormula } from '../_auth.js';
import { DEMO_APP_ID } from './travelify.js';

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
export const CONFIRMATIONS_TABLE = 'tbl9aTotenNERAKXa';

/**
 * Every event we accept. Only SENDING_EVENTS result in an email; the rest are
 * recorded and skipped, so the connection can be left switched on for all of
 * them in the Suppliers Directory without surprising anybody.
 */
export const WEBHOOK_EVENTS = ['order.complete', 'order.update', 'order.cancel'];
export const SENDING_EVENTS = ['order.complete'];

export const MAX_ATTEMPTS = 5;

/**
 * A push older than this never emails. A confirmation is only useful while it
 * is news; a queue drained late, or a test row sitting from before the flag was
 * flipped, must not turn into a surprise email about a trip already taken.
 */
export const MAX_AGE_MS = 12 * 60 * 60 * 1000;

const LOCK_PREFIX = 'bookconf:lock:';

// ── Auth ─────────────────────────────────────────────────────────────────────

/**
 * The Security Key set on the client's webhook connection. Takes the
 * application id so this can grow into a per-application registry without the
 * endpoint changing; today every application shares the platform key.
 */
export function resolveWebhookSecret(_applicationId) {
  return process.env.BOOKING_WEBHOOK_SECRET || '';
}

/**
 * Verify Travelgenix's signature over the RAW request body.
 *
 * "To verify the signature, take the raw JSON request data we send you and
 * encode it using your Security Key" — HMAC-SHA256, sent base64 in the
 * Travelgenix-Signature header. The raw bytes matter: re-serialising the
 * parsed JSON would change the whitespace and never match.
 */
export function verifyWebhookSignature(rawBody, headerValue, secret) {
  if (!secret) return false;
  if (typeof headerValue !== 'string' || !headerValue.trim()) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expected = crypto.createHmac('sha256', secret).update(body).digest();

  let provided;
  try { provided = Buffer.from(headerValue.trim(), 'base64'); }
  catch { return false; }
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

// ── Validation ───────────────────────────────────────────────────────────────

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isPositiveInt(v, max) {
  const n = typeof v === 'string' && /^\d{1,16}$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= max;
}
const toInt = (v) => (typeof v === 'number' ? v : Number(v));

/**
 * Validate the webhook body against the published payload. Returns
 * { errors, value } — errors is a field→message map, empty when valid.
 *
 * Only the fields we actually use are required. appidentifier, url and the
 * customer name parts are read when present and never depended on: the order
 * itself is the source of truth for everything the email prints, and the
 * summary in the push exists for correlation and support.
 */
export function validateWebhookPayload(body) {
  const errors = {};
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const data = (b.data && typeof b.data === 'object' && !Array.isArray(b.data)) ? b.data : {};

  const eventType = typeof b.eventtype === 'string' ? b.eventtype.trim().toLowerCase() : '';
  if (!WEBHOOK_EVENTS.includes(eventType)) {
    errors.eventtype = `eventtype must be one of: ${WEBHOOK_EVENTS.join(', ')}`;
  }
  if (!isPositiveInt(b.appid, 2147483647)) {
    errors.appid = 'appid must be a positive integer';
  }
  if (!isPositiveInt(data.id, Number.MAX_SAFE_INTEGER)) {
    errors['data.id'] = 'data.id must be a positive integer';
  }
  if (typeof data.key !== 'string' || !GUID_RE.test(data.key.trim())) {
    errors['data.key'] = 'data.key must be a 36-character GUID';
  }

  if (Object.keys(errors).length) return { errors, value: null };

  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const amount = typeof data.amount === 'number' && Number.isFinite(data.amount) ? data.amount : null;
  return {
    errors,
    value: {
      eventType,
      applicationId: toInt(b.appid),
      appIdentifier: str(b.appidentifier, 100),
      orderId: toInt(data.id),
      orderKey: data.key.trim(),
      status: str(data.status, 40),
      currency: /^[A-Za-z]{3}$/.test(str(data.currency, 3)) ? str(data.currency, 3).toUpperCase() : '',
      amount,
      itemsCount: isPositiveInt(data.itemscount, 1000) ? toInt(data.itemscount) : null,
      customerEmail: str(data.customeremail, 254).toLowerCase(),
      customerFirstName: str(data.customerfirstname, 100),
      timestamp: str(b.timestamp, 40),
    },
  };
}

/**
 * One booking, one confirmation. Unlike a balance chase there is never a good
 * reason to send this twice, so the natural key is enforced rather than merely
 * recorded.
 */
export function buildIdempotencyKey(value) {
  return `${value.applicationId}|${value.orderId}|${value.eventType}`;
}

/** Only this event sends an email today. */
export function eventSends(eventType) {
  return SENDING_EVENTS.includes(String(eventType || '').toLowerCase());
}

/** Nothing emails anyone until Andy flips this in Vercel. */
export function sendingEnabled() {
  return String(process.env.BOOKING_CONFIRMATION_SEND_ENABLED || '').toLowerCase() === 'true';
}

/**
 * End-to-end testing without going live: these Travelify App IDs may send even
 * while the global switch is off, and if a redirect address is set every email
 * from them goes there instead of to the real customer. Both empty by default,
 * so nothing changes for anyone until they are set.
 */
export function confirmationTestAppIds() {
  return String(process.env.BOOKING_CONFIRMATION_TEST_APP_IDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}
export function isConfirmationTestApp(applicationId) {
  return confirmationTestAppIds().includes(String(applicationId));
}
export function confirmationTestRecipient() {
  const v = String(process.env.BOOKING_CONFIRMATION_TEST_RECIPIENT || '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v) ? v : '';
}

/**
 * Travelgenix's published demo application, which must never email a real
 * person. ONE id, taken from the platform's own constant rather than from the
 * webhook documentation: the sample payloads on that page use appid 100, but
 * that is an illustration, not a registration. Treating 100 as a demo would
 * silently swallow every confirmation for a real client who happened to hold
 * that App ID.
 */
export const DEMO_APP_IDS = [DEMO_APP_ID];
export function isDemoApp(applicationId) {
  return DEMO_APP_IDS.includes(String(applicationId));
}

// ── Locks ────────────────────────────────────────────────────────────────────

/** Stops the immediate kick and the cron sweep working the same row twice. */
export async function acquireProcessingLock(reference) {
  return await claimNxEx(LOCK_PREFIX + reference, '1', 180);
}

/**
 * One-shot guard around the send itself, so a crash between SendGrid accepting
 * the message and the Sent stamp landing cannot double-email a customer.
 * 'error' (Redis down) proceeds: the Sent stamp still prevents a re-send in
 * every non-crash path.
 */
export async function claimSendGuard(reference) {
  return await claimNxEx(`bookconf:sent:${reference}`, '1', 30 * 24 * 60 * 60);
}

// ── Airtable store ───────────────────────────────────────────────────────────

function airtableHeaders() {
  const key = process.env.AIRTABLE_KEY;
  if (!key) throw new Error('AIRTABLE_KEY env var missing');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

const tableUrl = () => `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CONFIRMATIONS_TABLE}`;

async function airtableRequest(url, options, stage) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  } catch (err) {
    const e = new Error(`${stage} request failed: ${err.message}`);
    e.stage = stage;
    throw e;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`${stage} HTTP ${res.status}: ${body.slice(0, 200)}`);
    e.stage = stage;
    throw e;
  }
  return res.json();
}

/** The row already here for this exact event, or null. */
export async function findByIdempotencyKey(idemKey) {
  const formula = `{IdempotencyKey}='${sanitiseForFormula(idemKey)}'`;
  const url = `${tableUrl()}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const data = await airtableRequest(url, { headers: airtableHeaders() }, 'duplicate-check');
  return (data.records || [])[0] || null;
}

/** Queue one accepted notification. */
export async function createConfirmationRecord({ reference, value, idemKey, receivedAt, clientName }) {
  const fields = {
    Reference: reference,
    ApplicationId: value.applicationId,
    OrderId: value.orderId,
    OrderKey: value.orderKey,
    EventType: value.eventType,
    Status: 'Accepted',
    IdempotencyKey: idemKey,
    ReceivedAtUtc: receivedAt.toISOString(),
    Attempts: 0,
    ClientName: clientName || '',
  };
  if (value.customerEmail) fields.CustomerEmail = value.customerEmail;
  if (value.currency) fields.Currency = value.currency;
  if (value.amount != null) fields.Amount = value.amount;

  const data = await airtableRequest(
    tableUrl(),
    // typecast so an event option added upstream materialises on first use.
    // Safe: EventType is validated against WEBHOOK_EVENTS before it gets here.
    { method: 'POST', headers: airtableHeaders(), body: JSON.stringify({ records: [{ fields }], typecast: true }) },
    'record',
  );
  return data.records?.[0]?.id || null;
}

/**
 * Oldest first, so a backlog drains in the order the bookings were made.
 * Accepted = not yet fetched, Fetched = order read but not yet emailed (a send
 * failed and is awaiting its backoff). Sent, Skipped and Failed are terminal.
 */
export async function listPendingConfirmations(limit = 25) {
  const formula = `OR({Status}='Accepted',{Status}='Fetched')`;
  const url = `${tableUrl()}?filterByFormula=${encodeURIComponent(formula)}`
    + `&maxRecords=${limit}`
    + `&sort%5B0%5D%5Bfield%5D=ReceivedAtUtc&sort%5B0%5D%5Bdirection%5D=asc`;
  const data = await airtableRequest(url, { headers: airtableHeaders() }, 'queue-list');
  return data.records || [];
}

export async function updateConfirmationRecord(recordId, fields) {
  await airtableRequest(
    `${tableUrl()}/${recordId}`,
    { method: 'PATCH', headers: airtableHeaders(), body: JSON.stringify({ fields, typecast: true }) },
    'record-update',
  );
}
