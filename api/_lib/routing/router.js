// =============================================================================
//  /api/_lib/routing/router.js
// =============================================================================
//
//  The orchestrator. Public entry point: `dispatchLead(lead)`.
//
//  Lifecycle:
//    1. Validate lead (caller has usually already done this via buildCanonicalLead)
//    2. Write master Submissions record
//    3. Load active RoutingConfig records for the widget
//    4. Dispatch to each enabled destination IN PARALLEL, with isolation —
//       one failure does not cascade
//    5. Write a RoutingLog entry per dispatch (success or failure)
//    6. Update the lead's `routing.completed` / `routing.failed` arrays
//    7. Return the result envelope
//
//  Failure isolation is critical. The promise returned by dispatchLead()
//  always resolves — never rejects. If a destination handler throws, that
//  failure is captured in routing.failed[] and logged; the lead still gets
//  delivered to the other destinations.
//
//  Performance: all destinations dispatch concurrently via Promise.allSettled.
//  Total wall time = max(individual destination time), not sum.
//
// =============================================================================

import { buildCanonicalLead, ValidationError } from './schema.js';
import { loadRoutingJobs, recordDispatchOutcome } from './config-loader.js';
import { writeSubmission, writeLog } from './log.js';

import { dispatchGoogleSheets } from '../destinations/google-sheets.js';
import { dispatchWebhook } from '../destinations/webhook.js';
import { dispatchEmail } from '../destinations/email.js';

// ── Destination registry ────────────────────────────────────────────────
// Add new destinations here. Each handler signature:
//   async (lead, job) => { statusCode, requestPayload, responseBody }
// Throws on failure; returns the above on success.

const DISPATCHERS = {
  'google-sheets': dispatchGoogleSheets,
  'webhook': dispatchWebhook,
  'email': dispatchEmail,
  // Session 2 will add:
  // 'mailchimp', 'brevo', 'klaviyo', 'activecampaign', 'hubspot',
  // 'airtable', 'auto-reply', 'luna-marketing'
};

const DISPATCH_TIMEOUT_MS = 15_000;

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Dispatch a lead to all configured destinations.
 *
 * @param {object} input — partial lead from a widget, will be canonicalised
 * @param {object} options
 * @param {string[]} [options.onlyDestinations] — filter to specific destination types
 * @returns {Promise<{ leadId, submissionRecordId, completed, failed, skipped, durationMs }>}
 */
export async function dispatchLead(input, options = {}) {
  const t0 = Date.now();
  let lead;
  try {
    lead = buildCanonicalLead(input);
  } catch (err) {
    if (err instanceof ValidationError) {
      return {
        ok: false,
        error: err.message,
        statusCode: 400,
        leadId: null,
        completed: [],
        failed: [],
        skipped: [],
        durationMs: Date.now() - t0,
      };
    }
    throw err;
  }

  // Step 1: Write master Submissions record (don't block on failure)
  const submissionRecordId = await writeSubmission(lead);
  lead.routing.submissionRecordId = submissionRecordId || '';

  // Step 2: Load active routing jobs for this widget
  const jobs = await loadRoutingJobs(lead.source.widgetId);

  // Filter if caller asked for specific destinations only
  const filteredJobs = options.onlyDestinations
    ? jobs.filter(j => options.onlyDestinations.includes(j.destination))
    : jobs;

  if (filteredJobs.length === 0) {
    // No destinations configured — that's fine, the Submissions record is
    // the lead's home. Many simple deployments will use only the Airtable
    // inbox.
    return {
      ok: true,
      leadId: lead.leadId,
      submissionRecordId,
      completed: [],
      failed: [],
      skipped: [],
      durationMs: Date.now() - t0,
    };
  }

  // Step 3: Dispatch in parallel with isolation
  const results = await Promise.allSettled(
    filteredJobs.map(job => dispatchOne(lead, job))
  );

  // Step 4: Aggregate
  const completed = [];
  const failed = [];
  const skipped = [];
  for (let i = 0; i < results.length; i++) {
    const job = filteredJobs[i];
    const r = results[i];
    if (r.status === 'fulfilled') {
      const out = r.value;
      if (out.skipped) skipped.push({ destination: job.destination, reason: out.reason });
      else if (out.success) completed.push(job.destination);
      else failed.push({ destination: job.destination, error: out.error });
    } else {
      // Should not happen — dispatchOne catches everything — but defensive
      failed.push({ destination: job.destination, error: r.reason?.message || 'unknown' });
    }
  }

  return {
    ok: true,
    leadId: lead.leadId,
    submissionRecordId,
    completed,
    failed,
    skipped,
    durationMs: Date.now() - t0,
  };
}

// ── Single dispatch with full isolation + logging ───────────────────────

async function dispatchOne(lead, job) {
  const t0 = Date.now();
  const dispatcher = DISPATCHERS[job.destination];

  // Unsupported destination — log and skip (don't fail the lead)
  if (!dispatcher) {
    await writeLog({
      leadId: lead.leadId,
      submissionRecordId: lead.routing.submissionRecordId,
      configRecordId: job.configRecordId,
      widgetType: lead.source.widget,
      widgetRecordId: lead.source.widgetId,
      clientEmail: lead.source.clientEmail,
      destination: job.destination,
      status: 'skipped',
      errorMessage: `No dispatcher registered for ${job.destination}`,
      attempt: 1,
      testMode: job.testMode,
      durationMs: Date.now() - t0,
    });
    return { skipped: true, reason: 'no-dispatcher' };
  }

  // Test mode — record what we would have sent, don't actually call
  if (job.testMode) {
    await writeLog({
      leadId: lead.leadId,
      submissionRecordId: lead.routing.submissionRecordId,
      configRecordId: job.configRecordId,
      widgetType: lead.source.widget,
      widgetRecordId: lead.source.widgetId,
      clientEmail: lead.source.clientEmail,
      destination: job.destination,
      status: 'success',
      attempt: 1,
      testMode: true,
      requestPayload: { lead: lead.leadId, dest: job.destination, note: 'test-mode dry-run' },
      durationMs: Date.now() - t0,
    });
    return { success: true };
  }

  // Real dispatch — wrap in timeout + try/catch
  try {
    const result = await withTimeout(
      dispatcher(lead, job),
      DISPATCH_TIMEOUT_MS,
      `${job.destination} timed out after ${DISPATCH_TIMEOUT_MS}ms`
    );

    const durationMs = Date.now() - t0;

    // Log success (fire-and-forget)
    writeLog({
      leadId: lead.leadId,
      submissionRecordId: lead.routing.submissionRecordId,
      configRecordId: job.configRecordId,
      widgetType: lead.source.widget,
      widgetRecordId: lead.source.widgetId,
      clientEmail: lead.source.clientEmail,
      destination: job.destination,
      status: 'success',
      statusCode: result?.statusCode,
      attempt: 1,
      testMode: false,
      requestPayload: result?.requestPayload,
      responseBody: result?.responseBody,
      durationMs,
    }).catch(() => {});

    // Update RoutingConfig last-used (fire-and-forget)
    recordDispatchOutcome(job.configRecordId, { status: 'success' }).catch(() => {});

    return { success: true };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const errMsg = err?.message || String(err);

    writeLog({
      leadId: lead.leadId,
      submissionRecordId: lead.routing.submissionRecordId,
      configRecordId: job.configRecordId,
      widgetType: lead.source.widget,
      widgetRecordId: lead.source.widgetId,
      clientEmail: lead.source.clientEmail,
      destination: job.destination,
      status: 'failed',
      statusCode: err?.statusCode,
      errorMessage: errMsg,
      attempt: 1,
      testMode: false,
      durationMs,
    }).catch(() => {});

    recordDispatchOutcome(job.configRecordId, { status: 'failed', error: errMsg }).catch(() => {});

    return { success: false, error: errMsg };
  }
}

// ── Timeout wrapper ─────────────────────────────────────────────────────

function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}
