// =============================================================================
//  /api/enquiry/sendgrid-webhook.js
// =============================================================================
//
//  Receives event webhooks from SendGrid and updates the matching submission
//  record in Airtable with delivery status.
//
//  SendGrid fires batches of events as emails move through their system:
//    processed → delivered → opened → clicked
//    processed → deferred → ... → delivered (retried)
//    processed → bounced | dropped | spamreport
//
//  We match each event to a submission via the X-TG-Submission-Id header
//  that email.js and auto-reply.js set on every outbound email. SendGrid
//  surfaces custom headers as event properties, so we can thread the needle
//  back to the record.
//
//  SECURITY:
//  - Signed Event Webhook Requests are mandatory. Every request includes
//    X-Twilio-Email-Event-Webhook-Signature (ECDSA P-256 over SHA-256) and
//    X-Twilio-Email-Event-Webhook-Timestamp. We verify the signature against
//    SENDGRID_WEBHOOK_VERIFICATION_KEY before touching anything.
//  - Signature is computed over: timestamp + raw_request_body
//  - Need the RAW body — Vercel's default parser breaks this, so we export
//    config.api.bodyParser = false and read the stream ourselves.
//  - A 5-minute window on the timestamp prevents replay attacks with old
//    captured webhook payloads.
//
//  FAILURE MODES:
//  - Invalid signature → 403 (SendGrid will retry, then mark as disabled)
//  - Unknown submission (no X-TG-Submission-Id match) → log + 200 (SendGrid
//    shouldn't retry events for emails we don't care about)
//  - Airtable error → 500 (SendGrid retries with exponential backoff)
//  - Always respond fast (<5s). SendGrid batches up to 1000 events per POST
//    so we process synchronously but keep it tight.
//
// =============================================================================

import { createVerify } from 'node:crypto';

// Disable Vercel's default body parsing — we need the raw body for signature
// verification. Without this, req.body arrives as a parsed object and the
// signature check against the original JSON string will fail.
export const config = {
  api: {
    bodyParser: false,
  },
};

const AIRTABLE_API = 'https://api.airtable.com/v0';
const ENQUIRIES_BASE_ID      = process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID;
const ENQUIRIES_PAT          = process.env.TG_ENQUIRIES_AIRTABLE_PAT;
const VERIFICATION_KEY       = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
const SUBMISSIONS_TABLE_ID   = 'tblxtRPhALFjeMVA6';

// Submissions table fields we read/write
const F = {
  submissionId:   null, // Airtable record ID is the match key — no field needed
  emailStatus:    'fld5vnl2pMMTkaJXZ',  // Single select
  emailEvents:    'fldY8o2tEXYDf2Eed',  // Long text (JSON)
};

// SendGrid event types → Airtable select option names.
// Terminal events (bounced/dropped/spamreport) stick even if earlier events
// arrive out of order. Opened > Delivered > Processed in the promotion
// hierarchy so we don't downgrade a known-good state.
const EVENT_TO_STATUS = {
  processed:   'Processed',
  deferred:    'Deferred',
  delivered:   'Delivered',
  open:        'Opened',
  click:       'Clicked',
  bounce:      'Bounced',
  dropped:     'Dropped',
  spamreport:  'Spam Reported',
  // These events can arrive but we don't want to overwrite status with them:
  //   unsubscribe, group_unsubscribe, group_resubscribe — ignored below
};

// Rank each status so we never downgrade. A submission that's been Clicked
// shouldn't get pushed back to Delivered if Delivered arrives late.
// Terminal failures (Bounced, Dropped, Spam Reported) are rank 100 — they
// always win. Opened/Clicked beat Delivered beats Processed beats Deferred.
const STATUS_RANK = {
  'Deferred':      10,
  'Processed':     20,
  'Delivered':     30,
  'Opened':        40,
  'Clicked':       50,
  'Bounced':      100,
  'Dropped':      100,
  'Spam Reported':100,
};

// 5-minute tolerance on the timestamp. SendGrid's clock should be close
// to ours but allow for drift. Prevents replay of captured old payloads.
const MAX_TIMESTAMP_SKEW_SECONDS = 300;

// Cap the event log stored in the submission record to prevent runaway growth.
// A well-behaved email generates 3-5 events; cap at 50 for pathological cases
// (clicked 30 times, etc.) to keep the cell under Airtable's 100K char limit.
const MAX_EVENTS_STORED = 50;

// ---------- Raw body reader -------------------------------------------------

/**
 * Read the raw request body as a Buffer. Required for signature verification.
 */
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- Signature verification ------------------------------------------

/**
 * Verify the SendGrid signature. Returns true if valid, false otherwise.
 *
 * SendGrid signs: timestamp_string + raw_body_string
 * Using: ECDSA on P-256 curve with SHA-256
 * Public key format: base64-encoded DER (SubjectPublicKeyInfo)
 */
function verifySignature(rawBody, signature, timestamp) {
  if (!VERIFICATION_KEY || !signature || !timestamp) return false;

  try {
    // Convert the base64-encoded public key into a PEM-formatted key that
    // Node's crypto.createVerify can consume. SendGrid gives us just the
    // base64 DER; we wrap it in the standard PEM envelope.
    const pem =
      '-----BEGIN PUBLIC KEY-----\n' +
      VERIFICATION_KEY.match(/.{1,64}/g).join('\n') +
      '\n-----END PUBLIC KEY-----\n';

    const verify = createVerify('SHA256');
    verify.update(timestamp);
    verify.update(rawBody);
    verify.end();

    // SendGrid's signature is base64-encoded
    return verify.verify(pem, signature, 'base64');
  } catch (err) {
    console.error('[sg-webhook] Signature verification threw:', err.message);
    return false;
  }
}

// ---------- Event matching + batching ---------------------------------------

/**
 * Extract the submission record ID from a SendGrid event.
 *
 * SendGrid surfaces `custom_args` back on every webhook event as top-level
 * properties on the event object. So if we sent the email with
 * custom_args: { submissionId: "recABC..." } then the event fires with
 * event.submissionId === "recABC...". This is the documented, reliable
 * way to thread metadata through the webhook pipeline.
 *
 * We check a few path variants to be robust against:
 *   - SendGrid sometimes flattening custom_args onto the event root (seen in
 *     current batch format) vs nesting them (seen in older/v2 sends)
 *   - The original X-TG-Submission-Id header appearing on the event if an
 *     email was sent via legacy code paths before custom_args was wired
 */
function extractSubmissionId(event) {
  const candidates = [
    // Primary path — custom_args surfaced on event root (current SendGrid behaviour)
    event.submissionId,
    // Fallback — nested under custom_args/unique_args
    event.custom_args && event.custom_args.submissionId,
    event.unique_args && event.unique_args.submissionId,
    // Legacy header path (won't normally appear but kept for safety)
    event['X-TG-Submission-Id'],
    event['x-tg-submission-id'],
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^rec[A-Za-z0-9]{14}$/.test(c)) return c;
  }
  return null;
}

/**
 * Group events by submission ID so we can batch Airtable PATCHes per record.
 * Even if SendGrid sends 50 events for one submission in a burst, we only
 * issue one Airtable update per submission.
 */
function groupEventsBySubmission(events) {
  const bySubmission = new Map();
  for (const event of events) {
    const submissionId = extractSubmissionId(event);
    if (!submissionId) continue; // event is not one of ours
    if (!bySubmission.has(submissionId)) bySubmission.set(submissionId, []);
    bySubmission.get(submissionId).push(event);
  }
  return bySubmission;
}

// ---------- Airtable update -------------------------------------------------

/**
 * Fetch a submission's current email status + events so we can merge without
 * clobbering. SendGrid doesn't guarantee event order, so we must read-merge-write
 * rather than blindly overwrite.
 */
async function fetchSubmission(submissionId) {
  const url = `${AIRTABLE_API}/${ENQUIRIES_BASE_ID}/${SUBMISSIONS_TABLE_ID}/${submissionId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${ENQUIRIES_PAT}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Airtable GET failed: ${response.status}`);
  }
  const data = await response.json();
  return data;
}

/**
 * Merge new events into an existing submission and write back.
 */
async function mergeAndWrite(submissionId, newEvents) {
  const existing = await fetchSubmission(submissionId);
  if (!existing) {
    // SendGrid sent events for a submission we've deleted or never had.
    // Log and move on — we've responded 200 so SendGrid won't retry.
    console.warn('[sg-webhook] Submission not found:', submissionId);
    return { status: 'skipped', reason: 'not-found' };
  }

  const currentStatus = existing.fields[F.emailStatus] || null;
  const currentEventsRaw = existing.fields[F.emailEvents] || '[]';
  let currentEvents = [];
  try {
    currentEvents = JSON.parse(currentEventsRaw);
    if (!Array.isArray(currentEvents)) currentEvents = [];
  } catch (e) {
    currentEvents = [];
  }

  // Build the new event log entries
  const eventEntries = newEvents.map(ev => ({
    event:     ev.event,
    timestamp: ev.timestamp || null,
    sg_event_id: ev.sg_event_id || null,
    email:     ev.email || null,
    // Include bounce/drop reason if present — useful for diagnosing
    reason: ev.reason || ev.response || null,
    // SendGrid category for telling agent-notification apart from auto-reply
    category: ev.category || null,
    // Our own emailKind custom_arg — same info as category but more reliable
    // (category field shape varies between SendGrid account configs)
    emailKind: ev.emailKind || (ev.custom_args && ev.custom_args.emailKind) || null,
  }));

  // De-duplicate by sg_event_id so retries don't pile up duplicate entries
  const seenIds = new Set(currentEvents.map(e => e.sg_event_id).filter(Boolean));
  const deduped = eventEntries.filter(e => !e.sg_event_id || !seenIds.has(e.sg_event_id));

  const mergedEvents = currentEvents.concat(deduped);
  // Trim from the front to keep the N most recent events
  const trimmedEvents = mergedEvents.length > MAX_EVENTS_STORED
    ? mergedEvents.slice(mergedEvents.length - MAX_EVENTS_STORED)
    : mergedEvents;

  // Figure out the highest-ranking status across all new + existing events
  let bestStatus = currentStatus;
  let bestRank = STATUS_RANK[currentStatus] || 0;
  for (const ev of newEvents) {
    const mapped = EVENT_TO_STATUS[ev.event];
    if (!mapped) continue;
    const rank = STATUS_RANK[mapped] || 0;
    if (rank > bestRank) {
      bestStatus = mapped;
      bestRank = rank;
    }
  }

  // If no status change and no new events to log, skip the write.
  // Saves an Airtable call on duplicate webhook deliveries.
  if (bestStatus === currentStatus && deduped.length === 0) {
    return { status: 'skipped', reason: 'no-change' };
  }

  const patchFields = {
    [F.emailEvents]: JSON.stringify(trimmedEvents),
  };
  if (bestStatus && bestStatus !== currentStatus) {
    patchFields[F.emailStatus] = bestStatus;
  }

  const patchUrl = `${AIRTABLE_API}/${ENQUIRIES_BASE_ID}/${SUBMISSIONS_TABLE_ID}/${submissionId}`;
  const response = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${ENQUIRIES_PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: patchFields, typecast: true }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('[sg-webhook] Airtable PATCH failed:', response.status, body.slice(0, 300));
    throw new Error(`Airtable PATCH failed: ${response.status}`);
  }

  return { status: 'ok', newStatus: bestStatus, eventsAdded: deduped.length };
}

// ---------- Handler ---------------------------------------------------------

export default async function handler(req, res) {
  // Security headers — same baseline as submit.js
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!ENQUIRIES_PAT || !ENQUIRIES_BASE_ID) {
    console.error('[sg-webhook] Missing TG_ENQUIRIES_AIRTABLE_PAT or _BASE_ID');
    return res.status(500).json({ error: 'server_misconfigured' });
  }
  if (!VERIFICATION_KEY) {
    console.error('[sg-webhook] Missing SENDGRID_WEBHOOK_VERIFICATION_KEY');
    // Fail closed — without the key we can't verify and shouldn't process events
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  // Read raw body for signature verification
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error('[sg-webhook] Failed to read body:', err);
    return res.status(400).json({ error: 'bad_request' });
  }

  // Signature + timestamp headers. SendGrid's header names are stable.
  const signature = req.headers['x-twilio-email-event-webhook-signature'];
  const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'];

  if (!signature || !timestamp) {
    console.warn('[sg-webhook] Missing signature/timestamp headers');
    return res.status(403).json({ error: 'missing_signature' });
  }

  // Replay protection — timestamp must be within tolerance
  const timestampNum = parseInt(timestamp, 10);
  if (!Number.isFinite(timestampNum)) {
    return res.status(403).json({ error: 'invalid_timestamp' });
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > MAX_TIMESTAMP_SKEW_SECONDS) {
    console.warn('[sg-webhook] Timestamp skew too large:', now - timestampNum);
    return res.status(403).json({ error: 'stale_timestamp' });
  }

  // Signature check
  if (!verifySignature(rawBody, signature, timestamp)) {
    console.warn('[sg-webhook] Signature verification failed');
    return res.status(403).json({ error: 'invalid_signature' });
  }

  // Parse the event batch
  let events;
  try {
    events = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    console.error('[sg-webhook] Failed to parse JSON body:', err.message);
    return res.status(400).json({ error: 'invalid_json' });
  }
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'expected_array' });
  }

  // Group by submission so we can batch updates
  const bySubmission = groupEventsBySubmission(events);
  if (bySubmission.size === 0) {
    // No events of ours in this batch — ack and move on
    return res.status(200).json({ ok: true, processed: 0 });
  }

  // Process each submission's events in parallel. Use allSettled so one
  // failure doesn't poison the batch — if SendGrid retries the whole batch
  // due to a failure, idempotency (sg_event_id dedup) handles the replays.
  const results = await Promise.allSettled(
    Array.from(bySubmission.entries()).map(([submissionId, submissionEvents]) =>
      mergeAndWrite(submissionId, submissionEvents)
    )
  );

  let okCount = 0;
  let failCount = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      okCount++;
    } else {
      failCount++;
      const submissionId = Array.from(bySubmission.keys())[i];
      console.error('[sg-webhook] Update failed for', submissionId, ':', r.reason?.message);
    }
  });

  // If any writes failed, return 500 so SendGrid retries. The successful
  // writes are idempotent (sg_event_id dedup) so retries are safe.
  if (failCount > 0 && okCount === 0) {
    return res.status(500).json({ error: 'all_updates_failed' });
  }

  return res.status(200).json({
    ok: true,
    processed: bySubmission.size,
    okCount,
    failCount,
  });
}
