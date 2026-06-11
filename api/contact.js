// api/contact.js  — Travelgenix website contact form endpoint
// Receives the contact form POST from the contact page embed and sends the
// enquiry via SendGrid. No secrets ever reach the browser; the form posts here.
//
// Required Vercel env var:
//   SENDGRID_API_KEY            (already set on this project for agent emails)
// Optional env vars:
//   CONTACT_TO                  recipient (default: info@travelgenix.io)
//   CONTACT_FROM                verified SendGrid sender (default: info@travelgenix.io)
//   CONTACT_ALLOWED_ORIGINS     comma-separated CORS allowlist
//   CONTACT_AUTOREPLY           set to "1" to send the submitter a confirmation

const DEFAULT_ORIGINS = ['https://www.travelgenix.io', 'https://travelgenix.io'];
const TO   = process.env.CONTACT_TO   || 'info@travelgenix.io';
const FROM = process.env.CONTACT_FROM || 'info@travelgenix.io';

function allowedOrigins() {
  if (process.env.CONTACT_ALLOWED_ORIGINS) {
    return process.env.CONTACT_ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  }
  return DEFAULT_ORIGINS;
}

// best-effort in-memory rate limit (per warm instance). Hard limiting should be
// layered via Upstash/Cloudflare if abuse appears; honeypot + time-trap below
// are the primary spam defence.
const HITS = new Map();
function rateLimited(ip) {
  const now = Date.now(), WIN = 10 * 60 * 1000, MAX = 5;
  const arr = (HITS.get(ip) || []).filter(t => now - t < WIN);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) {
    for (const [k, v] of HITS) { if (!v.some(t => now - t < WIN)) HITS.delete(k); }
  }
  return arr.length > MAX;
}

const esc = v => String(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = v => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
const emailOK = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 150;

async function sgSend(payload) {
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error('SendGrid ' + r.status + ' ' + detail.slice(0, 300));
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allow = allowedOrigins();
  if (origin && allow.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // block cross-origin posts from outside the allowlist
  if (origin && !allow.includes(origin)) return res.status(403).json({ error: 'Forbidden' });

  if (!process.env.SENDGRID_API_KEY) {
    console.error('[api/contact] SENDGRID_API_KEY missing');
    return res.status(500).json({ error: 'Server not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  // honeypot — a real user never fills this
  if (clean(body.website)) return res.status(200).json({ ok: true });
  // time-trap — reject sub-2.5s submissions (bots)
  const ts = Number(body.ts);
  if (ts && Date.now() - ts < 2500) return res.status(200).json({ ok: true });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (rateLimited(ip)) {
    console.warn('[api/contact] rate limited', ip);
    return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  }

  const name = clean(body.name).slice(0, 100);
  const email = clean(body.email).slice(0, 150);
  const phone = clean(body.phone).slice(0, 40);
  const company = clean(body.company).slice(0, 120);
  const message = clean(body.message).slice(0, 3000);

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!emailOK(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (message.length < 10) return res.status(400).json({ error: 'Message is too short' });

  const rows = [
    ['Name', name], ['Email', email], ['Phone', phone || '—'],
    ['Company', company || '—'],
  ];
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">' +
    '<h2 style="margin:0 0 12px">New website enquiry</h2>' +
    '<table style="border-collapse:collapse">' +
    rows.map(([k, v]) => '<tr><td style="padding:4px 14px 4px 0;color:#64748b;font-weight:bold">' + esc(k) +
      '</td><td style="padding:4px 0">' + esc(v) + '</td></tr>').join('') +
    '</table>' +
    '<p style="margin:16px 0 6px;color:#64748b;font-weight:bold">Message</p>' +
    '<div style="white-space:pre-wrap;padding:12px 14px;background:#f5f7fa;border-radius:8px">' +
    esc(message) + '</div></div>';
  const text = rows.map(([k, v]) => k + ': ' + v).join('\n') + '\n\nMessage:\n' + message;

  try {
    await sgSend({
      personalizations: [{ to: [{ email: TO }] }],
      from: { email: FROM, name: 'Travelgenix Website' },
      reply_to: { email, name },
      subject: 'New enquiry from ' + name,
      content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
    });
  } catch (err) {
    console.error('[api/contact] send failed:', err.message);
    return res.status(502).json({ error: 'Could not send your message right now' });
  }

  // optional courtesy autoreply (best-effort, never fails the request)
  if (process.env.CONTACT_AUTOREPLY === '1') {
    try {
      await sgSend({
        personalizations: [{ to: [{ email, name }] }],
        from: { email: FROM, name: 'Travelgenix' },
        subject: 'Thanks for getting in touch',
        content: [{
          type: 'text/html',
          value: '<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.6">' +
            '<p>Hi ' + esc(name.split(' ')[0] || name) + ',</p>' +
            '<p>Thanks for getting in touch with Travelgenix. We have your message and a real person will come back to you shortly.</p>' +
            '<p>If it is urgent, call us on +44 (0) 1202 934033.</p>' +
            '<p>The Travelgenix team</p></div>',
        }],
      });
    } catch (err) {
      console.warn('[api/contact] autoreply failed (non-fatal):', err.message);
    }
  }

  return res.status(200).json({ ok: true });
}
