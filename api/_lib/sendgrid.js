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
//  We send from SENDGRID_FROM_EMAIL (a domain we control with SPF/DKIM
//  aligned) and use Reply-To for the agent's actual address. The ONE exception
//  is a client whose own domain is authenticated in this SendGrid account
//  (DKIM + return-path CNAMEs on their DNS): canSendFrom() below says yes for
//  those, and the caller may then use the client's address as the From. Never
//  send "from" a domain that is not authenticated — every major provider
//  checks the client's own DMARC and would mark it as spam or refuse it.
//  (Andy's call, 20 Jul 2026, first applied to the Enquiry widget; the check
//  was lifted here on 8 Sep 2026 so the Quote PDF widget shares it.)
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

// ---------------------------------------------------------------------------
// Client-domain sending.
//
// A client's domain counts as authenticated when EITHER
//   1. TG_AUTHENTICATED_SENDER_DOMAINS (comma-separated env allowlist) names
//      it — checked first, so this works even when the API key lacks the
//      Sender Authentication read scope; or
//   2. SendGrid's own GET /v3/whitelabel/domains lists it as valid — cached
//      in-module for 10 minutes so a burst of sends is one lookup.
// Anything else is NOT authenticated and the platform sender must be used.
// ---------------------------------------------------------------------------

const DOMAIN_CACHE_TTL_MS = 10 * 60 * 1000;
let domainCache = { at: 0, domains: null };

/** The platform's verified sender address, for display and fallbacks. */
export function platformSenderEmail() {
  return process.env.SENDGRID_FROM_EMAIL || 'noreply@travelify.io';
}

/** The domain part of an email address, lower-cased, or null. */
export function domainOf(email) {
  const m = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(String(email || '').trim().toLowerCase());
  return m ? m[1] : null;
}

function envSenderDomains() {
  return String(process.env.TG_AUTHENTICATED_SENDER_DOMAINS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export async function fetchAuthenticatedDomains() {
  const now = Date.now();
  if (domainCache.domains && now - domainCache.at < DOMAIN_CACHE_TTL_MS) return domainCache.domains;
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return [];
  try {
    const r = await fetch('https://api.sendgrid.com/v3/whitelabel/domains?limit=100', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const list = await r.json();
    const domains = (Array.isArray(list) ? list : [])
      .filter(d => d && d.valid)
      .map(d => String(d.domain || '').toLowerCase())
      .filter(Boolean);
    domainCache = { at: now, domains };
    return domains;
  } catch (err) {
    // Key without the read scope, network blip, etc. Cache the empty answer
    // too, so a broken key warns once per instance per TTL, not once per send.
    console.warn('[sendgrid] authenticated-domain lookup failed (platform sender used):', err.message);
    domainCache = { at: now, domains: [] };
    return [];
  }
}

/**
 * May we send FROM this address? True only when its domain (or a parent
 * domain) is authenticated in this SendGrid account. Never throws.
 */
export async function canSendFrom(email) {
  const domain = domainOf(email);
  if (!domain) return false;
  const matches = (list) => list.some(d => domain === d || domain.endsWith('.' + d));
  if (matches(envSenderDomains())) return true;
  return matches(await fetchAuthenticatedDomains());
}

/**
 * Resolve the From identity for a client-branded email: the client's own
 * address when its domain is authenticated, otherwise the platform sender.
 * The display name behaves exactly like buildFromField.
 */
export async function resolveSender(displayName, preferredEmail) {
  const base = buildFromField(displayName);
  if (!(await canSendFrom(preferredEmail))) return base;
  return { ...base, email: String(preferredEmail).trim() };
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
