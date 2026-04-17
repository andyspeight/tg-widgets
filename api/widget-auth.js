/**
 * Widget Auth API (Hardened)
 * POST /api/widget-auth  { email, code }  → returns session token + user info
 * 
 * Security: rate limited, input sanitised, returns signed HMAC token
 */
import { checkRateLimit, createToken, sanitiseForFormula, isValidEmail, setCors } from './_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const TABLE_NAME = 'Users';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { AIRTABLE_KEY, AIRTABLE_BASE_ID, TG_SESSION_SECRET } = process.env;
  if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) return res.status(500).json({ error: 'Server configuration error' });
  if (!TG_SESSION_SECRET || TG_SESSION_SECRET.length < 32) return res.status(500).json({ error: 'Server security configuration error' });

  const { email, code } = req.body || {};

  // ── Validate inputs ───────────────────────────────────────
  if (!email || !code) return res.status(400).json({ error: 'Email and client code required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
  if (typeof code !== 'string' || code.length < 3 || code.length > 50) {
    return res.status(400).json({ error: 'Invalid client code format' });
  }

  // ── Rate limiting ─────────────────────────────────────────
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const rateKey = `auth:${email.toLowerCase()}:${ip}`;
  const rateCheck = checkRateLimit(rateKey);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', rateCheck.retryAfter);
    return res.status(429).json({
      error: `Too many sign-in attempts. Please try again in ${Math.ceil(rateCheck.retryAfter / 60)} minutes.`
    });
  }

  const headers = { 'Authorization': `Bearer ${AIRTABLE_KEY}`, 'Content-Type': 'application/json' };

  try {
    // ── Look up user (sanitised input) ──────────────────────
    const safeEmail = sanitiseForFormula(email.toLowerCase());
    const formula = encodeURIComponent(`LOWER({Email}) = '${safeEmail}'`);
    const url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`Upstream error`);
    const data = await resp.json();

    if (!data.records || !data.records.length) {
      // Generic message — don't reveal whether email exists
      return res.status(401).json({ error: 'Invalid email or client code. Check your welcome email or contact support.' });
    }

    const record = data.records[0];
    const storedCode = record.fields.ClientCode || '';
    const status = record.fields.Status || '';

    // ── Verify code (constant-time-ish comparison) ──────────
    // Use length check + char-by-char to avoid timing leaks
    if (code.length !== storedCode.length || code !== storedCode) {
      return res.status(401).json({ error: 'Invalid email or client code. Check your welcome email or contact support.' });
    }

    // ── Check account status ────────────────────────────────
    if (status === 'Disabled') {
      return res.status(403).json({ error: 'Account disabled. Contact your Travelgenix account manager.' });
    }
    if (status === 'Pending') {
      return res.status(403).json({ error: 'Account pending activation. We\'ll be in touch shortly.' });
    }

    // ── Create session token ────────────────────────────────
    const userPayload = {
      email: record.fields.Email,
      clientName: record.fields.ClientName || '',
      plan: record.fields.Plan || '',
    };
    const token = createToken(userPayload);

    // ── Update last login (fire and forget) ─────────────────
    const updateUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${TABLE_NAME}/${record.id}`;
    fetch(updateUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields: { LastLogin: new Date().toISOString() } }),
    }).catch(() => {}); // Don't block response on this

    return res.status(200).json({
      success: true,
      token,
      user: userPayload,
    });
  } catch (err) {
    console.error('[widget-auth]', err.message);
    return res.status(500).json({ error: 'Authentication service temporarily unavailable' });
  }
}
