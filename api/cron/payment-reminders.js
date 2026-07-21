/**
 * Payment Reminder background worker (phase 1).
 *
 * Consumes the durable queue: Payment Reminders rows with Status=Accepted
 * (written by /api/v1/payment-reminders). For each row it resolves the
 * client's Travelify credentials from the applicationId, fetches the full
 * order (id + key), logs a PII-light summary and marks the row Fetched.
 * Phase 2 appends the email render/send + payment link here — the intake
 * endpoint and the queue contract don't change.
 *
 * Triggered two ways, both hitting this same handler:
 *   - Vercel cron every 5 minutes (the durability guarantee — survives
 *     restarts, retries failures on the next sweep)
 *   - a best-effort kick from the intake endpoint right after a 202 (the
 *     latency optimisation)
 * Overlap between the two is defused by a per-record Redis lock; the lock is
 * best-effort because phase-1 processing is read-only against Travelify.
 *
 * Failure model: each failure stamps LastError and bumps Attempts; the row
 * stays Accepted and retries on a BACKOFF schedule (see below) until
 * MAX_ATTEMPTS flips it to Failed (visible in Airtable; alerting is a
 * phase-2 concern).
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET} (same convention as the other
 * crons; Vercel cron sends it automatically when the env var is set).
 */

import {
  MAX_ATTEMPTS,
  resolveApplication,
  listAcceptedReminders,
  updateReminderRecord,
  acquireProcessingLock,
  fetchOrderByIdKey,
  summariseOrder,
  timingSafeMatch,
} from '../_lib/payment-reminders.js';

const BATCH_SIZE = 25;

// Minutes to wait before retry N+1, indexed by attempts already made. The
// 5-minute cron alone would exhaust MAX_ATTEMPTS in ~25 minutes — shorter
// than a routine Travelify outage, and fatal-by-default while the order
// fetch route awaits live confirmation. Spaced like this the cap covers
// roughly 17 hours (0m, 15m, 1h, 4h, 12h) before a row goes Failed.
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
  // 'error' (Redis down) proceeds — phase 1 is read-only, overlap is harmless.

  const finishFailure = async (message) => {
    const nextAttempts = attempts + 1;
    const fields = {
      Attempts: nextAttempts,
      LastError: String(message || 'unknown error').slice(0, 1000),
      ProcessedAtUtc: new Date().toISOString(),
    };
    if (nextAttempts >= MAX_ATTEMPTS) fields.Status = 'Failed';
    try {
      await updateReminderRecord(record.id, fields);
    } catch (err) {
      console.error('[payment-reminders:worker] failure-stamp failed for', reference, '—', err.message);
    }
    return { outcome: fields.Status === 'Failed' ? 'failed' : 'retry', error: message };
  };

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

  // 2. Fetch the full order from Travelify by id + key.
  const result = await fetchOrderByIdKey(application, f.OrderId, String(f.OrderKey || ''));
  if (!result.ok) {
    return finishFailure(result.error);
  }

  // 3. Phase 1 stops here: log the order and mark the row Fetched.
  console.log('[payment-reminders:worker] fetched order for', reference,
    JSON.stringify(summariseOrder(result.order)));
  try {
    await updateReminderRecord(record.id, {
      Status: 'Fetched',
      Attempts: attempts + 1,
      LastError: '',
      ProcessedAtUtc: new Date().toISOString(),
    });
  } catch (err) {
    // The fetch worked but the stamp didn't — leave it Accepted; the next
    // sweep redoes a cheap read rather than losing the item.
    console.error('[payment-reminders:worker] fetched-stamp failed for', reference, '—', err.message);
    return { outcome: 'retry', error: err.message };
  }
  return { outcome: 'fetched' };
}

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || !timingSafeMatch(auth, `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorised' });
  }

  let records;
  try {
    records = await listAcceptedReminders(BATCH_SIZE);
  } catch (err) {
    console.error('[payment-reminders:worker] queue list failed:', err.message);
    return res.status(500).json({ ok: false, error: 'queue_list_failed' });
  }

  const summary = { picked: records.length, fetched: 0, retry: 0, failed: 0, skipped: 0, waiting: 0 };
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
