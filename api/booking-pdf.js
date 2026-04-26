/**
 * Travelgenix Widget Suite — Booking PDF (public endpoint)
 *
 * Generates a print-ready A4 PDF of a booking confirmation.
 *
 * Reuses the exact same widget+integration lookup chain as retrieve-order.js:
 *   1. POST { widgetId, emailAddress, departDate, orderRef }
 *   2. Look up widget → ClientEmail
 *   3. Look up active Travelify integration → AppId + encrypted key
 *   4. Decrypt key, call Travelify
 *   5. Trim response, render via _pdf-template
 *   6. Puppeteer → PDF buffer → stream back to caller
 *
 * Endpoint:
 *   POST /api/booking-pdf
 *
 * Response:
 *   200 → application/pdf attachment
 *   404 → { error: 'not_found', message: ... }  (generic, no leak)
 *   429 → rate limited
 *   5xx → generic error
 *
 * Vercel deps required (add to package.json):
 *   "@sparticuz/chromium": "^131.0.0"
 *   "puppeteer-core": "^23.0.0"
 *
 * Vercel function config:
 *   memory: 1024 (PDF rendering is RAM-hungry)
 *   maxDuration: 30
 */

import { setCors, sanitiseForFormula } from './_auth.js';
import { decrypt } from './_crypto.js';
import { renderPdfHtml } from './_pdf-template.js';

// Chromium / Puppeteer — only loaded inside the handler so cold start
// doesn't pay the cost on health checks etc.
let _chromium, _puppeteer;
async function getBrowser() {
  if (!_chromium) {
    _chromium = (await import('@sparticuz/chromium')).default;
    _puppeteer = (await import('puppeteer-core')).default;
  }
  return await _puppeteer.launch({
    args: [..._chromium.args, '--font-render-hinting=none'],
    defaultViewport: _chromium.defaultViewport,
    executablePath: await _chromium.executablePath(),
    headless: _chromium.headless,
  });
}

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';
const INTEGRATIONS_TABLE = 'tblpzQpwmcTvUeHcF';

const IF = {
  ClientEmail:      'flditBgdp6egbk3Fb',
  Service:          'fld0TP0kypkfOOJF6',
  AppId:            'fldCXwCixuvqN2HMy',
  ApiKeyEncrypted:  'fldpb4JQRSuot0Gg2',
  Status:           'fldEVMrKnEpFaxORk',
  LastUsedAt:       'fldQgOjcM3sfKL7uB',
};

const TRAVELIFY_API = 'https://api.travelify.io/account/order';

// ----- Rate limiting (same pattern as retrieve-order) -----

const rateLimitStore = new Map();
const RL_WINDOW_MS = 15 * 60 * 1000;

function rateLimit(key, max) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (v.resetAt < now) rateLimitStore.delete(k);
    }
  }
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return { ok: true };
  }
  if (entry.count >= max) {
    return { ok: false, retryAfterMs: entry.resetAt - now };
  }
  entry.count++;
  return { ok: true };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ----- Validation (mirrors retrieve-order) -----

const validateEmail = (s) => {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  if (v.length < 5 || v.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
};
const validateDate = (s) => {
  if (typeof s !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const yr = parseInt(s.slice(0, 4), 10);
  if (yr < 2020 || yr > 2050) return null;
  return s;
};
const validateOrderRef = (s) => {
  if (typeof s !== 'string') return null;
  const v = s.trim().toUpperCase();
  if (!/^[A-Z0-9_\-]{3,40}$/.test(v)) return null;
  return v;
};
const validateWidgetId = (s) => {
  if (typeof s !== 'string') return null;
  if (!/^[a-zA-Z0-9_\-]{8,80}$/.test(s)) return null;
  return s;
};

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

// ----- Re-import the trim function from retrieve-order's logic -----
// We mirror the same trim shape so the template gets a consistent input.
// (Kept inline rather than imported to avoid coupling the public retrieve
// endpoint's trim function as a stable contract; if you'd prefer DRY, lift
// trimOrder() into a shared _booking-shape.js helper later.)

const safeStr = (v, max = 500) => v == null ? null : (String(v).length > max ? String(v).slice(0, max) : String(v));
const safeNum = (v) => (typeof v !== 'number' || !Number.isFinite(v)) ? null : v;
const sanitiseDesc = (t) => typeof t === 'string' ? t.replace(/<[^>]*>/g, '').slice(0, 4000) : null;
const sanitiseUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) && u.length <= 500) ? u : null;

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
      } : null,
      pricing: d.pricing ? {
        currency: safeStr(d.pricing.currency, 10),
        price: safeNum(d.pricing.price),
        inResortFees: safeNum(d.pricing.inResortFees),
        isRefundable: !!d.pricing.isRefundable,
        refundability: safeStr(d.pricing.refundability, 30),
        depositOptions: Array.isArray(d.pricing.depositOptions)
          ? d.pricing.depositOptions.slice(0, 5).map((opt) => ({
              id: safeNum(opt.id),
              name: safeStr(opt.name, 60),
              amount: safeNum(opt.amount),
              dueDate: safeStr(opt.dueDate, 30),
              breakdown: Array.isArray(opt.breakdown)
                ? opt.breakdown.slice(0, 12).map((b) => ({
                    num: safeNum(b.num),
                    amount: safeNum(b.amount),
                    dueDate: safeStr(b.dueDate, 30),
                  }))
                : [],
            }))
          : [],
      } : null,
      descriptions: Array.isArray(d.descriptions)
        ? d.descriptions.slice(0, 10).map((desc) => ({
            type: safeStr(desc.type, 40),
            title: safeStr(desc.title, 100),
            text: sanitiseDesc(desc.text),
          })).filter((x) => x.text)
        : [],
      amenities: Array.isArray(d.amenities)
        ? d.amenities.slice(0, 30).map((a) => safeStr(a, 60)).filter(Boolean)
        : [],
      media: Array.isArray(d.media)
        ? d.media.slice(0, 12).map((m) => ({
            type: safeStr(m.type, 40),
            url: sanitiseUrl(m.url),
            caption: safeStr(m.caption, 200),
          })).filter((m) => m.url)
        : [],
      units: Array.isArray(d.units)
        ? d.units.slice(0, 5).map((u) => ({
            name: safeStr(u.name, 200),
            roomType: safeStr(u.roomType, 60),
            checkin: safeStr(u.checkin, 30),
            nights: safeNum(u.nights),
            rates: Array.isArray(u.rates)
              ? u.rates.slice(0, 3).map((r) => ({
                  name: safeStr(r.name, 100),
                  board: safeStr(r.board, 40),
                }))
              : [],
          }))
        : [],
      guests: Array.isArray(d.guests)
        ? d.guests.slice(0, 12).map((g) => ({
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
  };
}

// ----- Errors -----

function notFound(res) {
  return res.status(404).json({
    error: 'not_found',
    message: "We couldn't find a confirmed booking with those details.",
  });
}

function genericError(res) {
  return res.status(500).json({
    error: 'server_error',
    message: 'Something went wrong generating your PDF. Please try again in a moment.',
  });
}

// ----- HTTP handler -----

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  const ipLimit = rateLimit(`pdf:ip:${ip}`, 5);
  if (!ipLimit.ok) {
    return res.status(429).json({
      error: 'too_many_attempts',
      message: 'Too many PDF requests. Please wait 15 minutes and try again.',
      retryAfterMs: ipLimit.retryAfterMs,
    });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return notFound(res);
  }

  const widgetId = validateWidgetId(body.widgetId);
  const emailAddress = validateEmail(body.emailAddress);
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);

  if (!widgetId || !emailAddress || !departDate || !orderRef) return notFound(res);

  const widgetLimit = rateLimit(`pdf:ipw:${ip}:${widgetId}`, 20);
  if (!widgetLimit.ok) {
    return res.status(429).json({
      error: 'too_many_attempts',
      message: 'Too many PDF requests for this widget. Please try again later.',
      retryAfterMs: widgetLimit.retryAfterMs,
    });
  }

  let browser;
  try {
    // Lookup chain — same as retrieve-order
    const widget = await findWidgetById(widgetId);
    if (!widget) return notFound(res);

    const widgetType = widget.fields?.WidgetType;
    if (widgetType !== 'My Booking') return notFound(res);

    const widgetStatus = widget.fields?.Status;
    if (widgetStatus && widgetStatus !== 'Active' && widgetStatus !== 'Draft') return notFound(res);

    const clientEmail = (widget.fields?.ClientEmail || '').toLowerCase().trim();
    if (!clientEmail) return notFound(res);

    const integration = await findActiveTravelifyIntegration(clientEmail);
    if (!integration) {
      console.warn(`No active Travelify integration for client (widgetId=${widgetId})`);
      return notFound(res);
    }

    const appId = integration.fields?.[IF.AppId];
    const apiKeyEncrypted = integration.fields?.[IF.ApiKeyEncrypted];
    if (!appId || !apiKeyEncrypted) return notFound(res);

    let apiKey;
    try {
      apiKey = decrypt(apiKeyEncrypted);
    } catch (e) {
      console.error('Decryption failed for integration', integration.id, ':', e.message);
      return notFound(res);
    }

    const travelifyRes = await fetch(TRAVELIFY_API, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${appId}:${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ emailAddress, departDate, orderRef }),
      signal: AbortSignal.timeout(12000),
    });

    if (travelifyRes.status === 404) return notFound(res);
    if (!travelifyRes.ok) {
      console.error(`Travelify returned ${travelifyRes.status} for widget ${widgetId}`);
      return notFound(res);
    }

    let raw;
    try { raw = await travelifyRes.json(); }
    catch { return notFound(res); }

    if (raw && (raw.code === '404' || raw.code === 404)) return notFound(res);

    const order = trimOrder(raw);
    if (!order || !order.id) return notFound(res);

    // Pull brand / contact details from the widget config (optional)
    // These come from the widget's settings JSON if the editor has saved them.
    const widgetSettings = (() => {
      const raw = widget.fields?.Settings;
      if (!raw) return {};
      if (typeof raw === 'object') return raw;
      try { return JSON.parse(raw); } catch { return {}; }
    })();

    const brandName = widgetSettings?.brand?.name || 'Travelgenix';
    const supportEmail = widgetSettings?.support?.email || null;
    const supportPhone = widgetSettings?.support?.phone || null;

    // Render HTML
    const html = renderPdfHtml(order, {
      brandName,
      supportEmail,
      supportPhone,
      issuedAt: new Date().toISOString(),
    });

    // Puppeteer → PDF
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.emulateMediaType('screen');

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: false,
    });

    await page.close();

    // Filename
    const safeRef = orderRef.replace(/[^A-Z0-9_\-]/gi, '');
    const filename = `booking-${safeRef}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error('booking-pdf error:', err.message);
    if (!res.headersSent) return genericError(res);
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
