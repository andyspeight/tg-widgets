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
 *  - ONE EMAIL PER WEBHOOK PUSH. A push repeated by the platform (a retry, a
 *    duplicate delivery) must not become a second email, so for the webhook
 *    the natural key applicationId|orderId|eventtype is stored AND enforced: a
 *    repeat is answered 200 (the push succeeded, we simply already have it)
 *    rather than queued again. This is the WEBHOOK's rule. The direct request
 *    below is caller-driven and sends every time it is asked.
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
 *  - A SECOND WAY IN (25 Sep 2026). Andy: "We did an balance reminder API
 *    endpoint and now we want to add similar functionality for sending the
 *    booking confirmation. We need an endpoint that Darren can post to and then
 *    we will send the email." POST /api/v1/booking-confirmations is that door:
 *    the Travelify core asks us directly, with the same X-Api-Key scheme as
 *    /api/v1/payment-reminders, instead of the per-client signed webhook. Its
 *    rows land in the same table with EventType api.confirmation and are sent
 *    by the same worker, through the same switches. Like the reminders, and
 *    UNLIKE the webhook, it has no duplicate suppression (Andy, 25 Sep 2026:
 *    "The email confirmation can get sent multiple times, but you have limited
 *    to only send once - this needs changing"): the caller decides, and every
 *    accepted request sends. Its rows carry the webhook's own key
 *    (applicationId|orderId|order.complete), stored rather than enforced, so
 *    the webhook still will not add an automatic confirmation for a booking
 *    the core has already confirmed.
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

/**
 * The EventType a direct request from the Travelify core is recorded under
 * (POST /api/v1/booking-confirmations). Ours, never a caller's value, so the
 * table says at a glance which door a confirmation came through.
 */
export const API_EVENT = 'api.confirmation';

export const SENDING_EVENTS = ['order.complete', API_EVENT];

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

/**
 * The X-Api-Key the direct confirmation request must carry. Its own key when
 * BOOKING_CONFIRMATION_API_KEY is set; otherwise the key the same caller
 * already holds for /api/v1/payment-reminders, so the Travelify core can start
 * with the secret it has. Takes the application id for the same reason the
 * reminder resolver does: per-application keys can arrive later without the
 * endpoint changing.
 */
export function resolveConfirmationApiKey(_applicationId) {
  return process.env.BOOKING_CONFIRMATION_API_KEY || process.env.PAYMENT_REMINDER_API_KEY || '';
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
 * Validate a direct request from the Travelify core. The same three order
 * fields, and the same rules, as /api/v1/payment-reminders: applicationId and
 * orderId as JSON numbers, orderKey as the order's GUID. Plus `email`, the
 * address to send to (Andy, 25 Sep 2026: "Darren will send you the email
 * address to send to - so you need to accommodate that in the API as well").
 * It is optional: without it the confirmation goes to the customer email on
 * the order, as it always has. Everything the email prints still comes from
 * the live order, and any other field is ignored.
 */
export function validateConfirmationRequest(body) {
  const errors = {};
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  if (typeof b.applicationId !== 'number' || !isPositiveInt(b.applicationId, 2147483647)) {
    errors.applicationId = 'applicationId must be a positive integer';
  }
  if (typeof b.orderId !== 'number' || !isPositiveInt(b.orderId, Number.MAX_SAFE_INTEGER)) {
    errors.orderId = 'orderId must be a positive integer';
  }
  if (typeof b.orderKey !== 'string' || !GUID_RE.test(b.orderKey.trim())) {
    errors.orderKey = 'orderKey must be a 36-character GUID';
  }
  let toEmail = '';
  if (b.email !== undefined && b.email !== null && b.email !== '') {
    toEmail = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!isRecipientEmail(toEmail)) errors.email = 'email must be a single valid email address';
  }
  if (Object.keys(errors).length) return { errors, value: null };
  return {
    errors,
    value: {
      eventType: API_EVENT,
      applicationId: b.applicationId,
      orderId: b.orderId,
      orderKey: b.orderKey.trim(),
      toEmail,
    },
  };
}

/** One plain address: no display name, no list, no spaces, a dotted domain. */
export function isRecipientEmail(v) {
  return typeof v === 'string' && v.length <= 254
    && /^[^@\s,;<>"]{1,64}@[^@\s,;<>"]+\.[^@\s,;<>".]{2,}$/.test(v);
}

/**
 * The key that stands for "this booking's confirmation", whichever door it came
 * through: the webhook's order.complete key. A direct request STORES it (for
 * audit, and so the webhook's duplicate check sees a booking the core has
 * already confirmed) and never checks it: the caller decides how often to send.
 */
export function confirmationKey(value) {
  return buildIdempotencyKey({ applicationId: value.applicationId, orderId: value.orderId, eventType: 'order.complete' });
}

/**
 * One webhook push, one confirmation: the platform retrying a push must not
 * email the customer twice, so for the webhook the natural key is enforced
 * rather than merely recorded. (The direct request stores it and sends every
 * time it is asked.)
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
 * Travelgenix's published demo application. Since 25 Sep 2026 it SENDS, as a
 * test application (the worker treats isDemoApp like isConfirmationTestApp:
 * it sends while the global switch is off, and the test redirect applies).
 * Before that it stopped at Fetched and never emailed anyone. ONE id, taken
 * from the platform's own constant rather than from the webhook
 * documentation: the sample payloads on that page use appid 100, but that is
 * an illustration, not a registration.
 */
export const DEMO_APP_IDS = [DEMO_APP_ID];
export function isDemoApp(applicationId) {
  return DEMO_APP_IDS.includes(String(applicationId));
}

// ── An App ID held by more than one client ──────────────────────────────────

const CLIENTS_TABLE = 'tblikekpaTKraMktZ';
const CLIENT_FIELDS = {
  appId:      'fldE9dL05t0x0S88w',   // Travelify App ID
  apiKey:     'fld9X1nvAgy0sHQ4B',
  clientName: 'fldx9CiWtSm5lX7MF',
};

/**
 * The client the confirmation should go out as, when the one the App ID
 * resolved to has no My Booking widget. lookupClientCredentialsByAppId takes
 * the FIRST Clients row with the App ID, and app 250 is held by two:
 * "Travelgenix", with no widget, and "Travel Demo Tes Ltd", with the
 * "My Booking test" widget. They share the application and its key, so the
 * other row is the same caller with somewhere to send from. Returns
 * { application, branding } for the first other row whose My Booking widget
 * has confirmations switched on (else the first with a widget), or null.
 * `resolveBranding` is passed in (it lives in payment-reminders.js).
 */
export async function resolveSiblingClient(application, resolveBranding) {
  const appId = String((application && application.appId) || '').trim();
  if (!/^\d{1,10}$/.test(appId)) return null;
  const formula = `{Travelify App ID}=${appId}`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}`
    + `?filterByFormula=${encodeURIComponent(formula)}&returnFieldsByFieldId=true&maxRecords=10`;
  const data = await airtableRequest(url, { headers: airtableHeaders() }, 'sibling-clients');
  let fallback = null;
  for (const rec of (data.records || [])) {
    if (!rec || rec.id === application.recordId) continue;
    const f = rec.fields || {};
    const apiKey = String(f[CLIENT_FIELDS.apiKey] || '').trim();
    if (!apiKey) continue;
    const sibling = {
      appId: String(f[CLIENT_FIELDS.appId] || appId).trim(),
      apiKey,
      clientName: String(f[CLIENT_FIELDS.clientName] || '').trim(),
      recordId: rec.id,
    };
    const branding = await resolveBranding(sibling);
    if (!branding || !branding.widgetId) continue;
    if (branding.confirmation && branding.confirmation.enabled) return { application: sibling, branding };
    if (!fallback) fallback = { application: sibling, branding };
  }
  return fallback;
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
  // The address the core asked us to send to (direct request only). Kept apart
  // from CustomerEmail, which is the order's own address and what the booking
  // is looked up by.
  if (value.toEmail) fields.ToEmail = value.toEmail;
  if (value.currency) fields.Currency = value.currency;
  if (value.amount != null) fields.Amount = value.amount;

  const data = await airtableRequest(
    tableUrl(),
    // typecast so an event option added upstream materialises on first use.
    // Safe: EventType is validated against WEBHOOK_EVENTS before it gets here,
    // or is our own API_EVENT for a direct request.
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
