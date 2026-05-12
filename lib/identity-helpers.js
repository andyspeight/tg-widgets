/**
 * Identity Console — shared helpers (ESM)
 *
 * Matches the module style of the existing tg-widgets project (Enquiry Form,
 * widget-config, etc — all ESM with `export`/`import`).
 *
 * Single source of truth for:
 *   - requireOwner(req, res)      → gates every /api/identity/* route to owner role on widget_suite
 *   - airtableFetch(...)          → thin Airtable REST wrapper that throws on non-2xx
 *   - generateClientCode()        → STAFF-XXXX-XXXX style temporary password
 *   - sendWelcomeEmail({...})     → SendGrid send, no-ops cleanly if SENDGRID_API_KEY is unset
 *   - escapeHtml(s)               → for email render
 *   - applyCors(req, res)         → echoes a validated travelify.io origin only
 *
 * Reads from env only (no client-side secrets). Imported by every /api/identity/* file.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export const AT_BASE = 'appAYzWZxvK6qlwXK';
export const T_USERS = 'tblikekpaTKraMktZ';
export const T_PRODUCTS = 'tbl8gafdldQyps4JN';
export const T_PERMISSIONS = 'tblfuVxtQyaNRYBrB';

const PAT = process.env.AIRTABLE_PAT;
const JWT_SECRET = process.env.JWT_SECRET;
const SENDGRID_API_KEY    = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@travelify.io';
const FROM_NAME_FALLBACK  = process.env.SENDGRID_FROM_NAME_FALLBACK || 'Travelgenix';
const SIGNIN_URL = 'https://id.travelify.io/signin.html';

// -------------------------------------------------------------------------------------------------
// CORS — strict allowlist of *.travelify.io subdomains
// -------------------------------------------------------------------------------------------------
const ALLOWED_ORIGINS = new Set([
  'https://id.travelify.io',
  'https://widgets.travelify.io',
  'https://marketing.travelify.io',
  'https://chat.travelify.io',
  'https://trends.travelify.io',
]);

export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

// -------------------------------------------------------------------------------------------------
// Auth gate — requires a tg_session cookie AND owner role on widget_suite
// -------------------------------------------------------------------------------------------------
function readSessionCookie(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)tg_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function requireOwner(req, res) {
  const token = readSessionCookie(req);
  if (!token) {
    res.status(401).json({ ok: false, code: 'no_token', error: 'Authentication required' });
    return null;
  }

  if (!JWT_SECRET) {
    console.error('[requireOwner] JWT_SECRET not set in env');
    res.status(500).json({ ok: false, error: 'Server misconfigured' });
    return null;
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ ok: false, code: 'bad_token', error: 'Invalid or expired session' });
    return null;
  }

  // The JWT payload shape from /api/auth/signin: { userId, email, recordId, ... }
  // Different past iterations used different field names — try both.
  const userRecordId = payload.recordId || payload.userId || payload.sub;
  if (!userRecordId) {
    res.status(401).json({ ok: false, code: 'bad_token', error: 'Session missing user id' });
    return null;
  }

  // Confirm owner role on widget_suite by looking it up live (no stale cache for admin actions)
  try {
    const filter = `AND(FIND('${userRecordId}', ARRAYJOIN({User})), FIND('widget_suite', ARRAYJOIN({Product Slug})))`;
    const permsRes = await airtableFetch(
      `${T_PERMISSIONS}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=10`
    );

    const owns = (permsRes.records || []).some((r) => {
      const role = (r.fields.Role || '').toLowerCase();
      const status = (r.fields.Status || 'Active').toLowerCase();
      return role === 'owner' && status === 'active';
    });

    if (!owns) {
      res.status(403).json({ ok: false, code: 'forbidden', error: 'Admin access only' });
      return null;
    }

    return { userId: userRecordId, email: payload.email || '', recordId: userRecordId };
  } catch (err) {
    console.error('[requireOwner] permission check failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to verify access' });
    return null;
  }
}

// -------------------------------------------------------------------------------------------------
// Airtable REST wrapper — uses field NAMES (returnFieldsByFieldId left default)
// -------------------------------------------------------------------------------------------------
export async function airtableFetch(pathAndQuery, init = {}) {
  if (!PAT) {
    throw new Error('AIRTABLE_PAT not set in env');
  }
  const url = `https://api.airtable.com/v0/${AT_BASE}/${pathAndQuery}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Airtable ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// -------------------------------------------------------------------------------------------------
// ClientCode generator — STAFF-XXXX-XXXX (8 chars uppercase, ambiguous chars stripped)
// -------------------------------------------------------------------------------------------------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
export function generateClientCode(prefix = 'STAFF') {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3) out += '-';
  }
  return `${prefix}-${out}`;
}

// -------------------------------------------------------------------------------------------------
// HTML escape (for email render)
// -------------------------------------------------------------------------------------------------
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// -------------------------------------------------------------------------------------------------
// Welcome email — Transactional archetype. No-ops cleanly if SENDGRID_API_KEY isn't set.
// Mirrors the existing pattern from the Enquiry Form widget so the codebase stays consistent.
// -------------------------------------------------------------------------------------------------
export async function sendWelcomeEmail({ to, fullName, clientCode, productNames }) {
  if (!SENDGRID_API_KEY) {
    return { sent: false, reason: 'SENDGRID_API_KEY not configured' };
  }

  const subject = 'Your Travelgenix sign-in details';
  const html = renderWelcomeHtml({ fullName, email: to, clientCode, productNames });
  const text = renderWelcomeText({ fullName, email: to, clientCode, productNames });

  const payload = {
    personalizations: [{ to: [{ email: to, name: fullName }] }],
    from: {
      email: SENDGRID_FROM_EMAIL,
      name: FROM_NAME_FALLBACK.replace(/["<>\r\n]/g, '').slice(0, 100),
    },
    subject: String(subject).slice(0, 200),
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html',  value: html },
    ],
    categories: ['identity-welcome'],
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
    },
  };

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 202) {
    const messageId = res.headers.get('x-message-id') || null;
    return { sent: true, id: messageId };
  }

  const body = await res.text().catch(() => '');
  console.error('[sendWelcomeEmail] SendGrid', res.status, body);
  return { sent: false, reason: `SendGrid ${res.status}` };
}

function renderWelcomeHtml({ fullName, email, clientCode, productNames }) {
  const productList = (productNames || [])
    .map((p) => `<li style="margin:0 0 6px 0;padding:0;font-size:15px;line-height:1.5;color:#0F172A;">${escapeHtml(p)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Your Travelgenix sign-in details</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">Sign in at id.travelify.io with the code below.</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1F5F9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,0.06);">

        <tr><td style="background:#1B2B5B;padding:20px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:16px;font-weight:600;color:#FFFFFF;letter-spacing:-0.01em;">Travelgenix</td>
              <td align="right" style="font-size:12px;color:#94A3B8;letter-spacing:0.04em;text-transform:uppercase;">Account access</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:40px 32px 16px 32px;">
          <div style="width:48px;height:48px;border-radius:24px;background:#ECFDF5;display:inline-block;line-height:48px;text-align:center;margin-bottom:16px;">
            <span style="display:inline-block;vertical-align:middle;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;">
                <path d="M5 12l5 5 9-9" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </div>
          <h1 style="margin:0 0 8px 0;padding:0;font-size:24px;line-height:1.25;font-weight:700;color:#0F172A;letter-spacing:-0.02em;">You've been given access to Travelgenix</h1>
          <p style="margin:0;padding:0;font-size:15px;line-height:1.6;color:#475569;">Hi ${escapeHtml(fullName)}, your account is ready. Use the details below to sign in.</p>
        </td></tr>

        <tr><td style="padding:8px 32px 0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;">
            <tr><td style="padding:20px 24px;border-bottom:1px solid #E2E8F0;">
              <div style="font-size:11px;line-height:1.4;color:#94A3B8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">Sign in at</div>
              <a href="${escapeHtml(SIGNIN_URL)}" style="font-size:16px;line-height:1.5;color:#1B2B5B;text-decoration:none;font-weight:600;">id.travelify.io</a>
            </td></tr>
            <tr><td style="padding:20px 24px;border-bottom:1px solid #E2E8F0;">
              <div style="font-size:11px;line-height:1.4;color:#94A3B8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">Email</div>
              <div style="font-size:15px;line-height:1.5;color:#0F172A;font-weight:500;">${escapeHtml(email)}</div>
            </td></tr>
            <tr><td style="padding:20px 24px;">
              <div style="font-size:11px;line-height:1.4;color:#94A3B8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">Access code</div>
              <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:18px;line-height:1.4;color:#0F172A;font-weight:600;letter-spacing:0.02em;">${escapeHtml(clientCode)}</div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td align="center" style="padding:28px 32px 8px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="background:#1B2B5B;border-radius:8px;">
              <a href="${escapeHtml(SIGNIN_URL)}" style="display:inline-block;padding:14px 28px;font-size:15px;line-height:1;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:-0.01em;">Sign in to Travelgenix</a>
            </td></tr>
          </table>
        </td></tr>

        ${productList ? `<tr><td style="padding:24px 32px 8px 32px;">
          <div style="font-size:13px;line-height:1.4;color:#94A3B8;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;margin-bottom:12px;">What you can access</div>
          <ul style="margin:0;padding:0 0 0 18px;list-style:disc;color:#475569;">${productList}</ul>
        </td></tr>` : ''}

        <tr><td style="padding:24px 32px 8px 32px;">
          <div style="font-size:13px;line-height:1.4;color:#94A3B8;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;margin-bottom:12px;">Next steps</div>
          <ol style="margin:0;padding:0 0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
            <li style="margin-bottom:6px;">Open <a href="${escapeHtml(SIGNIN_URL)}" style="color:#1B2B5B;text-decoration:underline;">id.travelify.io</a> and sign in with the details above.</li>
            <li style="margin-bottom:6px;">You'll land on the dashboard for each product you have access to.</li>
            <li>Keep this email — your access code is what you use as your password.</li>
          </ol>
        </td></tr>

        <tr><td style="padding:24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border-radius:8px;">
            <tr><td style="padding:16px 20px;">
              <div style="font-size:13px;line-height:1.5;color:#475569;">
                <strong style="color:#0F172A;">Didn't request this?</strong> Reply to this email and we'll look into it straight away. The access code only works at <span style="color:#0F172A;font-weight:500;">id.travelify.io</span> and can be revoked at any time.
              </div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="background:#F8FAFC;padding:20px 32px;border-top:1px solid #E2E8F0;">
          <div style="font-size:12px;line-height:1.5;color:#94A3B8;">
            Travelgenix · Bournemouth, UK · Part of Agendas Group<br>
            This is a transactional email about your Travelgenix account.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderWelcomeText({ fullName, email, clientCode, productNames }) {
  const products = (productNames || []).map((p) => `  - ${p}`).join('\n');
  return [
    `Hi ${fullName},`,
    '',
    `You've been given access to Travelgenix. Use the details below to sign in:`,
    '',
    `  Sign in at: ${SIGNIN_URL}`,
    `  Email:      ${email}`,
    `  Code:       ${clientCode}`,
    '',
    products ? `What you can access:\n${products}\n` : '',
    `Keep this email — your access code is what you use as your password.`,
    '',
    `Didn't request this? Reply to this email and we'll look into it.`,
    '',
    `— Travelgenix`,
  ].filter(Boolean).join('\n');
}
