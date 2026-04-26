/**
 * Travelgenix Widget Suite — Retrieve Order (public endpoint)
 *
 * Called by embedded My Booking widget. NO auth header — widgets embed on any
 * client site without auth. Security relies on:
 *   1. Rate limiting (per IP and per IP+widget)
 *   2. Generic error messages (no info leakage about which field was wrong)
 *   3. Server-side credential lookup (creds never touch browser)
 *   4. Sanitised response (raw Travelify JSON never returned)
 *
 * Flow:
 *   1. POST { widgetId, emailAddress, departDate, orderRef }
 *   2. Look up widget → ClientEmail
 *   3. Look up active Travelify integration for that client → AppId + encrypted key
 *   4. Decrypt key
 *   5. Call Travelify POST /account/order with Token AppId:Key auth
 *   6. Trim + sanitise response
 *   7. Return safe subset
 *
 * Endpoint:
 *   POST /api/retrieve-order
 */

import { setCors, sanitiseForFormula } from './_auth.js';
import { decrypt } from './_crypto.js';

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';
const INTEGRATIONS_TABLE = 'tblpzQpwmcTvUeHcF';

// Widgets table fields
const WF = {
  WidgetID: 'fldXkwI3mmSrKeY9N', // typical widget id field — we'll lookup by formula on Name match if needed
  ClientEmail: 'fldppykJf1w4YvFNC',
  WidgetType: null, // resolved by name in formula
  Status: null,
};

// Integrations table fields
const IF = {
  IntegrationID:    'fldIZBDjX5lNJDf1S',
  ClientEmail:      'flditBgdp6egbk3Fb',
  Service:          'fld0TP0kypkfOOJF6',
  AppId:            'fldCXwCixuvqN2HMy',
  ApiKeyEncrypted:  'fldpb4JQRSuot0Gg2',
  Status:           'fldEVMrKnEpFaxORk',
  LastUsedAt:       'fldQgOjcM3sfKL7uB',
};

const TRAVELIFY_API = 'https://api.travelify.io/account/order';

// ----- Demo bypass -----
// When widgetId === DEMO_WIDGET_SENTINEL, skip the Airtable widget + integration
// lookups and use the demo Travelify credentials from env vars. This is for the
// public /demo-mybooking.html standalone test page.
//
// SAFETY:
//   - Only triggers on the literal string 'DEMO_WIDGET_ID'. Real widgets use
//     the tgw_{ts}_{rand} format so there is no collision risk.
//   - The demo creds MUST point at the Travelify demo App (currently 250) with
//     synthetic bookings only. Never point them at a real client's App.
//   - Validation, rate limiting, and response sanitisation still run.
//   - If either env var is missing the demo path fails closed (notFound).
const DEMO_WIDGET_SENTINEL = 'DEMO_WIDGET_ID';

// ----- Rate limiting (in-memory, same pattern as _auth.js) -----

const rateLimitStore = new Map(); // key -> { count, resetAt }
const RL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function rateLimit(key, max) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // Cleanup expired entries periodically
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (v.resetAt < now) rateLimitStore.delete(k);
    }
  }

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return { ok: true, remaining: max - 1 };
  }
  if (entry.count >= max) {
    return { ok: false, remaining: 0, retryAfterMs: entry.resetAt - now };
  }
  entry.count++;
  return { ok: true, remaining: max - entry.count };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// ----- Validation -----

function validateEmail(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  // Reasonable email regex — not RFC-5322 perfect but blocks obvious junk
  if (v.length < 5 || v.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

function validateDate(s) {
  if (typeof s !== 'string') return null;
  // Strict yyyy-MM-dd
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  // Sanity bounds: 2020-01-01 to 2050-12-31
  const yr = parseInt(s.slice(0, 4), 10);
  if (yr < 2020 || yr > 2050) return null;
  return s;
}

function validateOrderRef(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toUpperCase();
  // Alphanumeric + dash + underscore, 3–40 chars
  if (!/^[A-Z0-9_\-]{3,40}$/.test(v)) return null;
  return v;
}

function validateWidgetId(s) {
  if (typeof s !== 'string') return null;
  // Widget IDs follow tgw_{ts}_{rand} pattern. Be permissive but bounded.
  if (!/^[a-zA-Z0-9_\-]{8,80}$/.test(s)) return null;
  return s;
}

// ----- Airtable helpers -----

function airtableHeaders() {
  const key = process.env.AIRTABLE_KEY;
  if (!key) throw new Error('AIRTABLE_KEY env var missing');
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function findWidgetById(widgetId) {
  const safe = sanitiseForFormula(widgetId);
  const formula = `{WidgetID}='${safe}'`;
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${WIDGETS_TABLE}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('maxRecords', '1');

  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) throw new Error(`Widget lookup failed: ${res.status}`);
  const data = await res.json();
  return data.records?.[0] || null;
}

async function findActiveTravelifyIntegration(clientEmail) {
  const safeEmail = sanitiseForFormula(clientEmail);
  const formula = `AND({${IF.ClientEmail}}='${safeEmail}',{${IF.Service}}='Travelify',{${IF.Status}}='Active')`;

  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${INTEGRATIONS_TABLE}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('maxRecords', '1');
  url.searchParams.set('returnFieldsByFieldId', 'true');

  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) throw new Error(`Integration lookup failed: ${res.status}`);
  const data = await res.json();
  return data.records?.[0] || null;
}

async function touchLastUsed(recordId) {
  // Fire-and-forget; don't block response on this
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${INTEGRATIONS_TABLE}`;
  const body = JSON.stringify({
    records: [{ id: recordId, fields: { [IF.LastUsedAt]: new Date().toISOString() } }],
  });
  fetch(url, { method: 'PATCH', headers: airtableHeaders(), body }).catch(() => {});
}

// ----- Travelify response sanitisation -----

function safeStr(v, max = 500) {
  if (v == null) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function safeNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function sanitiseHotelDescription(text) {
  if (typeof text !== 'string') return null;
  // Strip HTML tags to be safe; widget will render as text
  return text.replace(/<[^>]*>/g, '').slice(0, 4000);
}

function sanitiseImageUrl(u) {
  if (typeof u !== 'string') return null;
  // Only allow https URLs
  if (!/^https:\/\/[^\s]+$/i.test(u)) return null;
  if (u.length > 500) return null;
  return u;
}

function trimItem(item) {
  if (!item || typeof item !== 'object') return null;
  const out = {
    id: safeNum(item.id),
    status: safeStr(item.status, 30),
    product: safeStr(item.product, 30),
    bookingReference: safeStr(item.bookingReference, 100),
    price: safeNum(item.price),
    currency: safeStr(item.originalCurrency, 10),
    startDate: safeStr(item.startDate, 30),
    duration: safeNum(item.duration),
  };

  // Accommodation-specific data (most common)
  if (item.product === 'Accommodation' && item.dataObject) {
    const d = item.dataObject;
    out.accommodation = {
      name: safeStr(d.name, 200),
      propertyType: safeStr(d.propertyType, 60),
      rating: safeNum(d.rating),
      location: d.location ? {
        address1: safeStr(d.location.address1, 300),
        city: safeStr(d.location.city, 100),
        state: safeStr(d.location.state, 100),
        country: safeStr(d.location.country, 10),
        latitude: safeNum(d.location.latitude),
        longitude: safeNum(d.location.longitude),
      } : null,
      review: d.review ? {
        rating: safeNum(d.review.rating),
        reviews: safeNum(d.review.reviews),
        platform: safeStr(d.review.platform, 30),
      } : null,
      pricing: d.pricing ? {
        currency: safeStr(d.pricing.currency, 10),
        price: safeNum(d.pricing.price),
        memberPrice: safeNum(d.pricing.memberPrice),
        inResortFees: safeNum(d.pricing.inResortFees),
        isRefundable: !!d.pricing.isRefundable,
        refundability: safeStr(d.pricing.refundability, 30),
        depositOptions: Array.isArray(d.pricing.depositOptions)
          ? d.pricing.depositOptions.slice(0, 5).map(opt => ({
              id: safeNum(opt.id),
              name: safeStr(opt.name, 60),
              amount: safeNum(opt.amount),
              dueDate: safeStr(opt.dueDate, 30),
              installments: safeNum(opt.installments),
              installmentsAmount: safeNum(opt.installmentsAmount),
              breakdown: Array.isArray(opt.breakdown)
                ? opt.breakdown.slice(0, 12).map(b => ({
                    num: safeNum(b.num),
                    amount: safeNum(b.amount),
                    dueDate: safeStr(b.dueDate, 30),
                  }))
                : [],
            }))
          : [],
      } : null,
      descriptions: Array.isArray(d.descriptions)
        ? d.descriptions.slice(0, 10).map(desc => ({
            type: safeStr(desc.type, 40),
            title: safeStr(desc.title, 100),
            text: sanitiseHotelDescription(desc.text),
          })).filter(x => x.text)
        : [],
      amenities: Array.isArray(d.amenities)
        ? d.amenities.slice(0, 30).map(a => safeStr(a, 60)).filter(Boolean)
        : [],
      goodFor: Array.isArray(d.goodFor)
        ? d.goodFor.slice(0, 10).map(g => safeStr(g, 60)).filter(Boolean)
        : [],
      media: Array.isArray(d.media)
        ? d.media.slice(0, 12).map(m => ({
            type: safeStr(m.type, 40),
            url: sanitiseImageUrl(m.url),
            caption: safeStr(m.caption, 200),
          })).filter(m => m.url)
        : [],
      units: Array.isArray(d.units)
        ? d.units.slice(0, 5).map(u => ({
            name: safeStr(u.name, 200),
            roomType: safeStr(u.roomType, 60),
            checkin: safeStr(u.checkin, 30),
            nights: safeNum(u.nights),
            sleeps: safeStr(u.sleeps, 100),
            sleepsAdults: safeNum(u.sleepsAdults),
            sleepsChildren: safeNum(u.sleepsChildren),
            rates: Array.isArray(u.rates)
              ? u.rates.slice(0, 3).map(r => ({
                  name: safeStr(r.name, 100),
                  board: safeStr(r.board, 40),
                  descriptions: Array.isArray(r.descriptions)
                    ? r.descriptions.slice(0, 6).map(rd => ({
                        type: safeStr(rd.type, 40),
                        title: safeStr(rd.title, 100),
                        text: sanitiseHotelDescription(rd.text),
                      })).filter(x => x.text)
                    : [],
                }))
              : [],
          }))
        : [],
      guests: Array.isArray(d.guests)
        ? d.guests.slice(0, 12).map(g => ({
            type: safeStr(g.type, 30),
            title: safeStr(g.title, 30),
            firstname: safeStr(g.firstname, 80),
            surname: safeStr(g.surname, 80),
          }))
        : [],
    };
  }

  return out;
}

function trimOrder(raw) {
  if (!raw || typeof raw !== 'object') return null;

  return {
    id: safeNum(raw.id),
    status: safeStr(raw.status, 30),
    customerTitle: safeStr(raw.customerTitle, 30),
    customerFirstname: safeStr(raw.customerFirstname, 80),
    customerSurname: safeStr(raw.customerSurname, 80),
    customerEmail: safeStr(raw.customerEmail, 254),
    specialRequests: safeStr(raw.specialRequests, 1000),
    currency: safeStr(raw.currency, 10),
    created: safeStr(raw.created, 30),
    items: Array.isArray(raw.items) ? raw.items.slice(0, 8).map(trimItem).filter(Boolean) : [],
    documents: Array.isArray(raw.documents)
      ? raw.documents.slice(0, 20).map(doc => ({
          name: safeStr(doc.name, 200),
          ext: safeStr(doc.ext, 10),
          size: safeNum(doc.size),
          url: sanitiseImageUrl(doc.url), // same https-only check works
          created: safeStr(doc.created, 30),
        })).filter(d => d.url)
      : [],
  };
}

// ----- Generic error response (no info leak) -----

function notFound(res) {
  return res.status(404).json({
    error: 'not_found',
    message: "We couldn't find a confirmed booking with those details.",
  });
}

// ----- HTTP handler -----

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limiting
  const ip = getClientIp(req);
  const ipLimit = rateLimit(`ro:ip:${ip}`, 5);
  if (!ipLimit.ok) {
    return res.status(429).json({
      error: 'too_many_attempts',
      message: 'Too many lookup attempts. Please wait 15 minutes and try again.',
      retryAfterMs: ipLimit.retryAfterMs,
    });
  }

  // Parse body
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return notFound(res);
  }

  // Validate inputs
  const widgetId = validateWidgetId(body.widgetId);
  const emailAddress = validateEmail(body.emailAddress);
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);

  if (!widgetId || !emailAddress || !departDate || !orderRef) {
    // Generic — don't tell the attacker which field was bad
    return notFound(res);
  }

  // Per-IP+widget rate limit
  const widgetLimit = rateLimit(`ro:ipw:${ip}:${widgetId}`, 30);
  if (!widgetLimit.ok) {
    return res.status(429).json({
      error: 'too_many_attempts',
      message: 'Too many lookup attempts for this booking widget. Please try again later.',
      retryAfterMs: widgetLimit.retryAfterMs,
    });
  }

  try {
    let appId;
    let apiKey;
    let integrationId = null; // for LastUsedAt update; null on demo path

    if (widgetId === DEMO_WIDGET_SENTINEL) {
      // ----- Demo path -----
      appId = process.env.TRAVELIFY_DEMO_APPID;
      apiKey = process.env.TRAVELIFY_DEMO_KEY;
      if (!appId || !apiKey) {
        console.warn('Demo lookup attempted but TRAVELIFY_DEMO_APPID / TRAVELIFY_DEMO_KEY not configured');
        return notFound(res);
      }
    } else {
      // ----- Real client path -----
      // 1. Find widget → owning client
      const widget = await findWidgetById(widgetId);
      if (!widget) return notFound(res);

      const widgetType = widget.fields?.WidgetType;
      if (widgetType !== 'My Booking') return notFound(res);

      const widgetStatus = widget.fields?.Status;
      if (widgetStatus && widgetStatus !== 'Active' && widgetStatus !== 'Draft') {
        return notFound(res);
      }

      const clientEmail = (widget.fields?.ClientEmail || '').toLowerCase().trim();
      if (!clientEmail) return notFound(res);

      // 2. Find active Travelify integration for this client
      const integration = await findActiveTravelifyIntegration(clientEmail);
      if (!integration) {
        console.warn(`No active Travelify integration for client (widgetId=${widgetId})`);
        return notFound(res);
      }

      const integrationAppId = integration.fields?.[IF.AppId];
      const apiKeyEncrypted = integration.fields?.[IF.ApiKeyEncrypted];
      if (!integrationAppId || !apiKeyEncrypted) return notFound(res);

      // 3. Decrypt
      try {
        apiKey = decrypt(apiKeyEncrypted);
      } catch (e) {
        console.error('Decryption failed for integration', integration.id, ':', e.message);
        return notFound(res);
      }
      appId = integrationAppId;
      integrationId = integration.id;
    }

    // 4. Call Travelify
    const travelifyRes = await fetch(TRAVELIFY_API, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${appId}:${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        emailAddress,
        departDate,
        orderRef,
      }),
      // Hard timeout via AbortController
      signal: AbortSignal.timeout(12000),
    });

    if (travelifyRes.status === 404) {
      return notFound(res);
    }
    if (!travelifyRes.ok) {
      console.error(`Travelify returned ${travelifyRes.status} for widget ${widgetId}`);
      return notFound(res);
    }

    let raw;
    try {
      raw = await travelifyRes.json();
    } catch {
      return notFound(res);
    }

    // Travelify's documented 404 shape is { code: '404', message: ... }
    if (raw && (raw.code === '404' || raw.code === 404)) {
      return notFound(res);
    }

    // 5. Trim + sanitise
    const order = trimOrder(raw);
    if (!order || !order.id) return notFound(res);

    // 6. Async update LastUsedAt (skipped on demo path — no integration record)
    if (integrationId) touchLastUsed(integrationId);

    return res.status(200).json({ order });
  } catch (err) {
    console.error('retrieve-order error:', err.message);
    return notFound(res);
  }
}
