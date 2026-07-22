/**
 * Payment Reminder pipeline — shared library (phase 1).
 *
 * The Travelify core platform pushes "this order has a balance due"
 * notifications to POST /api/v1/payment-reminders (roughly daily, ~9am).
 * The endpoint validates, records, queues and answers 202 fast; a cron
 * worker (api/cron/payment-reminders.js) does the real work off the
 * request path. Phase 1 ends at fetching the full order from Travelify
 * and marking the record Fetched. Phase 2 (reminder email + payment link
 * via /addgenericitem, the same basket flow api/pay-balance.js uses)
 * extends the worker without touching the endpoint contract.
 *
 * Architecture choices, and why:
 *  - DURABLE QUEUE = the Airtable record. Every accepted notification is a
 *    row in Payment Reminders (base appAYzWZxvK6qlwXK) with Status=Accepted;
 *    the cron sweeps Accepted rows every few minutes. A process restart
 *    loses nothing because the queue never lived in memory. The endpoint
 *    also fires a best-effort immediate "kick" at the worker so items are
 *    normally processed within seconds; the cron is the guarantee, the kick
 *    is the latency optimisation. Swapping in a push queue later (QStash
 *    etc.) only means changing the kick — the contract stays.
 *  - IDEMPOTENCY = an atomic Redis SET NX EX claim on the natural key
 *    applicationId|orderKey|reminderType|UTC-receipt-date, holding the
 *    original reference as its value so a duplicate can return it. Keying
 *    on the RECEIPT DAY means: same-day retries after a network blip are
 *    deduplicated; tomorrow's daily run is a fresh notification. (Open
 *    question flagged to the core team: whether they'd rather key on
 *    dueDate — one reminder per balance, ever — which changes what a
 *    legitimate repeat looks like.) A caller-supplied Idempotency-Key
 *    header is honoured in preference when present. Storage backs Redis up:
 *    the endpoint checks Airtable for the key before every create — not
 *    only when Redis is down — because a record accepted DURING an outage
 *    has no claim, so after recovery a same-day retry looks new to Redis.
 *    Only a concurrent duplicate during an outage remains racy, and the
 *    core's daily cadence makes that vanishingly rare.
 *  - CALLER REGISTRY = the Clients table. applicationId resolves through
 *    lookupClientCredentialsByAppId (the same TravelifyAppId field the rest
 *    of the platform uses), so an unknown applicationId is rejected at the
 *    door with no separate allow-list to maintain. Travelify's published
 *    demo app (250) is honoured so their integration tests work.
 *  - AUTH = X-Api-Key shared secret, compared timing-safe. Single key today
 *    (env PAYMENT_REMINDER_API_KEY); resolveExpectedApiKey() takes the
 *    applicationId so per-application keys can arrive later without
 *    reshaping the endpoint.
 *
 * Duplicate behaviour (documented for the core team): a duplicate returns
 * 409 Conflict with { status: 'duplicate', reference: <original> }.
 */

import crypto from 'node:crypto';
import { sanitiseForFormula, lookupClientCredentialsByAppId } from '../_auth.js';
import { claimNxEx, getString, del } from '../_redis.js';
import { TRAVELIFY_ORIGIN, DEMO_APP_ID, DEMO_PUBLIC_KEY } from './travelify.js';

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
export const REMINDERS_TABLE = 'tblHwa7PI2BSGjXZV';

// Single source of truth for the reminder types the contract accepts. Extend
// here AND in the Airtable ReminderType select together.
export const REMINDER_TYPES = ['DepositBalance', 'FinalBalance'];

export const MAX_ATTEMPTS = 5;

const IDEM_TTL_SECONDS = 48 * 60 * 60; // covers same-day retries; the key embeds the date so days never collide
const IDEM_PREFIX = 'payrem:idem:';
const LOCK_PREFIX = 'payrem:lock:';

// ── Auth ─────────────────────────────────────────────────────────────────────

/**
 * The key the caller must present. Takes the applicationId so this can grow
 * into a per-application key registry without the endpoint changing; today
 * every application shares the single platform key.
 */
export function resolveExpectedApiKey(_applicationId) {
  return process.env.PAYMENT_REMINDER_API_KEY || '';
}

/** Constant-time string compare (length still leaks; contents never do). */
export function timingSafeMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Validation ───────────────────────────────────────────────────────────────

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPositiveInt(v, max) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= max;
}

/**
 * Validate the notification payload. Returns { errors, value } — errors is a
 * field→message map (empty when valid), value the normalised payload.
 */
export function validateReminderPayload(body) {
  const errors = {};
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};

  if (!isPositiveInt(b.applicationId, 2147483647)) {
    errors.applicationId = 'applicationId must be a positive integer';
  }
  if (!isPositiveInt(b.orderId, Number.MAX_SAFE_INTEGER)) {
    errors.orderId = 'orderId must be a positive integer';
  }
  if (typeof b.orderKey !== 'string' || !GUID_RE.test(b.orderKey.trim())) {
    errors.orderKey = 'orderKey must be a 36-character GUID';
  }
  if (typeof b.reminderType !== 'string' || !REMINDER_TYPES.includes(b.reminderType)) {
    errors.reminderType = `reminderType must be one of: ${REMINDER_TYPES.join(', ')}`;
  }
  const amount = typeof b.amountDue === 'number' ? b.amountDue : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
    errors.amountDue = 'amountDue must be a positive number';
  }
  if (typeof b.currency !== 'string' || !CURRENCY_RE.test(b.currency.trim())) {
    errors.currency = 'currency must be a three-letter ISO 4217 code';
  }
  let dueDate = null;
  if (b.dueDate !== undefined && b.dueDate !== null && b.dueDate !== '') {
    const s = typeof b.dueDate === 'string' ? b.dueDate.trim() : '';
    const parsed = DATE_RE.test(s) ? new Date(s + 'T00:00:00Z') : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      errors.dueDate = 'dueDate must be a valid ISO 8601 date (YYYY-MM-DD)';
    } else {
      dueDate = s;
    }
  }

  if (Object.keys(errors).length) return { errors, value: null };
  return {
    errors,
    value: {
      applicationId: b.applicationId,
      orderId: b.orderId,
      orderKey: b.orderKey.trim().toLowerCase(),
      reminderType: b.reminderType,
      amountDue: Math.round(amount * 100) / 100,
      currency: b.currency.trim().toUpperCase(),
      dueDate,
    },
  };
}

/** Optional caller-supplied Idempotency-Key header: printable, bounded. */
export function validateCallerIdempotencyKey(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 128 || !/^[\x21-\x7E]+$/.test(s)) return null;
  return s;
}

// ── Caller registry (applicationId → owning client) ──────────────────────────

/**
 * Resolve the applicationId against the Clients table (the caller registry).
 * Returns { appId, apiKey, clientName } or null when the id is unknown.
 * Travelify's published demo app (250) resolves even without a Clients
 * record so their integration tests work out of the box.
 * Throws on Airtable failure — the caller maps that to a retryable 500
 * rather than wrongly rejecting a valid notification as unknown.
 */
export async function resolveApplication(applicationId) {
  let creds = null;
  try {
    creds = await lookupClientCredentialsByAppId(applicationId);
  } catch (err) {
    const e = new Error(`application lookup failed: ${err.message}`);
    e.stage = 'registry';
    throw e;
  }
  if (creds) return creds;
  if (String(applicationId) === DEMO_APP_ID) {
    return { appId: DEMO_APP_ID, apiKey: DEMO_PUBLIC_KEY, clientName: 'Travelgenix demo', recordId: null };
  }
  return null;
}

// ── Idempotency ──────────────────────────────────────────────────────────────

/**
 * Natural key: application + order + reminder type + the UTC calendar day we
 * received it. Same-day retries collapse; tomorrow's daily run is new.
 * A caller-supplied Idempotency-Key header takes precedence when present.
 */
export function buildIdempotencyKey(value, receivedAt, callerKey) {
  if (callerKey) return `hdr:${callerKey}`;
  const day = receivedAt.toISOString().slice(0, 10);
  return `${value.applicationId}|${value.orderKey}|${value.reminderType}|${day}`;
}

/**
 * Atomically claim the idempotency key, storing our reference as the value.
 * Returns one of:
 *   { state: 'new' }                          — claimed, proceed to record
 *   { state: 'duplicate', reference|null }    — already claimed; original ref if readable
 *   { state: 'unavailable' }                  — Redis can't answer; caller falls back
 */
export async function claimIdempotency(idemKey, reference) {
  const key = IDEM_PREFIX + idemKey;
  const outcome = await claimNxEx(key, reference, IDEM_TTL_SECONDS);
  if (outcome === 'set') return { state: 'new' };
  if (outcome === 'exists') {
    let original = null;
    try { original = await getString(key); } catch { /* reference stays null */ }
    return { state: 'duplicate', reference: typeof original === 'string' && original ? original : null };
  }
  return { state: 'unavailable' };
}

/** Best-effort release after a failed record write, so the core's retry isn't 409'd. */
export async function releaseIdempotencyClaim(idemKey) {
  try { await del(IDEM_PREFIX + idemKey); } catch { /* claim expires via TTL anyway */ }
}

/**
 * Per-record processing lock so the immediate kick and the cron sweep don't
 * process the same row twice. Best-effort: 'error' (Redis down) lets the
 * caller proceed — phase 1 processing is read-only against Travelify, so a
 * rare overlap is harmless. Revisit before phase 2 sends email.
 */
export async function acquireProcessingLock(reference) {
  return await claimNxEx(LOCK_PREFIX + reference, '1', 180);
}

// ── Airtable store ───────────────────────────────────────────────────────────

function airtableHeaders() {
  const key = process.env.AIRTABLE_KEY;
  if (!key) throw new Error('AIRTABLE_KEY env var missing');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

const tableUrl = () => `https://api.airtable.com/v0/${AIRTABLE_BASE}/${REMINDERS_TABLE}`;

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

/** Create the accepted-notification record (Status=Accepted = queued). */
export async function createReminderRecord({ reference, value, idemKey, receivedAt, clientName }) {
  const fields = {
    Reference: reference,
    ApplicationId: value.applicationId,
    OrderId: value.orderId,
    OrderKey: value.orderKey,
    ReminderType: value.reminderType,
    AmountDue: value.amountDue,
    Currency: value.currency,
    Status: 'Accepted',
    IdempotencyKey: idemKey,
    ReceivedAtUtc: receivedAt.toISOString(),
    Attempts: 0,
    ClientName: clientName || '',
  };
  if (value.dueDate) fields.DueDate = value.dueDate;
  const data = await airtableRequest(
    tableUrl(),
    { method: 'POST', headers: airtableHeaders(), body: JSON.stringify({ records: [{ fields }] }) },
    'record',
  );
  return data.records?.[0]?.id || null;
}

/** Storage-side duplicate check (backs the Redis claim up on every accept). */
export async function findReminderByIdempotencyKey(idemKey) {
  const formula = `{IdempotencyKey}='${sanitiseForFormula(idemKey)}'`;
  const url = `${tableUrl()}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const data = await airtableRequest(url, { headers: airtableHeaders() }, 'dedupe-lookup');
  return data.records?.[0] || null;
}

/**
 * Oldest-first batch of queued rows for the worker. Accepted = not yet
 * fetched; Fetched = order fetched but the email not yet sent (either
 * sending is disabled, or a send failed and awaits its backoff retry).
 * Sent / Skipped / Failed are terminal and never picked up again.
 */
export async function listPendingReminders(limit = 25) {
  const formula = `OR({Status}='Accepted',{Status}='Fetched')`;
  const url = `${tableUrl()}?filterByFormula=${encodeURIComponent(formula)}`
    + `&maxRecords=${limit}`
    + `&sort%5B0%5D%5Bfield%5D=ReceivedAtUtc&sort%5B0%5D%5Bdirection%5D=asc`;
  const data = await airtableRequest(url, { headers: airtableHeaders() }, 'queue-list');
  return data.records || [];
}

export async function updateReminderRecord(recordId, fields) {
  await airtableRequest(
    `${tableUrl()}/${recordId}`,
    // typecast lets controlled new select options (Skipped) materialise on
    // first use — every value written here is produced by this pipeline,
    // never by a caller, so typecast cannot smuggle anything in.
    { method: 'PATCH', headers: airtableHeaders(), body: JSON.stringify({ fields, typecast: true }) },
    'record-update',
  );
}

// ── Travelify Order API (fetch by id + key) ──────────────────────────────────

// The reminder push carries orderId + orderKey, so the worker fetches the
// order on the id+key path, mirroring the amend/cancel contracts
// (https://api.travelify.io/amend/{orderId}/{orderKey}). NOTE: this exact
// route is the one piece of the Travelify contract not yet confirmed against
// a live call — it is isolated here so confirming with the Travelify team is
// at most a one-line change.
const ORDER_BY_ID_API = 'https://api.travelify.io/account/order';

export async function fetchOrderByIdKey({ appId, apiKey }, orderId, orderKey) {
  const url = `${ORDER_BY_ID_API}/${encodeURIComponent(String(orderId))}/${encodeURIComponent(orderKey)}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Token ${appId}:${apiKey}`,
        // Mandatory on server-to-server Travelify calls — without it the API
        // returns a false 401. Do not remove.
        Origin: TRAVELIFY_ORIGIN,
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    return { ok: false, error: `order fetch network error: ${err.message}` };
  }
  if (res.status === 404) return { ok: false, error: 'order not found (404)' };
  if (!res.ok) return { ok: false, error: `order fetch HTTP ${res.status}` };

  let raw;
  try { raw = await res.json(); } catch { return { ok: false, error: 'order fetch returned non-JSON' }; }
  if (raw && (raw.code === '404' || raw.code === 404)) return { ok: false, error: 'order not found (body 404)' };
  if (!raw || typeof raw !== 'object' || raw.id == null) return { ok: false, error: 'order fetch returned no order' };
  if (String(raw.id) !== String(orderId)) return { ok: false, error: `order mismatch: asked ${orderId}, got ${raw.id}` };
  return { ok: true, order: raw };
}

// ── Phase 2: email sending support ───────────────────────────────────────────

/**
 * Master switch for the reminder email. OFF by default so Travelify's
 * integration tests (and any half-configured client) can never email a real
 * customer by accident; while off, the worker stops at Fetched exactly as
 * phase 1 shipped. Andy flips PAYMENT_REMINDER_SEND_ENABLED=true in Vercel
 * when the mock is approved and the contract is confirmed.
 */
export function sendingEnabled() {
  return String(process.env.PAYMENT_REMINDER_SEND_ENABLED || '').toLowerCase() === 'true';
}

/**
 * Notifications older than this are Skipped, never emailed. Guards the
 * moment sending is first enabled: stale Fetched rows from testing must not
 * turn into surprise emails to real customers weeks later.
 */
export const MAX_EMAIL_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * One-shot send guard: claimed immediately before handing the email to
 * SendGrid, so a crash between the send and the Sent stamp cannot resend on
 * the next sweep. 'exists' means a send was already recorded for this
 * reference; 'error' (Redis down) proceeds — the Status machine still
 * prevents re-sends in every non-crash path.
 */
export async function claimSendGuard(reference) {
  return await claimNxEx(`payrem:sent:${reference}`, '1', 7 * 24 * 60 * 60);
}

/** The customer-facing booking reference, when the raw order carries one. */
export function readOrderRef(raw) {
  const candidates = [raw?.reference, raw?.orderRef, raw?.bookingRef, raw?.ref];
  for (const c of candidates) {
    if (typeof c === 'string' && /^[A-Za-z0-9_\-]{3,40}$/.test(c.trim())) return c.trim().toUpperCase();
  }
  return null;
}

/** Compose the booking-page deep link the email button points at. */
export function buildPayUrl(pageUrl, orderRef) {
  if (typeof pageUrl !== 'string') return null;
  const base = pageUrl.trim().replace(/#.*$/, '');
  if (!/^https:\/\/[^\s]+$/i.test(base) || base.length > 300) return null;
  return orderRef ? `${base}#tg-pay=${encodeURIComponent(orderRef)}` : `${base}#tg-pay`;
}

const WIDGETS_TABLE = 'tblVAThVqAjqtria2';

// Clients-table branding field IDs (returnFieldsByFieldId reads only —
// formulas never use these). Mirrors api/internal/retrieve-order-by-client.js.
const CLIENT_BRAND_FIELDS = {
  appName:     'fld0H6vOJOYqiODF5',
  clientName:  'fldx9CiWtSm5lX7MF',
  tradingName: 'fldDbFv039Bip6W8u',
  email:       'fldVRiIAlrTjxnNHP',
  logoUrl:     'fldGAJdxjdzz2X0sp',
  phone:       'fldFES7Aa057MB3VT',
};

const httpsOnly = (v) => (typeof v === 'string' && /^https:\/\//i.test(v.trim()) ? v.trim() : '');

/**
 * Resolve how the reminder email presents itself: the agency's name, logo,
 * reply-to, support contacts, legal footer and booking-page URL.
 *
 * Primary source: the client's My Booking widget record (same branding the
 * booking confirmation emails use — FromName / FromEmail / LogoUrl /
 * EmailFooter fields plus support contacts and pageUrl from its Config).
 * Fallback when the client has no My Booking widget: the Clients record's
 * own branding fields — the email then has no booking-page button and leans
 * on the contact details instead.
 */
export async function resolveReminderBranding(application) {
  const brand = {
    name: (application && application.clientName) || 'Your travel team',
    logoUrl: '', footerLine: '', replyTo: '',
    supportEmail: '', supportPhone: '', pageUrl: '',
  };

  const recordId = application && application.recordId;
  if (!recordId || !/^rec[A-Za-z0-9]{14}$/.test(recordId)) return brand;

  // 1. The client's My Booking widget (field NAMES in the formula — ids
  //    inside braces match nothing).
  try {
    const formula = `AND({WidgetType}='My Booking',{ClientRecordId}='${sanitiseForFormula(recordId)}')`;
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${WIDGETS_TABLE}`
      + `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=5`;
    const data = await airtableRequest(url, { headers: airtableHeaders() }, 'branding-widget');
    const records = data.records || [];
    const widget = records.find(r => r.fields?.Status === 'Active') || records[0];
    if (widget) {
      const f = widget.fields || {};
      let cfg = {};
      const rawCfg = f.Config || f.Settings;
      if (rawCfg) {
        if (typeof rawCfg === 'object') cfg = rawCfg;
        else { try { cfg = JSON.parse(rawCfg); } catch { cfg = {}; } }
      }
      brand.name = String(f.FromName || cfg?.brand?.name || f.ClientName || brand.name).trim() || brand.name;
      brand.logoUrl = httpsOnly(f.LogoUrl);
      brand.footerLine = String(f.EmailFooter || '').trim();
      brand.replyTo = String(f.FromEmail || f.ClientEmail || '').trim().toLowerCase();
      brand.supportEmail = String(cfg?.support?.email || '').trim() || brand.replyTo;
      brand.supportPhone = String(cfg?.support?.phone || '').trim();
      brand.pageUrl = httpsOnly(cfg?.pageUrl);
      return brand;
    }
  } catch (err) {
    console.warn('[payment-reminders] widget branding lookup failed:', err.message);
  }

  // 2. Clients record fallback — contact-first email, no booking-page button.
  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/tblikekpaTKraMktZ/${recordId}?returnFieldsByFieldId=true`;
    const rec = await airtableRequest(url, { headers: airtableHeaders() }, 'branding-client');
    const f = rec.fields || {};
    const str = (id) => String(f[id] == null ? '' : f[id]).trim();
    brand.name = str(CLIENT_BRAND_FIELDS.tradingName) || str(CLIENT_BRAND_FIELDS.appName) || str(CLIENT_BRAND_FIELDS.clientName) || brand.name;
    brand.logoUrl = httpsOnly(str(CLIENT_BRAND_FIELDS.logoUrl));
    brand.replyTo = str(CLIENT_BRAND_FIELDS.email).toLowerCase();
    brand.supportEmail = brand.replyTo;
    brand.supportPhone = str(CLIENT_BRAND_FIELDS.phone);
  } catch (err) {
    console.warn('[payment-reminders] client branding fallback failed:', err.message);
  }
  return brand;
}

// ── Logging helpers ──────────────────────────────────────────────────────────

/** g***@example.com — enough to correlate, no full address in the logs. */
export function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Compact, PII-light summary of a fetched order for the phase-1 log. */
export function summariseOrder(raw) {
  return {
    id: raw.id,
    status: typeof raw.status === 'string' ? raw.status.slice(0, 30) : null,
    currency: typeof raw.currency === 'string' ? raw.currency.slice(0, 10) : null,
    items: Array.isArray(raw.items) ? raw.items.length : 0,
    customerEmail: maskEmail(raw.customerEmail),
    hasContact: !!(raw.customerEmail || raw.customerTelNum),
  };
}
