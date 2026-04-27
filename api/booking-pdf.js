/**
 * Travelgenix — Booking PDF (HTML PREVIEW MODE)
 *
 * Returns the rendered HTML as text/html instead of running it through
 * Puppeteer. If this works and the real PDF route doesn't, Puppeteer is
 * the problem. If this also fails, we'll see the actual error.
 *
 * SWAP BACK to the real version once we've diagnosed.
 */

import { setCors, sanitiseForFormula } from './_auth.js';
import { decrypt } from './_crypto.js';
import { renderPdfHtml } from '../public/_pdf-template.js';

const AIRTABLE_BASE = 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';
const INTEGRATIONS_TABLE = 'tblpzQpwmcTvUeHcF';
const TRAVELIFY_API = 'https://api.travelify.io/account/order';

const IF = {
  ClientEmail: 'flditBgdp6egbk3Fb',
  Service: 'fld0TP0kypkfOOJF6',
  AppId: 'fldCXwCixuvqN2HMy',
  ApiKeyEncrypted: 'fldpb4JQRSuot0Gg2',
  Status: 'fldEVMrKnEpFaxORk',
};

const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_ACCESS_TOKEN;
function airtableHeaders() {
  return { 'Authorization': `Bearer ${AIRTABLE_KEY}`, 'Content-Type': 'application/json' };
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

const safeStr = (v, max) => typeof v === 'string' ? v.slice(0, max) : null;
const safeNum = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;

function trimOrder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: safeNum(raw.id),
    status: safeStr(raw.status, 30),
    customerTitle: safeStr(raw.customerTitle, 30),
    customerFirstname: safeStr(raw.customerFirstname, 80),
    customerSurname: safeStr(raw.customerSurname, 80),
    customerEmail: safeStr(raw.customerEmail, 254),
    currency: safeStr(raw.currency, 10),
    created: safeStr(raw.created, 30),
    items: Array.isArray(raw.items) ? raw.items : [],
  };
}

export default async function handler(req, res) {
  console.log('[html-test:01] Request received');
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'bad_json' });
  }

  const widgetId = body.widgetId;
  const emailAddress = body.emailAddress;
  const departDate = body.departDate;
  const orderRef = body.orderRef;

  console.log('[html-test:02] Inputs:', { widgetId, emailAddress, departDate, orderRef });

  try {
    console.log('[html-test:03] Looking up widget…');
    const widget = await findWidgetById(widgetId);
    if (!widget) return res.status(404).json({ error: 'widget_not_found' });

    const clientEmail = (widget.fields?.ClientEmail || '').toLowerCase().trim();
    console.log('[html-test:04] Widget found, clientEmail:', clientEmail);

    console.log('[html-test:05] Looking up integration…');
    const integration = await findActiveTravelifyIntegration(clientEmail);
    if (!integration) return res.status(404).json({ error: 'no_integration' });

    const appId = integration.fields?.[IF.AppId];
    const apiKeyEncrypted = integration.fields?.[IF.ApiKeyEncrypted];
    const apiKey = decrypt(apiKeyEncrypted);
    console.log('[html-test:06] Decrypt ok, calling Travelify…');

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

    console.log('[html-test:07] Travelify status:', travelifyRes.status);
    if (!travelifyRes.ok) {
      const errBody = await travelifyRes.text().catch(() => '');
      console.error('[html-test:07] Travelify body:', errBody.slice(0, 500));
      return res.status(travelifyRes.status).json({ error: 'travelify_error', status: travelifyRes.status, body: errBody.slice(0, 500) });
    }

    const raw = await travelifyRes.json();
    console.log('[html-test:08] Travelify JSON parsed, keys:', Object.keys(raw).slice(0, 12).join(','));

    const order = trimOrder(raw);
    console.log('[html-test:09] Trim done. order.id:', order?.id, 'items:', order?.items?.length);

    if (!order || !order.id) return res.status(404).json({ error: 'trim_no_id' });

    const widgetSettings = (() => {
      const s = widget.fields?.Settings;
      if (!s) return {};
      if (typeof s === 'object') return s;
      try { return JSON.parse(s); } catch { return {}; }
    })();

    console.log('[html-test:10] Calling renderPdfHtml…');
    let html;
    try {
      html = renderPdfHtml(order, {
        brandName: widgetSettings?.brand?.name || '',
        supportEmail: widgetSettings?.support?.email || null,
        supportPhone: widgetSettings?.support?.phone || null,
        colors: widgetSettings?.colors || {},
        radius: typeof widgetSettings?.radius === 'number' ? widgetSettings.radius : 12,
      });
      console.log('[html-test:11] HTML rendered, length:', html?.length);
    } catch (e) {
      console.error('[html-test:11] Template error:', e.message, e.stack);
      return res.status(500).json({ error: 'render_failed', message: e.message, stack: (e.stack || '').slice(0, 1000) });
    }

    console.log('[html-test:12] Returning HTML preview');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);

  } catch (err) {
    console.error('[html-test:99] Unhandled error:', err.message, err.stack);
    return res.status(500).json({ error: 'server_error', message: err.message, stack: (err.stack || '').slice(0, 1000) });
  }
}
