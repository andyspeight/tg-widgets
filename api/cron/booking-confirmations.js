/**
 * Booking Confirmation background worker.
 *
 * Consumes the durable queue: Booking Confirmations rows with Status=Accepted
 * or Fetched, written by /api/v1/booking-webhook when the Travelgenix platform
 * pushes an order.complete, or by /api/v1/booking-confirmations when the
 * Travelify core asks for a confirmation directly (EventType api.confirmation,
 * 25 Sep 2026). Both kinds are handled identically from here on: same switches,
 * same send. For each row it resolves the client's Travelify
 * credentials from the applicationId, fetches the full order on the id + key
 * path, and asks /api/booking-email to send.
 *
 * WHY IT DELEGATES THE SEND. /api/booking-email already retrieves the order,
 * renders the client's layout, draws the A4 pack and hands both to SendGrid
 * with the right sender identity — that is the email a customer gets today
 * when they press Email on their booking. A confirmation we send on a webhook
 * must be the SAME email, so this worker composes nothing: it works out the
 * three details the endpoint needs and calls it. One send path, whoever asked
 * for it. (Andy also asked for the PDF to be attached, which that endpoint
 * already does.)
 *
 * The order fetch here is not wasted work: it is where the three details come
 * from, since the webhook carries an id and a key and no departure date.
 *
 * A row is SKIPPED (terminal, never emailed) when: the event is not one that
 * sends, the client has not switched confirmations on in their My Booking
 * editor, they have no My Booking widget, the push is older than twelve hours
 * (a queue drained late must not become a surprise email about a trip already
 * taken), the order carries no customer email, or the notification came from
 * a demo application. The reason lands in LastError prefixed "skipped:".
 *
 * NOTHING SENDS until BOOKING_CONFIRMATION_SEND_ENABLED=true in Vercel. Until
 * then a row reaches Fetched and stops, which is the state to watch while each
 * client is switched over from Travelify's own confirmation.
 *
 * Failure model, overlap and double-send protection are the payment reminder
 * pipeline's, deliberately: a per-record Redis lock, a one-shot send guard, and
 * a backoff that gives a row about seventeen hours before it goes Failed —
 * except that a confirmation that has aged past MAX_AGE_MS stops being worth
 * sending, so it is skipped rather than retried into irrelevance.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET}.
 */

import {
  resolveApplication,
  fetchOrderByIdKey,
  resolveClientBranding,
  timingSafeMatch,
  maskEmail,
  readOrderRef,
} from '../_lib/payment-reminders.js';
import {
  MAX_ATTEMPTS,
  MAX_AGE_MS,
  acquireProcessingLock,
  claimSendGuard,
  listPendingConfirmations,
  updateConfirmationRecord,
  eventSends,
  sendingEnabled,
  isConfirmationTestApp,
  confirmationTestRecipient,
  isDemoApp,
} from '../_lib/booking-confirmations.js';

const BATCH_SIZE = 25;

// Minutes to wait before retry N+1, indexed by attempts already made. Same
// spacing as the reminder worker: the 5-minute cron alone would burn through
// MAX_ATTEMPTS in under half an hour, which is shorter than a routine outage.
const RETRY_BACKOFF_MINUTES = [0, 5, 20, 60, 180];

const SELF_ORIGIN = process.env.TG_SELF_ORIGIN || 'https://tg-widgets.vercel.app';

function isBackingOff(fields) {
  const attempts = Number.isFinite(fields.Attempts) ? fields.Attempts : 0;
  if (attempts <= 0) return false;
  const last = Date.parse(fields.ProcessedAtUtc || '');
  if (!Number.isFinite(last)) return false;
  const waitMs = RETRY_BACKOFF_MINUTES[Math.min(attempts, RETRY_BACKOFF_MINUTES.length - 1)] * 60 * 1000;
  return Date.now() - last < waitMs;
}

/**
 * The departure date the booking lookup expects, as a calendar date.
 *
 * Travelify writes a start as "2026-09-26T00:00:00": a date wearing a time,
 * with no zone on it (CLAUDE.md, 15 Sep 2026). Taking the first ten characters
 * reads exactly the numbers it wrote. Parsing it into a Date first would read
 * it in the server's zone and hand back the day before for anyone behind UTC,
 * and the lookup would find nothing.
 */
export function departureDateOf(raw) {
  const candidates = [];
  if (typeof raw?.summary?.earliestStart === 'string') candidates.push(raw.summary.earliestStart);
  for (const item of (Array.isArray(raw?.items) ? raw.items : [])) {
    if (typeof item?.startDate === 'string') candidates.push(item.startDate);
  }
  const days = candidates
    .map((v) => String(v).slice(0, 10))
    .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
    .sort();
  return days[0] || null;
}

/** The reference the customer would type, from wherever the order carries it. */
export function bookingRefOf(raw) {
  const direct = readOrderRef(raw);
  if (direct) return direct;
  for (const item of (Array.isArray(raw?.items) ? raw.items : [])) {
    const r = item?.bookingReference;
    if (typeof r === 'string' && /^[A-Za-z0-9_-]{3,40}$/.test(r.trim())) return r.trim().toUpperCase();
  }
  return null;
}

async function processRecord(record) {
  const f = record.fields || {};
  const reference = f.Reference || record.id;
  const attempts = Number.isFinite(f.Attempts) ? f.Attempts : 0;

  if (isBackingOff(f)) return { outcome: 'waiting' };

  const lock = await acquireProcessingLock(reference);
  if (lock === 'exists') return { outcome: 'skipped' };
  // 'error' (Redis down) proceeds — the send guard and the Status machine
  // still protect the email step.

  const stamp = async (fields, outcome, error) => {
    try {
      await updateConfirmationRecord(record.id, { ...fields, ProcessedAtUtc: new Date().toISOString() });
    } catch (err) {
      console.error('[booking-confirmations:worker] stamp failed for', reference, '—', err.message);
      if (outcome === 'sent') {
        console.error('[booking-confirmations:worker] STATUS STAMP LOST for', reference,
          '— the send guard prevents a re-send, but this row will be re-picked');
      }
    }
    return { outcome, error };
  };

  const finishFailure = (message, extraFields = {}) => {
    const nextAttempts = attempts + 1;
    const fields = {
      ...extraFields,
      Attempts: nextAttempts,
      LastError: String(message || 'unknown error').slice(0, 1000),
    };
    if (nextAttempts >= MAX_ATTEMPTS) fields.Status = 'Failed';
    return stamp(fields, fields.Status === 'Failed' ? 'failed' : 'retry', message);
  };

  const suppress = (reason) => stamp(
    { Status: 'Skipped', Attempts: attempts + 1, LastError: `skipped: ${reason}` },
    'suppressed',
  );

  // ── Decisions that need nothing fetched ───────────────────────────────────
  if (!eventSends(f.EventType)) {
    return suppress(`${f.EventType} does not send a confirmation`);
  }
  const receivedAt = Date.parse(f.ReceivedAtUtc || '');
  if (Number.isFinite(receivedAt) && Date.now() - receivedAt > MAX_AGE_MS) {
    return suppress('notification is too old to confirm');
  }
  // ── 1. applicationId → the client's Travelify credentials ────────────────
  let application;
  try { application = await resolveApplication(f.ApplicationId); }
  catch (err) { return finishFailure(err.message); }
  if (!application) return finishFailure(`no client found for applicationId ${f.ApplicationId}`);

  // ── 2. The order, on the id + key path ────────────────────────────────────
  const result = await fetchOrderByIdKey(application, f.OrderId, String(f.OrderKey || ''));
  if (!result.ok) return finishFailure(result.error);
  const raw = result.order;

  const customerEmail = String(raw.customerEmail || '').trim().toLowerCase();
  if (!customerEmail) return suppress('order has no customer email');
  const departDate = departureDateOf(raw);
  if (!departDate) return suppress('order has no departure date to look it up by');
  const orderRef = bookingRefOf(raw);
  if (!orderRef) return suppress('order carries no booking reference');

  // ── 3. Has this client asked for confirmations? ───────────────────────────
  const branding = await resolveClientBranding(application);
  if (!branding.widgetId) {
    return suppress('client has no My Booking widget to send the confirmation from');
  }
  if (!branding.confirmation || !branding.confirmation.enabled) {
    return suppress('confirmation emails are not switched on for this client');
  }

  // ── 4. The demo application, and the global switch ───────────────────────
  // The demo app check sits HERE rather than at the top (17 Sep 2026). Its job
  // is "never email a real person from the demo application", which is a
  // decision about SENDING. Making it the first thing that happens meant a demo
  // push was marked Skipped before the order was ever fetched, so wiring the
  // demo application up taught you nothing — and the demo application is the
  // obvious place to make test bookings without touching a real client's
  // account. Everything above this line is exactly what a test needs to
  // exercise: the signature, the client lookup, and the order fetch on the
  // id + key path that no live call has ever confirmed.
  if (isDemoApp(f.ApplicationId)) {
    return stamp(
      { Status: 'Fetched', Attempts: 0, LastError: `demo application ${f.ApplicationId}: fetched, never emailed`, CustomerEmail: customerEmail },
      'fetched',
    );
  }

  const isTestApp = isConfirmationTestApp(f.ApplicationId);
  if (!sendingEnabled() && !isTestApp) {
    return stamp(
      { Status: 'Fetched', Attempts: 0, LastError: '', CustomerEmail: customerEmail },
      'fetched',
    );
  }

  const redirect = confirmationTestRecipient();
  const recipient = (isTestApp && redirect) ? redirect : customerEmail;

  const guard = await claimSendGuard(reference);
  if (guard === 'exists') {
    // A previous run sent this but crashed before stamping.
    return stamp({ Status: 'Sent', SentTo: recipient, Attempts: attempts, LastError: 'send previously recorded (guard hit)' }, 'sent');
  }
  if (isTestApp) {
    console.log('[booking-confirmations:worker] TEST-MODE send for app', f.ApplicationId,
      'ref', reference, '→', maskEmail(recipient));
  }

  // ── 5. The send, through the endpoint that already owns this email ────────
  let sent;
  try {
    sent = await sendConfirmation({
      widgetId: branding.widgetId,
      emailAddress: customerEmail,
      departDate,
      orderRef,
      toEmail: recipient,
      applicationId: f.ApplicationId,
    });
  } catch (err) {
    return finishFailure(`send request failed: ${err.message}`, { Status: 'Fetched', CustomerEmail: customerEmail });
  }
  if (!sent.ok) {
    return finishFailure(`email send failed: ${sent.error}`, { Status: 'Fetched', CustomerEmail: customerEmail });
  }

  console.log('[booking-confirmations:worker] confirmation emailed for', reference, 'to', maskEmail(recipient));
  return stamp({
    Status: 'Sent',
    SentTo: recipient,
    CustomerEmail: customerEmail,
    MessageId: String(sent.messageId || '').slice(0, 200),
    Attempts: attempts,
    LastError: '',
  }, 'sent');
}

/**
 * Ask /api/booking-email to send. The internal key lets it rate-limit against
 * the client's application rather than our own egress address, which every
 * confirmation would otherwise share.
 */
async function sendConfirmation({ widgetId, emailAddress, departDate, orderRef, toEmail, applicationId }) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.TG_INTERNAL_KEY) {
    headers['X-TG-Internal-Key'] = process.env.TG_INTERNAL_KEY;
    headers['X-TG-Real-IP'] = `bookconf:${applicationId}`;
  }
  const res = await fetch(`${SELF_ORIGIN}/api/booking-email`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ widgetId, emailAddress, departDate, orderRef, toEmail, message: '' }),
    signal: AbortSignal.timeout(45000),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* handled below */ }
  if (!res.ok || !payload || payload.ok !== true) {
    return { ok: false, error: `HTTP ${res.status} ${(payload && payload.error) || 'no body'}` };
  }
  return { ok: true, messageId: payload.messageId };
}

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || !timingSafeMatch(auth, `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorised' });
  }

  let records;
  try { records = await listPendingConfirmations(BATCH_SIZE); }
  catch (err) {
    console.error('[booking-confirmations:worker] queue list failed:', err.message);
    return res.status(500).json({ ok: false, error: 'queue_list_failed' });
  }

  const summary = { picked: records.length, fetched: 0, sent: 0, suppressed: 0, retry: 0, failed: 0, skipped: 0, waiting: 0 };
  for (const record of records) {
    try {
      const { outcome } = await processRecord(record);
      summary[outcome] = (summary[outcome] || 0) + 1;
    } catch (err) {
      // processRecord handles its own failures; this is a belt-and-braces guard
      // so one pathological row cannot kill the sweep.
      console.error('[booking-confirmations:worker] unexpected error on', record.id, '—', err.message);
      summary.retry += 1;
    }
  }

  if (summary.picked > 0) {
    console.log('[booking-confirmations:worker] sweep done', JSON.stringify(summary));
  }
  return res.status(200).json({ ok: true, ...summary });
}
