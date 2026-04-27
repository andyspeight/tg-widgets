/**
 * Travelgenix Widget Suite — Booking PDF (public endpoint)
 *
 * Generates a print-ready A4 PDF of a confirmed booking.
 *
 * Mirrors retrieve-order.js exactly for auth/lookup/Travelify call so the
 * two endpoints behave identically — same env var, same widget+integration
 * resolution, same Origin handling. Differs only in output: this one renders
 * HTML via _pdf-template.js and pipes through Puppeteer to produce a PDF
 * buffer instead of returning JSON.
 *
 * Endpoint:
 *   POST /api/booking-pdf
 *   Body: { widgetId, emailAddress, departDate, orderRef }
 *
 * Response:
 *   200 → application/pdf (binary attachment)
 *   404 → { error: 'not_found' }
 *   429 → { error: 'too_many_attempts' }
 *   5xx → { error: 'server_error' }
 *
 * Vercel function config (vercel.json):
 *   memory: 1024, maxDuration: 30
 *
 * Vercel deps (package.json):
 *   @sparticuz/chromium, puppeteer-core
 */

import { setCors, sanitiseForFormula } from './_auth.js';
import { decrypt } from './_crypto.js';
import { renderPdfHtml } from '../public/_pdf-template.js';

// ----- Constants (matched 1:1 with retrieve-order.js) -----

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';
const INTEGRATIONS_TABLE = 'tblpzQpwmcTvUeHcF';

const IF = {
  ClientEmail:     'flditBgdp6egbk3Fb',
  Service:         'fld0TP0kypkfOOJF6',
  AppId:           'fldCXwCixuvqN2HMy',
  ApiKeyEncrypted: 'fldpb4JQRSuot0Gg2',
  Status:          'fldEVMrKnEpFaxORk',
};

const TRAVELIFY_API = 'https://api.travelify.io/account/order';

// ----- Puppeteer (lazy-loaded so cold start is cheap on health checks) -----

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

// ----- Rate limiting -----

const rateLimitStore = new Map();
const RL_WINDOW_MS = 15 * 60 * 1000;

function rateLimit(key, max) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore.entries()) if (v.resetAt < now) rateLimitStore.delete(k);
  }
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return { ok: true };
  }
  if (entry.count >= max) return { ok: false, retryAfterMs: entry.resetAt - now };
  entry.count++;
  return { ok: true };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ----- Validation -----

function validateEmail(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  if (v.length < 5 || v.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}
function validateDate(s) {
  if (typeof s !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const yr = parseInt(s.slice(0, 4), 10);
  if (yr < 2020 || yr > 2050) return null;
  return s;
}
function validateOrderRef(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toUpperCase();
  if (!/^[A-Z0-9_\-]{3,40}$/.test(v)) return null;
  return v;
}
function validateWidgetId(s) {
  if (typeof s !== 'string') return null;
  if (!/^[a-zA-Z0-9_\-]{8,80}$/.test(s)) return null;
  return s;
}

// ----- Airtable (identical pattern to retrieve-order.js) -----

function airtableHeaders() {
  const key = process.env.AIRTABLE_KEY;
  if (!key) throw new Error('AIRTABLE_KEY env var missing');
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function findWidgetById(widgetId) {
  const safe = sanitiseForFormula(widgetId);
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${WIDGETS_TABLE}`);
  url.searchParams.set('filterByFormula', `{WidgetID}='${safe}'`);
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

// ----- Trim (mirrors retrieve-order.js shape so template input is identical) -----
// Kept inline rather than imported to avoid coupling the public retrieve
// endpoint's trim function as a stable contract.

const safeStr = (v, max = 500) => v == null ? null : String(v).slice(0, max);
const safeNum = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const sanitiseDesc = (t) => typeof t === 'string' ? t.replace(/<[^>]*>/g, '').slice(0, 4000) : null;
const sanitiseUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) && u.length <= 500) ? u : null;

function trimAccommodation(d) {
  return {
    name: safeStr(d.name, 200),
    propertyType: safeStr(d.propertyType, 60),
    rating: safeNum(d.rating),
    location: d.location ? {
      address1: safeStr(d.location.address1, 300),
      city: safeStr(d.location.city, 100),
      state: safeStr(d.location.state, 100),
      postalCode: safeStr(d.location.postalCode, 30),
      country: safeStr(d.location.country, 10),
    } : null,
    pricing: d.pricing ? {
      currency: safeStr(d.pricing.currency, 10),
      price: safeNum(d.pricing.price),
      inResortFees: safeNum(d.pricing.inResortFees),
      isRefundable: !!d.pricing.isRefundable,
      refundability: safeStr(d.pricing.refundability, 30),
      breakdown: Array.isArray(d.pricing.breakdown)
        ? d.pricing.breakdown.slice(0, 10).map(b => ({
            type: safeStr(b.type, 30), name: safeStr(b.name, 100),
            description: safeStr(b.description, 200),
            unitPrice: safeNum(b.unitPrice), qty: safeNum(b.qty),
          })) : [],
      payAtLocation: Array.isArray(d.pricing.payAtLocation)
        ? d.pricing.payAtLocation.slice(0, 10).map(b => ({
            type: safeStr(b.type, 30), name: safeStr(b.name, 100),
            description: safeStr(b.description, 200),
            unitPrice: safeNum(b.unitPrice), qty: safeNum(b.qty),
          })) : [],
      depositOptions: Array.isArray(d.pricing.depositOptions)
        ? d.pricing.depositOptions.slice(0, 5).map(opt => ({
            id: safeNum(opt.id), name: safeStr(opt.name, 60),
            amount: safeNum(opt.amount), dueDate: safeStr(opt.dueDate, 30),
            breakdown: Array.isArray(opt.breakdown)
              ? opt.breakdown.slice(0, 12).map(b => ({
                  num: safeNum(b.num), amount: safeNum(b.amount), dueDate: safeStr(b.dueDate, 30),
                })) : [],
          })) : [],
    } : null,
    descriptions: Array.isArray(d.descriptions)
      ? d.descriptions.slice(0, 30).map(desc => ({
          type: safeStr(desc.type, 40), title: safeStr(desc.title, 100),
          text: sanitiseDesc(desc.text),
        })).filter(x => x.text) : [],
    amenities: Array.isArray(d.amenities)
      ? d.amenities.slice(0, 30).map(a => safeStr(a, 60)).filter(Boolean) : [],
    media: Array.isArray(d.media)
      ? d.media.slice(0, 12).map(m => ({
          type: safeStr(m.type, 40), url: sanitiseUrl(m.url), caption: safeStr(m.caption, 200),
        })).filter(m => m.url) : [],
    units: Array.isArray(d.units)
      ? d.units.slice(0, 5).map(u => ({
          name: safeStr(u.name, 200), roomType: safeStr(u.roomType, 60),
          checkin: safeStr(u.checkin, 30), nights: safeNum(u.nights),
          rates: Array.isArray(u.rates)
            ? u.rates.slice(0, 3).map(r => ({
                name: safeStr(r.name, 100), board: safeStr(r.board, 40),
              })) : [],
        })) : [],
    guests: Array.isArray(d.guests)
      ? d.guests.slice(0, 12).map(g => ({
          type: safeStr(g.type, 30), title: safeStr(g.title, 30),
          firstname: safeStr(g.firstname, 80), surname: safeStr(g.surname, 80),
        })) : [],
  };
}

function trimFlightSegment(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    origin: s.origin ? { iataCode: safeStr(s.origin.iataCode, 10), terminal: safeStr(s.origin.terminal, 20), name: safeStr(s.origin.name, 200) } : null,
    destination: s.destination ? { iataCode: safeStr(s.destination.iataCode, 10), terminal: safeStr(s.destination.terminal, 20), name: safeStr(s.destination.name, 200) } : null,
    depart: safeStr(s.depart, 30), arrive: safeStr(s.arrive, 30),
    duration: safeNum(s.duration), cabinClass: safeStr(s.cabinClass, 40), fareName: safeStr(s.fareName, 80),
    baggage: s.baggage ? { allowance: safeStr(s.baggage.allowance, 200), weight: safeStr(s.baggage.weight, 40) } : null,
    marketingCarrier: s.marketingCarrier ? { code: safeStr(s.marketingCarrier.code, 10), name: safeStr(s.marketingCarrier.name, 100) } : null,
    flightNo: safeStr(s.flightNo, 20), aircraft: safeStr(s.aircraft, 20),
  };
}

function trimFlights(d) {
  return {
    fareType: safeStr(d.fareType, 40),
    pricing: d.pricing ? { currency: safeStr(d.pricing.currency, 10), price: safeNum(d.pricing.price) } : null,
    routes: Array.isArray(d.routes)
      ? d.routes.slice(0, 4).map(r => ({
          direction: safeStr(r.direction, 30), duration: safeNum(r.duration),
          segments: Array.isArray(r.segments) ? r.segments.slice(0, 6).map(trimFlightSegment).filter(Boolean) : [],
        })) : [],
    fareInformation: Array.isArray(d.fareInformation)
      ? d.fareInformation.slice(0, 10).map(f => ({
          type: safeStr(f.type, 40), title: safeStr(f.title, 100), text: safeStr(f.text, 1000),
        })).filter(f => f.text) : [],
    travellers: Array.isArray(d.travellers)
      ? d.travellers.slice(0, 12).map(t => ({
          type: safeStr(t.type, 30), title: safeStr(t.title, 30),
          firstname: safeStr(t.firstname, 80), surname: safeStr(t.surname, 80),
        })) : [],
  };
}

function trimAirportExtras(d) {
  return {
    type: safeStr(d.type, 40), name: safeStr(d.name, 200), subTitle: safeStr(d.subTitle, 200),
    startDateTime: safeStr(d.startDateTime, 30), endDateTime: safeStr(d.endDateTime, 30),
    location: d.location ? { iataCode: safeStr(d.location.iataCode, 10), terminal: safeStr(d.location.terminal, 20) } : null,
    descriptions: Array.isArray(d.descriptions)
      ? d.descriptions.slice(0, 12).map(desc => ({
          type: safeStr(desc.type, 40), title: safeStr(desc.title, 100), text: sanitiseDesc(desc.text),
        })).filter(x => x.text) : [],
    pricing: d.pricing ? { currency: safeStr(d.pricing.currency, 10), price: safeNum(d.pricing.price) } : null,
    travellers: Array.isArray(d.travellers)
      ? d.travellers.slice(0, 12).map(t => ({
          type: safeStr(t.type, 30), title: safeStr(t.title, 30),
          firstname: safeStr(t.firstname, 80), surname: safeStr(t.surname, 80),
        })) : [],
  };
}

function trimItem(item) {
  if (!item || typeof item !== 'object') return null;
  const out = {
    id: safeNum(item.id), status: safeStr(item.status, 30), product: safeStr(item.product, 30),
    bookingReference: safeStr(item.bookingReference, 100), price: safeNum(item.price),
    currency: safeStr(item.originalCurrency, 10), startDate: safeStr(item.startDate, 30),
    duration: safeNum(item.duration),
  };
  if (item.product === 'Accommodation' && item.dataObject) out.accommodation = trimAccommodation(item.dataObject);
  else if (item.product === 'Flights' && item.dataObject) out.flights = trimFlights(item.dataObject);
  else if (item.product === 'AirportExtras' && item.dataObject) out.airportExtras = trimAirportExtras(item.dataObject);
  return out;
}

function computeSummary(items) {
  const summary = {
    totalPrice: 0, hasAccommodation: false, hasFlights: false, hasAirportExtras: false,
    earliestStart: null, travellers: [],
  };
  for (const item of items) {
    if (typeof item.price === 'number') summary.totalPrice += item.price;
    if (item.product === 'Accommodation') summary.hasAccommodation = true;
    else if (item.product === 'Flights') summary.hasFlights = true;
    else if (item.product === 'AirportExtras') summary.hasAirportExtras = true;
    if (item.startDate) {
      const ts = Date.parse(item.startDate);
      if (Number.isFinite(ts) && (!summary.earliestStart || ts < Date.parse(summary.earliestStart))) {
        summary.earliestStart = item.startDate;
      }
    }
  }
  summary.totalPrice = Math.round(summary.totalPrice * 100) / 100;
  if (summary.totalPrice === 0) summary.totalPrice = null;
  const seen = new Set();
  for (const item of items) {
    const list = item.accommodation?.guests || item.flights?.travellers || item.airportExtras?.travellers || [];
    for (const t of list) {
      const key = `${(t.title || '').toLowerCase()}|${(t.firstname || '').toLowerCase()}|${(t.surname || '').toLowerCase()}`;
      if (!seen.has(key) && (t.firstname || t.surname)) {
        seen.add(key); summary.travellers.push(t);
      }
    }
  }
  return summary;
}

function trimOrder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const items = Array.isArray(raw.items) ? raw.items.slice(0, 8).map(trimItem).filter(Boolean) : [];
  return {
    id: safeNum(raw.id), status: safeStr(raw.status, 30),
    customerTitle: safeStr(raw.customerTitle, 30),
    customerFirstname: safeStr(raw.customerFirstname, 80),
    customerSurname: safeStr(raw.customerSurname, 80),
    customerEmail: safeStr(raw.customerEmail, 254),
    specialRequests: safeStr(raw.specialRequests, 1000),
    currency: safeStr(raw.currency, 10), created: safeStr(raw.created, 30),
    items, summary: computeSummary(items),
  };
}

// ----- Errors -----

function notFound(res) {
  return res.status(404).json({ error: 'not_found', message: "We couldn't find a confirmed booking with those details." });
}

// ----- Handler -----

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  const ipLimit = rateLimit(`pdf:ip:${ip}`, 5);
  if (!ipLimit.ok) {
    return res.status(429).json({ error: 'too_many_attempts', retryAfterMs: ipLimit.retryAfterMs });
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

  const widgetLimit = rateLimit(`pdf:ipw:${ip}:${widgetId}`, 30);
  if (!widgetLimit.ok) {
    return res.status(429).json({ error: 'too_many_attempts', retryAfterMs: widgetLimit.retryAfterMs });
  }

  let browser;
  try {
    const widget = await findWidgetById(widgetId);
    if (!widget) return notFound(res);

    const widgetType = widget.fields?.WidgetType;
    if (widgetType !== 'My Booking') return notFound(res);

    const widgetStatus = widget.fields?.Status;
    if (widgetStatus && widgetStatus !== 'Active' && widgetStatus !== 'Draft') return notFound(res);

    const clientEmail = (widget.fields?.ClientEmail || '').toLowerCase().trim();
    if (!clientEmail) return notFound(res);

    const integration = await findActiveTravelifyIntegration(clientEmail);
    if (!integration) return notFound(res);

    const appId = integration.fields?.[IF.AppId];
    const apiKeyEncrypted = integration.fields?.[IF.ApiKeyEncrypted];
    if (!appId || !apiKeyEncrypted) return notFound(res);

    let apiKey;
    try {
      apiKey = decrypt(apiKeyEncrypted);
    } catch (e) {
      console.error('PDF decryption failed:', e.message);
      return notFound(res);
    }

    // Travelify requires the Origin header (without it returns a misleading 401).
    const travelifyRes = await fetch(TRAVELIFY_API, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${appId}:${apiKey}`,
        'Content-Type': 'application/json',
        'Origin': 'https://www.travelgenix.io',
      },
      body: JSON.stringify({ emailAddress, departDate, orderRef }),
      signal: AbortSignal.timeout(12000),
    });

    if (travelifyRes.status === 404) return notFound(res);
    if (!travelifyRes.ok) {
      console.error(`Travelify ${travelifyRes.status} for widget ${widgetId}`);
      return notFound(res);
    }

    let raw;
    try { raw = await travelifyRes.json(); } catch { return notFound(res); }
    if (raw && (raw.code === '404' || raw.code === 404)) return notFound(res);

    const order = trimOrder(raw);
    if (!order || !order.id) return notFound(res);

    // Pull brand/contact/styling from widget Settings JSON
    const widgetSettings = (() => {
      const s = widget.fields?.Settings;
      if (!s) return {};
      if (typeof s === 'object') return s;
      try { return JSON.parse(s); } catch { return {}; }
    })();

    const html = renderPdfHtml(order, {
      brandName: widgetSettings?.brand?.name || '',
      supportEmail: widgetSettings?.support?.email || null,
      supportPhone: widgetSettings?.support?.phone || null,
      colors: widgetSettings?.colors || {},
      radius: typeof widgetSettings?.radius === 'number' ? widgetSettings.radius : 12,
    });

    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4', printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="booking-${orderRef}.pdf"`);
    return res.status(200).send(pdfBuffer);

  } catch (err) {
    console.error('booking-pdf error:', err.message, err.stack?.slice(0, 500));
    try { await browser?.close(); } catch {}
    return res.status(500).json({ error: 'server_error' });
  }
}
