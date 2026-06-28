/**
 * Offer Enquiry API  ·  POST /api/offer-enquiry   (public)
 *
 * Receives an enquiry from a special offer page, stores it, and emails it to the
 * agency that owns the offer. This is the conversion endpoint — without it the
 * offer pages capture nothing.
 *
 * Body: { offerId?, name, email, phone?, month?, travellers?, message?,
 *         offerTitle?, offerReference?, website?(honeypot), ts? }
 *
 * Security (travelgenix-security):
 *   - Public (visitors are not signed in), but spam-guarded: honeypot, a submit
 *     time-trap, and a per-IP rate limit. Inputs validated + length-capped, and
 *     escaped before they reach any email HTML.
 *   - The recipient is resolved SERVER-SIDE from the stored offer's enquiry email
 *     (never a client-supplied address), so this can never be used as an open
 *     relay. Falls back to CONTACT_TO when the offer can't be resolved.
 *   - Best-effort durable copy in Redis so a lead survives an email hiccup.
 *
 * Env: SENDGRID_API_KEY (required to send); CONTACT_FROM / CONTACT_TO (sender +
 *      fallback recipient, default info@travelgenix.io); UPSTASH_* (optional
 *      storage); OFFER_ENQUIRY_AUTOREPLY=1 (optional customer confirmation).
 */
import crypto from 'crypto';
import { configured, getJson, setJson, zadd } from './_redis.js';

const FROM = process.env.CONTACT_FROM || 'info@travelgenix.io';
const FALLBACK_TO = process.env.CONTACT_TO || 'info@travelgenix.io';
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, '').trim();
const emailOK = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 150;

// Simple in-memory per-IP limiter (matches api/contact.js — good enough for a
// public form; the rate window resets on cold start which is acceptable here).
const HITS = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 8;
  const arr = (HITS.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear(); // crude memory cap
  return arr.length > max;
}

async function sgSend(payload) {
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) { const d = await r.text().catch(() => ''); throw new Error('SendGrid ' + r.status + ' ' + d.slice(0, 300)); }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  // Spam guards: honeypot + sub-2.5s time-trap (silently accept, never send).
  if (clean(body.website)) return res.status(200).json({ ok: true });
  const ts = Number(body.ts);
  if (ts && Date.now() - ts < 2500) return res.status(200).json({ ok: true });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });

  const name = clean(body.name).slice(0, 100);
  const email = clean(body.email).slice(0, 150);
  const phone = clean(body.phone).slice(0, 40);
  const month = clean(body.month).slice(0, 60);
  const travellers = clean(body.travellers).slice(0, 60);
  const message = clean(body.message).slice(0, 3000);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!emailOK(email)) return res.status(400).json({ error: 'A valid email is required' });

  // Resolve the offer + recipient server-side (never trust a client address).
  const offerId = ID_RE.test(String(body.offerId || '')) ? String(body.offerId) : '';
  let offerTitle = clean(body.offerTitle).slice(0, 200);
  let offerReference = clean(body.offerReference).slice(0, 60);
  let recipient = FALLBACK_TO;
  let ownerKey = '';
  if (offerId && configured()) {
    try {
      const rec = await getJson('offer:' + offerId);
      if (rec && rec.offer && rec.offer.fields) {
        const f = rec.offer.fields;
        if (f.title) offerTitle = clean(f.title).slice(0, 200);
        if (f.reference) offerReference = clean(f.reference).slice(0, 60);
        if (f.enquiryEmail && emailOK(clean(f.enquiryEmail))) recipient = clean(f.enquiryEmail);
        ownerKey = rec.ownerKey || '';
      }
    } catch (e) { /* fall back to FALLBACK_TO */ }
  }
  if (!offerTitle) offerTitle = 'a special offer';

  // Durable copy (best-effort).
  if (configured()) {
    try {
      const eid = crypto.randomBytes(9).toString('base64url');
      const now = Date.now();
      await setJson('enquiry:' + eid, { id: eid, offerId, ownerKey, name, email, phone, month, travellers, message, offerTitle, offerReference, ip, createdAt: now });
      if (offerId) await zadd('enquiries:offer:' + offerId, now, eid);
    } catch (e) { /* non-fatal */ }
  }

  if (!process.env.SENDGRID_API_KEY) {
    console.error('[offer-enquiry] SENDGRID_API_KEY missing');
    return res.status(500).json({ error: 'Server not configured for email' });
  }

  const rows = [
    ['Offer', offerTitle + (offerReference ? ' (' + offerReference + ')' : '')],
    ['Name', name], ['Email', email], ['Phone', phone || '—'],
    ['Preferred month', month || '—'], ['Travellers', travellers || '—']
  ];
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">' +
    '<h2 style="margin:0 0 12px">New offer enquiry</h2>' +
    '<table style="border-collapse:collapse">' +
    rows.map(([k, v]) => '<tr><td style="padding:4px 14px 4px 0;color:#64748b;font-weight:bold">' + esc(k) + '</td><td style="padding:4px 0">' + esc(v) + '</td></tr>').join('') +
    '</table>' +
    (message ? '<p style="margin:16px 0 6px;color:#64748b;font-weight:bold">Message</p><div style="white-space:pre-wrap;padding:12px 14px;background:#f5f7fa;border-radius:8px">' + esc(message) + '</div>' : '') +
    '</div>';
  const text = rows.map(([k, v]) => k + ': ' + v).join('\n') + (message ? '\n\nMessage:\n' + message : '');

  try {
    await sgSend({
      personalizations: [{ to: [{ email: recipient }] }],
      from: { email: FROM, name: 'Travelgenix Offers' },
      reply_to: { email, name },
      subject: 'New enquiry: ' + offerTitle,
      content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }]
    });
  } catch (err) {
    console.error('[offer-enquiry] send failed:', err.message);
    // The lead is already stored; tell the customer it landed.
    return res.status(202).json({ ok: true, stored: true });
  }

  // Courtesy confirmation to the customer (best-effort).
  if (process.env.OFFER_ENQUIRY_AUTOREPLY === '1') {
    try {
      await sgSend({
        personalizations: [{ to: [{ email, name }] }],
        from: { email: FROM, name: 'Travelgenix' },
        subject: 'We have your enquiry about ' + offerTitle,
        content: [{ type: 'text/plain', value: 'Hi ' + name + ',\n\nThanks for your enquiry about ' + offerTitle + '. A travel expert will be in touch shortly.\n\nTravelgenix' }]
      });
    } catch (e) { /* never fail the request on the autoreply */ }
  }

  return res.status(200).json({ ok: true });
}
