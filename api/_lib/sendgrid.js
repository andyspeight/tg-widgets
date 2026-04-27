// =============================================================================
//  /api/_lib/sendgrid.js
// =============================================================================
//
//  Shared SendGrid v3 Mail Send wrapper.
//
//  This is a thin abstraction over the SendGrid HTTPS API. It exists so every
//  endpoint that sends mail (enquiry forms, booking confirmations, future
//  marketing emails) shares the same:
//   - error handling
//   - delivery categorisation (for SendGrid's filtering/analytics)
//   - retry behaviour
//   - sender + reply-to construction
//
//  Why a hand-rolled HTTPS call rather than the @sendgrid/mail SDK?
//  Vercel functions cold-start faster without the SDK's dependency tree, and
//  SendGrid's REST API is stable enough that a small wrapper outweighs the
//  SDK's ergonomics for our use case.
//
//  Required environment variables:
//   - SENDGRID_API_KEY            (the SG.xxxxx.yyyyy key)
//   - SENDGRID_FROM_EMAIL         (verified sender, e.g. noreply@travelify.io)
//   - SENDGRID_FROM_NAME_FALLBACK (fallback display name, e.g. 'Travelgenix')
//
//  We deliberately ALWAYS send from SENDGRID_FROM_EMAIL (a domain we control
//  with SPF/DKIM aligned) and use Reply-To for the agent's actual address.
//  This keeps deliverability high — if we tried to spoof a "from" address on
//  a domain we don't control, every major provider would mark it as spam or
//  flat-out refuse it.
// =============================================================================

const SENDGRID_ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function getEnv() {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  const fromNameFallback = process.env.SENDGRID_FROM_NAME_FALLBACK || 'Travelgenix';

  if (!apiKey || !fromEmail) {
    throw new Error('SendGrid not configured (SENDGRID_API_KEY and SENDGRID_FROM_EMAIL required)');
  }

  return { apiKey, fromEmail, fromNameFallback };
}

/**
 * Build the From field. Always uses our verified sender address with the
 * provided display name. Display name falls back to SENDGRID_FROM_NAME_FALLBACK.
 */
export function buildFromField(displayName) {
  const { fromEmail, fromNameFallback } = getEnv();
  const safeName = (displayName || fromNameFallback).replace(/[<>"]/g, '').trim() || fromNameFallback;
  return { email: fromEmail, name: safeName };
}

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send via SendGrid v3 Mail Send.
 *
 * @param {object} opts
 * @param {{email: string, name?: string}} opts.from  - From identity (use buildFromField)
 * @param {string|string[]} opts.to                   - Recipient email(s)
 * @param {string|string[]} [opts.cc]                 - CC email(s)
 * @param {string|string[]} [opts.bcc]                - BCC email(s)
 * @param {string} opts.subject                       - Subject line
 * @param {string} opts.html                          - HTML body
 * @param {string} [opts.text]                        - Plain-text body (auto-derived if omitted)
 * @param {string} [opts.replyTo]                     - Reply-To email address
 * @param {object} [opts.headers]                     - Custom headers (e.g. X-TG-* tracing)
 * @param {string} [opts.categoryTag]                 - SendGrid category for analytics filtering
 * @param {Array<{filename: string, content: string, type?: string, disposition?: string}>} [opts.attachments]
 *        Attachments. `content` must be base64-encoded.
 *
 * @returns {Promise<{status: 'sent'|'failed', sgMessageId?: string, error?: string, statusCode?: number}>}
 */
export async function sendViaSendGrid(opts) {
  const { apiKey } = getEnv();

  const toList = Array.isArray(opts.to) ? opts.to : [opts.to];
  const ccList = opts.cc ? (Array.isArray(opts.cc) ? opts.cc : [opts.cc]) : [];
  const bccList = opts.bcc ? (Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc]) : [];

  // Build the personalisation block. SendGrid's "personalizations" array lets
  // us send a single payload with multiple recipients while keeping CC/BCC
  // semantics. We only ever use one personalisation per send to keep things
  // simple — bulk sends would use multiple.
  const personalization = {
    to: toList.map(email => ({ email })),
  };
  if (ccList.length) personalization.cc = ccList.map(email => ({ email }));
  if (bccList.length) personalization.bcc = bccList.map(email => ({ email }));

  const payload = {
    personalizations: [personalization],
    from: opts.from,
    subject: opts.subject,
    content: [
      // SendGrid requires text/plain content to come first when both are present
      { type: 'text/plain', value: opts.text || htmlToPlainText(opts.html) },
      { type: 'text/html', value: opts.html },
    ],
  };

  if (opts.replyTo) {
    payload.reply_to = { email: opts.replyTo };
  }

  if (opts.headers && typeof opts.headers === 'object') {
    payload.headers = {};
    for (const [k, v] of Object.entries(opts.headers)) {
      // SendGrid header values must be strings. Drop anything that isn't.
      if (typeof v === 'string') payload.headers[k] = v;
    }
  }

  if (opts.categoryTag) {
    payload.categories = [opts.categoryTag];
  }

  if (Array.isArray(opts.attachments) && opts.attachments.length > 0) {
    payload.attachments = opts.attachments.map(a => ({
      filename: a.filename,
      content: a.content,
      type: a.type || 'application/octet-stream',
      disposition: a.disposition || 'attachment',
    }));
  }

  // Retry transient failures (5xx). We deliberately do NOT retry 4xx — those
  // are our fault (bad payload) and retrying just wastes calls.
  let lastError = null;
  let lastStatus = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(SENDGRID_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      lastStatus = res.status;

      if (res.status === 202) {
        // SendGrid returns 202 Accepted with X-Message-Id header. There's no
        // body — read it anyway to free the connection.
        try { await res.text(); } catch {}
        const sgMessageId = res.headers.get('x-message-id') || undefined;
        return { status: 'sent', sgMessageId, statusCode: 202 };
      }

      // 4xx → don't retry, our payload is wrong
      if (res.status >= 400 && res.status < 500) {
        let errBody = '';
        try { errBody = await res.text(); } catch {}
        return {
          status: 'failed',
          error: `SendGrid ${res.status}: ${errBody.slice(0, 500)}`,
          statusCode: res.status,
        };
      }

      // 5xx → retry
      let errBody = '';
      try { errBody = await res.text(); } catch {}
      lastError = `SendGrid ${res.status}: ${errBody.slice(0, 200)}`;
    } catch (err) {
      lastError = err.message || 'Network error';
    }

    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  return { status: 'failed', error: lastError || 'Unknown error', statusCode: lastStatus };
}

/**
 * Crude HTML → plain-text fallback. Used when caller doesn't supply a text
 * body. Strips tags and decodes a few common entities. Good enough for
 * accessibility/fallback purposes — not a substitute for a hand-written
 * plain-text version when one matters.
 */
function htmlToPlainText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Strict email address validator. Accepts the addr-spec form only — no display
 * names, no commas, no quoted-strings. Used to validate user-supplied recipients
 * before passing them to SendGrid.
 */
export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  // Conservative pattern. RFC 5322 allows weirder things but we don't.
  return /^[^\s@<>(),;:"\[\]\\]+@[^\s@<>(),;:"\[\]\\]+\.[^\s@<>(),;:"\[\]\\]+$/.test(trimmed);
}

/**
 * Parse a comma/semicolon/newline-separated string of recipients into a
 * de-duplicated, validated array. Caps at `max` entries.
 */
export function parseRecipientsString(raw, max = 10) {
  if (!raw || typeof raw !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const candidate of raw.split(/[\n,;]/)) {
    const trimmed = candidate.trim().toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    if (!isValidEmail(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}
