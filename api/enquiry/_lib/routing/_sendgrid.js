/**
 * SendGrid v3 Mail Send wrapper.
 *
 * Centralises the HTTP call, env var reading, and error handling so that
 * email.js and auto-reply.js can focus on building the right payload.
 *
 * Env vars:
 *   SENDGRID_API_KEY           — API key (format: SG.xxxxx.yyyyy)
 *   SENDGRID_FROM_EMAIL        — verified sender address (e.g. noreply@travelify.io)
 *   SENDGRID_FROM_NAME_FALLBACK — display name used when no override supplied (default: "Travelgenix")
 *
 * SendGrid docs: https://docs.sendgrid.com/api-reference/mail-send/mail-send
 */

const SENDGRID_API_KEY    = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@travelify.io';
const FROM_NAME_FALLBACK  = process.env.SENDGRID_FROM_NAME_FALLBACK || 'Travelgenix';
const ENDPOINT            = 'https://api.sendgrid.com/v3/mail/send';

/**
 * Build a valid "from" object for SendGrid given an optional display name.
 *
 * SendGrid expects: { email: "...", name: "..." }
 * The verified domain in SENDGRID_FROM_EMAIL is locked — only the display
 * name changes per email. This is what lets customer-facing emails show
 * the agent's brand ("Travelaire") while the actual address stays on
 * our authenticated domain.
 */
export function buildFromField(displayName) {
  const name = (displayName && String(displayName).trim()) || FROM_NAME_FALLBACK;
  return {
    email: SENDGRID_FROM_EMAIL,
    // Strip characters that would break the header. SendGrid is tolerant
    // but quotes, angle brackets, colons and newlines are all footguns.
    name: name.replace(/["<>\r\n]/g, '').slice(0, 100),
  };
}

/**
 * Send one email via SendGrid. Returns a unified result shape matching
 * what the routing modules expect: {status, error?, id?}.
 *
 * @param {object} params
 * @param {object} params.from       - { email, name } — use buildFromField()
 * @param {string[]} params.to       - array of recipient addresses
 * @param {string} params.subject    - email subject (we cap at 200 chars)
 * @param {string} params.html       - rendered HTML body
 * @param {string} [params.replyTo]  - optional Reply-To address
 * @param {object} [params.headers]  - optional custom headers (e.g. X-TG-Reference)
 * @param {string} [params.categoryTag] - SendGrid category for analytics
 */
export async function sendViaSendGrid({ from, to, subject, html, replyTo, headers, categoryTag }) {
  if (!SENDGRID_API_KEY) {
    return { status: 'failed', error: 'SENDGRID_API_KEY not configured' };
  }
  if (!Array.isArray(to) || to.length === 0) {
    return { status: 'failed', error: 'No recipients supplied' };
  }

  // SendGrid's shape differs from Resend's. Key differences:
  //   - Recipients live inside `personalizations[].to[].email`
  //   - `from` and `reply_to` are objects, not strings
  //   - Custom headers go in top-level `headers` object
  //   - Categories are first-class for analytics
  const body = {
    personalizations: [
      {
        to: to.map(email => ({ email })),
      },
    ],
    from,
    subject: String(subject || '').slice(0, 200),
    content: [
      { type: 'text/html', value: html },
    ],
  };

  if (replyTo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo)) {
    body.reply_to = { email: replyTo };
  }

  if (headers && typeof headers === 'object') {
    // SendGrid rejects headers with certain reserved names. Filter defensively.
    const safe = {};
    const reserved = new Set([
      'x-sg-id', 'x-sg-eid', 'received', 'dkim-signature',
      'content-type', 'content-transfer-encoding', 'to', 'from',
      'subject', 'reply-to', 'cc', 'bcc', 'return-path',
    ]);
    for (const [k, v] of Object.entries(headers)) {
      if (!reserved.has(k.toLowerCase()) && typeof v === 'string') {
        safe[k] = v.slice(0, 1000);
      }
    }
    if (Object.keys(safe).length > 0) body.headers = safe;
  }

  if (categoryTag && typeof categoryTag === 'string') {
    body.categories = [categoryTag.slice(0, 255)];
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // SendGrid returns 202 Accepted on success with no body. Any 4xx/5xx is a fail.
    if (response.status === 202) {
      // SendGrid exposes a message ID in the X-Message-Id header
      const id = response.headers.get('x-message-id') || null;
      return { status: 'ok', id };
    }

    // Parse error response — SendGrid returns {errors: [{message, field, help}]}
    let errorText = `SendGrid returned ${response.status}`;
    try {
      const errorBody = await response.json();
      if (errorBody && Array.isArray(errorBody.errors) && errorBody.errors.length > 0) {
        errorText = errorBody.errors.map(e => e.message).filter(Boolean).join('; ').slice(0, 400);
      }
    } catch (e) {
      // Couldn't parse body — fall back to raw text
      try {
        const raw = await response.text();
        if (raw) errorText = raw.slice(0, 400);
      } catch (e2) { /* give up */ }
    }

    console.error('[sendgrid] send failed', response.status, errorText);
    return { status: 'failed', error: errorText };
  } catch (err) {
    // Network error, timeout, DNS failure — anything that didn't reach SendGrid
    console.error('[sendgrid] network error', err);
    return { status: 'failed', error: err.message || 'Network error contacting SendGrid' };
  }
}
