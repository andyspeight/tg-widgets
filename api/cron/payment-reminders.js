/**
 * Payment Reminder background worker (phases 1 + 2).
 *
 * Consumes the durable queue: Payment Reminders rows with Status=Accepted
 * or Fetched (written by /api/v1/payment-reminders). For each row it
 * resolves the client's Travelify credentials from the applicationId,
 * fetches the full order (id + key), then:
 *
 *   - sending DISABLED (default): marks the row Fetched and stops — exactly
 *     the phase 1 contract. Nothing emails anyone until Andy flips
 *     PAYMENT_REMINDER_SEND_ENABLED=true in Vercel.
 *   - sending ENABLED: computes the real outstanding balance with
 *     decideCharge (the same engine the My Booking widget and
 *     /api/pay-balance use), renders the agency-branded reminder email and
 *     sends it to the order's customer, marking the row Sent — then keeps
 *     chasing on the client's schedule (config.reminders in their My
 *     Booking editor: how many emails, how many days apart; default 3
 *     emails 7 days apart). Each follow-up re-fetches the order first, so
 *     the moment the customer pays the chase closes itself ("balance
 *     settled after N reminder emails") and nobody is chased for money
 *     they no longer owe. The last email in the plan is written and
 *     subject-lined as a final reminder.
 *
 * A row is SKIPPED (never emailed, terminal) when: the order has no
 * outstanding balance (already paid — never chase a settled booking), the
 * notification came from the Travelify demo app 250, the notification is
 * older than 48 hours (stale test rows must not become surprise emails when
 * the flag first flips), or the order carries no customer email. The reason
 * lands in LastError prefixed "skipped:".
 *
 * Triggered by the 5-minute Vercel cron plus a best-effort kick from the
 * intake endpoint. Overlap is defused by a per-record Redis lock, and the
 * send itself is additionally protected by a one-shot Redis send guard so a
 * crash between SendGrid accepting and the Sent stamp cannot double-email.
 *
 * Failure model: each failure stamps LastError and bumps Attempts; the row
 * stays queued (Accepted, or Fetched once the order fetch has succeeded)
 * and retries on a backoff schedule until MAX_ATTEMPTS flips it to Failed.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET} (same convention as the other
 * crons; Vercel cron sends it automatically when the env var is set).
 */

import {
  MAX_ATTEMPTS,
  MAX_EMAIL_AGE_MS,
  resolveApplication,
  listPendingReminders,
  updateReminderRecord,
  acquireProcessingLock,
  fetchOrderByIdKey,
  summariseOrder,
  timingSafeMatch,
  sendingEnabled,
  claimSendGuard,
  readOrderRef,
  buildPayUrl,
  resolveReminderBranding,
  maskEmail,
} from '../_lib/payment-reminders.js';
import { renderReminderEmail } from '../_lib/payment-reminder-email.js';
import { decideCharge, instalmentPosition } from '../pay-balance.js';
import { sendViaSendGrid, buildFromField, isValidEmail } from '../_lib/sendgrid.js';
import { DEMO_APP_ID } from '../_lib/travelify.js';

const BATCH_SIZE = 25;

// Minutes to wait before retry N+1, indexed by attempts already made. The
// 5-minute cron alone would exhaust MAX_ATTEMPTS in ~25 minutes — shorter
// than a routine outage. Spaced like this the cap covers roughly 17 hours
// (0m, 15m, 1h, 4h, 12h) before a row goes Failed.
const RETRY_BACKOFF_MINUTES = [0, 15, 60, 240, 720];

function isBackingOff(fields) {
  const attempts = Number.isFinite(fields.Attempts) ? fields.Attempts : 0;
  if (attempts <= 0) return false;
  const last = Date.parse(fields.ProcessedAtUtc || '');
  if (!Number.isFinite(last)) return false;
  const waitMs = RETRY_BACKOFF_MINUTES[Math.min(attempts, RETRY_BACKOFF_MINUTES.length - 1)] * 60 * 1000;
  return Date.now() - last < waitMs;
}

async function processRecord(record) {
  const f = record.fields || {};
  const reference = f.Reference || record.id;
  const attempts = Number.isFinite(f.Attempts) ? f.Attempts : 0;

  if (isBackingOff(f)) return { outcome: 'waiting' };

  const lock = await acquireProcessingLock(reference);
  if (lock === 'exists') return { outcome: 'skipped' };
  // 'error' (Redis down) proceeds — the send guard and Status machine still
  // protect the email step; the fetch step is read-only.

  const stamp = async (fields, outcome, error) => {
    try {
      await updateReminderRecord(record.id, { ...fields, ProcessedAtUtc: new Date().toISOString() });
    } catch (err) {
      console.error('[payment-reminders:worker] stamp failed for', reference, '—', err.message);
      if (outcome === 'sent' || outcome === 'suppressed') {
        // The action happened but the stamp didn't. The send guard prevents
        // a re-send; surface loudly so the row isn't silently re-picked.
        console.error('[payment-reminders:worker] STATUS STAMP LOST for', reference, '— intended', fields.Status);
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

  // 1. applicationId → the client's Travelify credentials.
  let application;
  try {
    application = await resolveApplication(f.ApplicationId);
  } catch (err) {
    return finishFailure(err.message);
  }
  if (!application) {
    return finishFailure(`no client found for applicationId ${f.ApplicationId}`);
  }

  // 2. Fetch the full order from Travelify by id + key. Always fresh — the
  //    amounts must reflect any payment taken since the notification.
  const result = await fetchOrderByIdKey(application, f.OrderId, String(f.OrderKey || ''));
  if (!result.ok) {
    return finishFailure(result.error);
  }
  const order = result.order;
  console.log('[payment-reminders:worker] fetched order for', reference, JSON.stringify(summariseOrder(order)));

  const emailsSent = Number.isFinite(f.EmailsSent) ? f.EmailsSent : 0;
  const isFollowUp = emailsSent > 0;

  // 3. Sending disabled → phase 1 resting state. An already-Sent row mid
  //    chase is left completely untouched (disabling the flag PAUSES
  //    follow-ups, it never rewrites their state).
  if (!sendingEnabled()) {
    if (f.Status === 'Sent') return { outcome: 'waiting' };
    return stamp({ Status: 'Fetched', Attempts: attempts + 1, LastError: '' }, 'fetched');
  }

  // 4. Email eligibility gates (each terminal, each auditable in Airtable).
  if (String(f.ApplicationId) === DEMO_APP_ID) {
    return suppress('demo application — email suppressed');
  }
  if (!isFollowUp) {
    // First email only: never turn a stale notification into a surprise.
    // Follow-ups are older than 48h by design — their trigger is the
    // schedule, and the fresh balance check below is their safety.
    const receivedAt = Date.parse(f.ReceivedAtUtc || '');
    if (Number.isFinite(receivedAt) && Date.now() - receivedAt > MAX_EMAIL_AGE_MS) {
      return suppress('notification older than 48h — not emailing a stale reminder');
    }
  }
  const charge = decideCharge(order, null);
  if (charge.invalid || charge.noBalance || !(charge.amount > 0)) {
    if (isFollowUp) {
      // The customer paid — the chase worked. Close the schedule quietly.
      return stamp({
        NextEmailAtUtc: null,
        LastError: `balance settled after ${emailsSent} reminder email${emailsSent === 1 ? '' : 's'}`,
      }, 'settled');
    }
    return suppress('no outstanding balance on the order');
  }
  const customerEmail = String(order.customerEmail || '').trim().toLowerCase();
  if (!isValidEmail(customerEmail)) {
    return suppress('order has no valid customer email');
  }

  // 5. Render with the agency's branding and send AS the agency. The
  //    schedule snapshot taken at first send governs follow-ups; the
  //    client's current editor settings seed each new balance's cycle.
  const branding = await resolveReminderBranding(application);
  const planned = (isFollowUp && Number.isFinite(f.EmailsPlanned) && f.EmailsPlanned > 0)
    ? f.EmailsPlanned : branding.schedule.count;
  const gapDays = (isFollowUp && Number.isFinite(f.GapDays) && f.GapDays > 0)
    ? f.GapDays : branding.schedule.gapDays;
  const cycle = emailsSent + 1;
  const orderRef = readOrderRef(order);
  // The client's own copy for this stage, when they've written it: FinalBalance
  // uses the 'final' template, every other balance (deposit / each instalment)
  // uses 'interim'. Absent → the built-in template renders instead.
  const stage = f.ReminderType === 'FinalBalance' ? 'final' : 'interim';
  const template = (branding.reminderEmails && branding.reminderEmails[stage]) || null;
  const dueDateIso = f.DueDate || charge.dueDate || '';
  // Position within a multi-stage balance schedule, for the {instalmentNumber} /
  // {instalmentTotal} tags. null for a plain single balance — the tags then stay
  // unfilled, matching a client who never used them.
  const instalment = instalmentPosition(order, dueDateIso) || undefined;
  const { subject, html } = renderReminderEmail({
    agency: branding,
    customerFirstName: typeof order.customerFirstname === 'string' ? order.customerFirstname : '',
    orderRef,
    charge,
    dueDateIso,
    payUrl: buildPayUrl(branding.pageUrl, orderRef),
    sequence: { n: cycle, of: Math.max(planned, cycle) },
    template,
    instalment,
  });

  // Everything a successful (or guard-recovered) send stamps: the count,
  // the schedule snapshot, the next due date (or nothing when the cycle is
  // complete) and a fresh failure budget for the next cycle.
  const sentFields = {
    Status: 'Sent',
    EmailsSent: cycle,
    EmailsPlanned: planned,
    GapDays: gapDays,
    NextEmailAtUtc: cycle < planned ? new Date(Date.now() + gapDays * 24 * 60 * 60 * 1000).toISOString() : null,
    Attempts: 0,
    LastError: '',
  };

  const guard = await claimSendGuard(reference, cycle);
  if (guard === 'exists') {
    // A previous run sent this cycle but crashed before stamping.
    return stamp({ ...sentFields, LastError: 'send previously recorded (guard hit)' }, 'sent');
  }

  const sendResult = await sendViaSendGrid({
    from: buildFromField(branding.name),
    to: customerEmail,
    replyTo: isValidEmail(branding.replyTo) ? branding.replyTo : undefined,
    subject,
    html,
    categoryTag: 'payment-reminder',
    headers: { 'X-TG-Reminder-Ref': `${reference}:${cycle}` },
  });
  if (sendResult.status !== 'sent') {
    // First-email failures park the row as Fetched; follow-up failures keep
    // Status Sent (the past-due NextEmailAtUtc keeps it in the sweep) —
    // both retry on the backoff schedule until the attempt cap.
    return finishFailure(`email send failed: ${sendResult.error || 'unknown'}`, isFollowUp ? {} : { Status: 'Fetched' });
  }

  console.log('[payment-reminders:worker] reminder', `${cycle}/${planned}`, 'emailed for', reference, 'to', maskEmail(customerEmail));
  return stamp(sentFields, 'sent');
}

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || !timingSafeMatch(auth, `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorised' });
  }

  let records;
  try {
    records = await listPendingReminders(BATCH_SIZE);
  } catch (err) {
    console.error('[payment-reminders:worker] queue list failed:', err.message);
    return res.status(500).json({ ok: false, error: 'queue_list_failed' });
  }

  const summary = { picked: records.length, fetched: 0, sent: 0, settled: 0, suppressed: 0, retry: 0, failed: 0, skipped: 0, waiting: 0 };
  for (const record of records) {
    try {
      const { outcome } = await processRecord(record);
      summary[outcome] = (summary[outcome] || 0) + 1;
    } catch (err) {
      // processRecord handles its own failures; this catch is a belt-and-braces
      // guard so one pathological record can't kill the whole sweep.
      console.error('[payment-reminders:worker] unexpected error on', record.id, '—', err.message);
      summary.retry += 1;
    }
  }

  if (summary.picked > 0) {
    console.log('[payment-reminders:worker] sweep done', JSON.stringify(summary));
  }
  return res.status(200).json({ ok: true, ...summary });
}
