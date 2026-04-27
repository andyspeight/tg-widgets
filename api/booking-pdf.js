/**
 * Travelgenix Widget Suite — Booking PDF (DEBUG VERSION)
 *
 * Same as production but with verbose console.log at every step so we can
 * see in Vercel logs exactly where the 404 happens.
 *
 * Once we know what's failing, we'll swap back to the clean version.
 */

import { setCors, sanitiseForFormula } from './_auth.js';
import { decrypt } from './_crypto.js';
import { renderPdfHtml } from '../public/_pdf-template.js';

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

const AIRTABLE_BASE = 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';
const INTEGRATIONS_TABLE = 'tblpzQpwmcTvUeHcF';
const TRAVELIFY_API = 'https://api.travelify.io/account/order';

const IF = {
  ClientEmail:      'flditBgdp6egbk3Fb',
  Service:          'fld0TP0kypkfOOJF6',
  AppId:            'fldCXwCixuvqN2HMy',
  ApiKeyEncrypted:  'fldpb4JQRSuot0Gg2',
  Status:           'fldEVMrKnEpFaxORk',
};

const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_ACCESS_TOKEN;
function airtableHeaders() {
  return { 'Authorization': `Bearer ${AIRTABLE_KEY}`, 'Content-Type': 'application/json' };
}

async function findWidgetById(widgetId) {
  const safe = sanitiseForFormula(widgetId);
  const formula = `{WidgetID}='${safe}'`;
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${WIDGETS_TABLE}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('maxRecords', '1');
  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) {
    console.error(`[pdf-debug] Widget lookup HTTP ${res.status}`);
    throw new Error(`Widget lookup failed: ${res.status}`);
  }
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
  if (!res.ok) {
    console.error(`[pdf-debug] Integration lookup HTTP ${res.status}`);
    throw new Error(`Integration lookup failed: ${res.status}`);
  }
  const data = await res.json();
  return data.records?.[0] || null;
}

// ----- Validators -----
function validateWidgetId(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^tgw_[0-9a-z_]{6,80}$/i.test(t)) return null;
  return t;
}
function validateEmail(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null;
  return t.toLowerCase();
}
function validateDate(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  return t;
}
function validateOrderRef(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(t)) return null;
  return t;
}

// ----- Trim functions (kept inline) -----
const safeStr = (v, max) => typeof v === 'string' ? v.slice(0, max) : null;
const safeNum = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
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
            type: safeStr(g.type, 20),
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

function notFound(res, debugTag) {
  console.warn(`[pdf-debug] FAIL: ${debugTag}`);
  return res.status(404).json({ error: 'not_found', message: "We couldn't find a confirmed booking with those details.", debug: debugTag });
}

function rateLimit() { return { ok: true }; } // placeholder

// ----- Handler -----

export default async function handler(req, res) {
  console.log('[pdf-debug:01] === Request received ===');
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  console.log('[pdf-debug:02] Method check passed');

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    console.log('[pdf-debug:03] Body parsed, keys:', Object.keys(body).join(','));
  } catch (e) {
    return notFound(res, '03-body-parse');
  }

  const widgetId = validateWidgetId(body.widgetId);
  const emailAddress = validateEmail(body.emailAddress);
  const departDate = validateDate(body.departDate);
  const orderRef = validateOrderRef(body.orderRef);

  console.log('[pdf-debug:04] Validation results:',
    'widgetId=', !!widgetId,
    'email=', !!emailAddress,
    'date=', !!departDate,
    'ref=', !!orderRef);

  if (!widgetId || !emailAddress || !departDate || !orderRef) {
    return notFound(res, '04-validation-failed');
  }

  try {
    console.log('[pdf-debug:05] Looking up widget…');
    const widget = await findWidgetById(widgetId);
    if (!widget) return notFound(res, '05-widget-not-found');
    console.log('[pdf-debug:06] Widget found:', widget.id);

    const widgetType = widget.fields?.WidgetType;
    const widgetStatus = widget.fields?.Status;
    const clientEmail = (widget.fields?.ClientEmail || '').toLowerCase().trim();
    console.log('[pdf-debug:07] Widget fields - type:', widgetType, 'status:', widgetStatus, 'clientEmail:', clientEmail);

    if (widgetType !== 'My Booking') return notFound(res, '07a-wrong-widget-type:' + widgetType);
    if (widgetStatus && widgetStatus !== 'Active' && widgetStatus !== 'Draft') return notFound(res, '07b-bad-status:' + widgetStatus);
    if (!clientEmail) return notFound(res, '07c-no-client-email');

    console.log('[pdf-debug:08] Looking up Travelify integration…');
    const integration = await findActiveTravelifyIntegration(clientEmail);
    if (!integration) return notFound(res, '08-no-active-integration');
    console.log('[pdf-debug:09] Integration found:', integration.id);

    const appId = integration.fields?.[IF.AppId];
    const apiKeyEncrypted = integration.fields?.[IF.ApiKeyEncrypted];
    console.log('[pdf-debug:10] AppId:', appId, 'has-encrypted-key:', !!apiKeyEncrypted);
    if (!appId || !apiKeyEncrypted) return notFound(res, '10-missing-creds');

    let apiKey;
    try {
      apiKey = decrypt(apiKeyEncrypted);
      console.log('[pdf-debug:11] Decryption succeeded, key length:', apiKey?.length);
    } catch (e) {
      console.error('[pdf-debug:11] Decryption error:', e.message);
      return notFound(res, '11-decrypt-failed');
    }

    console.log('[pdf-debug:12] Calling Travelify…');
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
    console.log('[pdf-debug:13] Travelify status:', travelifyRes.status);

    if (travelifyRes.status === 404) return notFound(res, '13a-travelify-404');
    if (!travelifyRes.ok) {
      const errBody = await travelifyRes.text().catch(() => '');
      console.error('[pdf-debug:13] Travelify body:', errBody.slice(0, 500));
      return notFound(res, '13b-travelify-not-ok-' + travelifyRes.status);
    }

    let raw;
    try {
      raw = await travelifyRes.json();
      console.log('[pdf-debug:14] Travelify JSON parsed, keys:', Object.keys(raw).slice(0, 10).join(','));
    } catch (e) {
      console.error('[pdf-debug:14] JSON parse failed:', e.message);
      return notFound(res, '14-travelify-json-parse');
    }

    if (raw && (raw.code === '404' || raw.code === 404)) return notFound(res, '15-travelify-404-in-body');

    const order = trimOrder(raw);
    console.log('[pdf-debug:16] Trim done. order.id:', order?.id, 'items:', order?.items?.length);
    if (!order || !order.id) return notFound(res, '16-trim-no-id');

    console.log('[pdf-debug:17] Reading widget settings…');
    const widgetSettings = (() => {
      const raw = widget.fields?.Settings;
      if (!raw) return {};
      if (typeof raw === 'object') return raw;
      try { return JSON.parse(raw); } catch { return {}; }
    })();

    const brandName = widgetSettings?.brand?.name || '';
    const supportEmail = widgetSettings?.support?.email || null;
    const supportPhone = widgetSettings?.support?.phone || null;
    const colors = widgetSettings?.colors || {};
    const radius = typeof widgetSettings?.radius === 'number' ? widgetSettings.radius : 12;

    console.log('[pdf-debug:18] Rendering HTML…');
    let html;
    try {
      html = renderPdfHtml(order, { brandName, supportEmail, supportPhone, colors, radius });
      console.log('[pdf-debug:19] HTML rendered, length:', html?.length);
    } catch (e) {
      console.error('[pdf-debug:19] Template render error:', e.message, e.stack?.slice(0, 500));
      return res.status(500).json({ error: 'render_failed', message: 'Template error', debug: e.message });
    }

    console.log('[pdf-debug:20] Launching browser…');
    let browser;
    try {
      browser = await getBrowser();
      console.log('[pdf-debug:21] Browser ready');
    } catch (e) {
      console.error('[pdf-debug:21] Browser launch error:', e.message);
      return res.status(500).json({ error: 'browser_failed', debug: e.message });
    }

    let pdfBuffer;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      console.log('[pdf-debug:22] Page content set');
      pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
      console.log('[pdf-debug:23] PDF generated, size:', pdfBuffer?.length);
      await browser.close();
    } catch (e) {
      console.error('[pdf-debug:23] PDF generation error:', e.message);
      try { await browser?.close(); } catch {}
      return res.status(500).json({ error: 'pdf_failed', debug: e.message });
    }

    console.log('[pdf-debug:24] Sending PDF response');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="booking-${orderRef}.pdf"`);
    return res.status(200).send(pdfBuffer);

  } catch (err) {
    console.error('[pdf-debug:99] Unhandled error:', err.message, err.stack?.slice(0, 1000));
    return res.status(500).json({ error: 'server_error', debug: err.message });
  }
}
