// =============================================================================
//  /api/enquiry/_lib/routing/webhook.js
// =============================================================================
//
//  POSTs the submission as JSON to the agent's configured webhook URL.
//  Enables integration with Zapier, Make, custom CRMs, or anything else
//  that can receive an HTTP POST.
//
//  SIGNATURE SCHEME
//  ----------------
//  Header: X-Travelgenix-Signature: t={unix-timestamp},v1={hex-hmac}
//
//  Signature is HMAC-SHA256 over `${timestamp}.${rawBody}` using the
//  form-specific Routing Webhook Secret. Recipient verifies by:
//    1. Parse t and v1 from header
//    2. Compute expected = HMAC-SHA256(secret, `${t}.${rawBody}`)
//    3. Use constant-time compare (timingSafeEqual in Node)
//    4. Reject if t is older than 5 minutes (replay protection)
//
//  This follows the Stripe/GitHub convention. The `v1=` prefix allows us
//  to introduce a v2 scheme later (e.g. different hash) without breaking
//  existing integrations.
//
//  TIMEOUT: 10 seconds. Webhook endpoints should ack quickly and process
//  async — a slow webhook endpoint can't block the rest of the routing
//  fan-out.
//
// =============================================================================

import crypto from 'crypto';

// Form field IDs we need
const F = {
  webhookUrl:    'fldNyUqKUUDElxrGS',
  webhookSecret: 'fldcoECqbqhWSj7eW',
  formName:      'fldC0MLSyJqg6U1zT',
  clientName:    'fldrw1eTFYCFIo0pp',
};

const WEBHOOK_TIMEOUT_MS = 10_000;
const USER_AGENT = 'Travelgenix-Webhooks/1.0';

// ---------- Validation ------------------------------------------------------

function isValidWebhookUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    // HTTPS only — never POST visitor data over plain HTTP
    if (parsed.protocol !== 'https:') return false;
    // Block obvious internal/local targets (defence in depth against SSRF)
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^10\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false; // link-local / AWS metadata
    return true;
  } catch {
    return false;
  }
}

// ---------- Payload construction --------------------------------------------

function buildPayload({ form, payload, reference, submissionId }) {
  return {
    // Envelope — standard for every webhook event
    event: 'enquiry.submitted',
    version: '2026-04-23',
    reference,
    submissionId,
    submittedAt: new Date().toISOString(),

    // Form metadata — so recipient knows which form/client this is for
    form: {
      id: payload.formId,
      name: form.fields[F.formName] || '',
      clientName: form.fields[F.clientName] || '',
    },

    // Visitor submission data — mirrors spec §4 payload shape
    fields: payload.fields,

    // Request metadata for fraud review / attribution
    meta: {
      sourceUrl: payload.sourceUrl || null,
      locale: payload.locale || null,
      visitorId: payload.visitorId || null,
    },
  };
}

// ---------- Signature -------------------------------------------------------

function signPayload(rawBody, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signingInput = `${timestamp}.${rawBody}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('hex');
  return {
    timestamp,
    header: `t=${timestamp},v1=${signature}`,
  };
}

// ---------- Public interface -------------------------------------------------

export default async function sendWebhook(ctx) {
  const { form, payload, reference, submissionId } = ctx;

  const webhookUrl = (form.fields[F.webhookUrl] || '').trim();
  const webhookSecret = form.fields[F.webhookSecret] || '';

  if (!webhookUrl) {
    return { status: 'failed', error: 'No webhook URL configured' };
  }
  if (!isValidWebhookUrl(webhookUrl)) {
    return { status: 'failed', error: 'Webhook URL invalid or points to a blocked host' };
  }
  if (!webhookSecret) {
    return { status: 'failed', error: 'Webhook signing secret missing — configure on the form' };
  }

  // Build payload and serialise exactly once — the recipient must verify
  // against the same raw bytes we sign, so we can't re-stringify later.
  const body = JSON.stringify(buildPayload({ form, payload, reference, submissionId }));
  const { header: signatureHeader, timestamp } = signPayload(body, webhookSecret);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-Travelgenix-Signature': signatureHeader,
        'X-Travelgenix-Timestamp': String(timestamp),
        'X-Travelgenix-Event': 'enquiry.submitted',
        'X-Travelgenix-Reference': reference,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 2xx = success. 4xx/5xx = failure. Per spec §5.3.5 we don't retry 4xx
    // (caller's problem) but the orchestrator decides retry; we just report.
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[routing/webhook] Non-2xx response:', response.status, errText.slice(0, 300));
      return {
        status: 'failed',
        statusCode: response.status,
        error: `Webhook endpoint returned ${response.status}`,
      };
    }

    return { status: 'ok', statusCode: response.status };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { status: 'failed', error: 'Webhook timeout after 10 seconds' };
    }
    console.error('[routing/webhook] Fetch error:', err);
    return { status: 'failed', error: err.message };
  }
}

// =============================================================================
//  RECIPIENT VERIFICATION — reference implementation for agent's endpoint
// =============================================================================
//  Agents receiving our webhooks should verify the signature to ensure the
//  POST actually came from Travelgenix, not a spoofed request. Example in
//  Node.js — adapt for whatever stack the agent's using.
//
//    import crypto from 'crypto';
//
//    function verifyTravelgenixWebhook(req, secret) {
//      const header = req.headers['x-travelgenix-signature'];
//      if (!header) return false;
//
//      const parts = Object.fromEntries(
//        header.split(',').map(p => p.trim().split('='))
//      );
//      const timestamp = parseInt(parts.t, 10);
//      const signature = parts.v1;
//      if (!timestamp || !signature) return false;
//
//      // Replay protection — reject if older than 5 minutes
//      const age = Math.floor(Date.now() / 1000) - timestamp;
//      if (age > 300 || age < -60) return false;
//
//      // Recompute against raw body (must be the raw request body, not re-stringified)
//      const expected = crypto
//        .createHmac('sha256', secret)
//        .update(`${timestamp}.${req.rawBody}`)
//        .digest('hex');
//
//      // Constant-time compare
//      const a = Buffer.from(signature, 'hex');
//      const b = Buffer.from(expected, 'hex');
//      if (a.length !== b.length) return false;
//      return crypto.timingSafeEqual(a, b);
//    }
//
// =============================================================================
