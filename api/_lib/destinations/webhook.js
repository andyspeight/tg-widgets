// =============================================================================
//  /api/_lib/destinations/webhook.js
// =============================================================================
//
//  POSTs the canonical lead as JSON to the configured webhook URL.
//  Enables Zapier, Make, n8n, custom CRMs, anything that can receive HTTP.
//
//  SIGNATURE SCHEME (unchanged from existing enquiry-form webhook handler)
//  Header: X-Travelgenix-Signature: t={unix-timestamp},v1={hex-hmac}
//  Signature is HMAC-SHA256 over `${timestamp}.${rawBody}` using the per-
//  config webhook secret. Recipient verifies by:
//    1. Parse t and v1 from header
//    2. expected = HMAC-SHA256(secret, `${t}.${rawBody}`)
//    3. Constant-time compare
//    4. Reject if t > 5 minutes old
//
//  Payload sent: a versioned envelope, NOT the raw canonical lead. This way
//  we can change the internal schema later without breaking integrations.
//
//    {
//      "event": "lead.created",
//      "version": "1",
//      "leadId": "...",
//      "receivedAt": "...",
//      "source": { ... },
//      "contact": { ... },
//      "travel": { ... },
//      "consent": { ... },
//      "tags": [...],
//      "custom": { ... }
//    }
//
// =============================================================================

import { createHmac } from 'crypto';

const WEBHOOK_TIMEOUT_MS = 10_000;
const USER_AGENT = 'Travelgenix-Webhooks/1.1';

function isValidWebhookUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    // Block localhost and private IPs at the domain layer — defence in depth
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function buildPayload(lead) {
  return {
    event: 'lead.created',
    version: '1',
    leadId: lead.leadId,
    receivedAt: lead.receivedAt,
    source: lead.source,
    contact: lead.contact,
    travel: lead.travel,
    consent: lead.consent,
    tags: lead.tags,
    custom: lead.custom,
  };
}

function sign(rawBody, secret) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

export async function dispatchWebhook(lead, job) {
  const url = job.config?.url;
  const headers = job.config?.headers || {};
  const secret = job.credentials?.secret;

  if (!isValidWebhookUrl(url)) {
    const err = new Error('Invalid webhook URL — must be HTTPS and a public host');
    err.statusCode = 400;
    throw err;
  }

  const payload = buildPayload(lead);
  const rawBody = JSON.stringify(payload);

  const reqHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
    'Accept': 'application/json',
    ...headers,
  };
  if (secret) {
    reqHeaders['X-Travelgenix-Signature'] = sign(rawBody, secret);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEBHOOK_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: reqHeaders,
      body: rawBody,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      const e = new Error('Webhook timeout');
      e.statusCode = 504;
      throw e;
    }
    throw err;
  }
  clearTimeout(timer);

  const respText = await resp.text().catch(() => '');

  if (!resp.ok) {
    const err = new Error(`Webhook returned ${resp.status}`);
    err.statusCode = resp.status;
    throw err;
  }

  return {
    statusCode: resp.status,
    requestPayload: { url, payload },
    responseBody: respText.slice(0, 2000),
  };
}
