/**
 * GET /api/admin/quote-shape
 *
 * Staff-only inspector: what does a Travelify quote ACTUALLY carry?
 *
 * Why this exists (8 Sep 2026): the Quote PDF's Location card reads two field
 * names, monthOfTravel and weatherAverages, that were never confirmed against
 * a live quote. The renderer's own catalogue of confirmed types does not list
 * locations. A client reported the PDF ignoring the travel month's weather,
 * and nothing in the repo, the project record or the mailbox held a real
 * location item to check against. Travelify's API cannot be reached from a
 * development sandbox, so this runs where our functions already reach it and
 * hands the shape back to a signed-in member of staff.
 *
 *   No parameters      a small form: paste the quote link, press Go
 *   ?url=<quote link>  the viewer address, either ?id=..&key=.. or #quoteid=ID/KEY
 *   ?quoteId=&key=     the same, already split out
 *   &widgetId=         a Quote PDF widget of the owning client, so the client's
 *                      own Travelify credentials are used (blank = demo account)
 *
 * What comes back is a SHAPE report, not the quote: the quote's top-level keys,
 * the setup keys with only date-like values, each item's type and key names,
 * every location item in full with cost and price keys removed, and any
 * weather-looking key anywhere in the document with its path and value. No
 * customer name, email or phone, no prices. The same report is logged with a
 * [quote-shape] marker as a second channel.
 *
 * Auth: requireAdmin (admin role or the admin email list). GET only. Rate
 * limited per user. Same-origin CORS like every admin route.
 */
import { requireAdmin, setAdminCors } from './_guard.js';
import { applyRateLimit, RATE_LIMITS } from '../_auth.js';
import { fetchQuoteDocument, resolveContext, scrubCosts } from '../quote-pdf.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_RE = /^[A-Za-z0-9-]{8,80}$/;

/**
 * Pull a quote id + key out of a viewer link. Mirrors the widget's own parser:
 * official ?id=..&key=.. first, then the older #quoteid=ID/KEY hash form.
 * Returns null when neither is present.
 */
export function parseQuoteRef(href) {
  const url = String(href || '').trim();
  if (!url) return null;
  try {
    const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
    const params = {};
    qs.split('&').forEach((pair) => {
      if (!pair) return;
      const kv = pair.split('=');
      params[decodeURIComponent(kv[0] || '').toLowerCase()] = decodeURIComponent(kv[1] || '');
    });
    if (params.id && params.key) return { quoteId: params.id, key: params.key };
  } catch (e) { /* fall through */ }
  const m = /quoteid=([^/&#]+)\/([^&#\s]+)/i.exec(url);
  if (m) {
    try { return { quoteId: decodeURIComponent(m[1]), key: decodeURIComponent(m[2]) }; } catch (e) { return null; }
  }
  return null;
}

const PII_KEY = /^(lead(name|email|phone|tel.*)|customer.*|contact.*|email|phone|telephone|telno|mobile|agentname|agentemail|name)$/i;
const PRICE_KEY = /price|total|cost|nett|member|margin|commission|fee|amount|deposit|balance/i;
const DATE_KEY = /date|month|when|nights|start|end|travel|depart|return|checkin|checkout|duration/i;
const WEATHER_KEY = /weather|climate|temp|rain|sun|humid|season|forecast/i;
const LOCATION_HINT = /^(location|locations|destination)$/i;
const MAX_WEATHER_HITS = 40;

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/** Strip cost keys (the sender's own list) and anything price-like. Deep. */
function stripPrices(value) {
  const scrubbed = scrubCosts(value);
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (isPlainObject(v)) {
      const out = {};
      for (const k of Object.keys(v)) { if (!PRICE_KEY.test(k)) out[k] = walk(v[k]); }
      return out;
    }
    return v;
  };
  return walk(scrubbed);
}

function itemType(it) {
  if (!isPlainObject(it)) return typeof it;
  return String(it.type || it.productType || it.itemType || (it.product ? 'product' : '') || 'unknown');
}

function looksLikeLocation(it) {
  if (!isPlainObject(it)) return false;
  if (LOCATION_HINT.test(itemType(it))) return true;
  return Object.keys(it).some((k) => /^(locationName|monthOfTravel|weatherAverages|weather|climate)$/i.test(k));
}

/** Every weather-looking key anywhere in the document, with its path and value. */
function findWeatherLike(root) {
  const hits = [];
  const seen = new Set();
  const walk = (v, path, depth) => {
    if (hits.length >= MAX_WEATHER_HITS || depth > 8 || v == null) return;
    if (typeof v === 'object') {
      if (seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1)); return; }
      for (const k of Object.keys(v)) {
        const p = path ? `${path}.${k}` : k;
        if (WEATHER_KEY.test(k) && !PRICE_KEY.test(k)) hits.push({ path: p, value: stripPrices(v[k]) });
        else walk(v[k], p, depth + 1);
      }
    }
  };
  walk(root, '', 0);
  return hits;
}

/**
 * Build the shape report for a fetched quote (any of the three shapes the
 * renderer knows, wrapped in { data } or not). Pure; no network.
 */
export function buildQuoteShapeReport(doc) {
  const top = (doc && isPlainObject(doc.data)) ? doc.data : (doc || {});
  const qd = isPlainObject(top.quoteDocument) ? top.quoteDocument : null;
  const items = Array.isArray(qd && qd.items) ? qd.items
    : Array.isArray(top.items) ? top.items : [];
  const shape = qd ? 'quoteDocument'
    : (items[0] && isPlainObject(items[0].product)) ? 'raw'
      : (items[0] && items[0].accommodationName !== undefined) ? 'flat'
        : (items.length ? 'unknown' : 'empty');
  const setupSrc = (qd && isPlainObject(qd.setup)) ? qd.setup : (isPlainObject(top.setup) ? top.setup : {});
  const setup = { keys: Object.keys(setupSrc).filter((k) => !PII_KEY.test(k)), dates: {} };
  for (const k of setup.keys) {
    const v = setupSrc[k];
    if (DATE_KEY.test(k) && (typeof v === 'string' || typeof v === 'number')) setup.dates[k] = v;
  }
  return {
    shape,
    topLevelKeys: Object.keys(top).filter((k) => !PII_KEY.test(k)),
    setup,
    itemCount: items.length,
    items: items.map((it, i) => ({ index: i, type: itemType(it), keys: isPlainObject(it) ? Object.keys(it) : [] })),
    locations: items.filter(looksLikeLocation).map((it) => stripPrices(it)),
    weatherLike: findWeatherLike({ setup: setupSrc, items }),
  };
}

const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Quote shape</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Inter,-apple-system,"Segoe UI",sans-serif;background:#F5F8FB;color:#0F172A;margin:0;padding:40px 20px}
main{max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 6px;color:#1B2B5B}p{margin:0 0 18px;color:#475569;line-height:1.5}
label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #CBD5E1;border-radius:9px;margin-bottom:16px}
button{font:inherit;font-weight:700;background:#1B2B5B;color:#fff;border:0;border-radius:9px;padding:11px 18px;cursor:pointer}</style></head>
<body><main><h1>What does this quote carry?</h1>
<p>Paste the quote link exactly as it appears in the browser, then press Go. You will get a report of the fields Travelify sends for it, with no prices and no customer details.</p>
<form method="get" action="/api/admin/quote-shape">
<label for="url">Quote link</label><input id="url" name="url" placeholder="https://www.example.co.uk/quote-viewer#quoteid=12345/ABCD-..." required>
<label for="widgetId">Quote PDF widget id of the client (optional)</label><input id="widgetId" name="widgetId" value="__WIDGET__" placeholder="tgw_...">
<button type="submit">Go</button></form></main></body></html>`;

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });
  const who = String((gate.user && (gate.user.email || gate.user.userId || gate.user.id)) || 'staff').toLowerCase();
  if (!applyRateLimit(res, `quote-shape:${who}`, RATE_LIMITS.widgetRead)) return;

  const q = req.query || {};
  const widgetId = (typeof q.widgetId === 'string' && ID_RE.test(q.widgetId)) ? q.widgetId : null;
  const ref = parseQuoteRef(q.url) || ((q.quoteId && q.key) ? { quoteId: String(q.quoteId), key: String(q.key) } : null);

  if (!ref) {
    if (q.url) return res.status(400).json({ error: 'That link does not carry a quote id and key. It should contain ?id=...&key=... or #quoteid=ID/KEY.' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(FORM.replace('__WIDGET__', widgetId ? widgetId.replace(/[^A-Za-z0-9_-]/g, '') : ''));
  }
  if (!ID_RE.test(ref.quoteId) || !KEY_RE.test(ref.key)) return res.status(400).json({ error: 'Quote id or key is not in the expected form.' });

  try {
    const ctx = await resolveContext(widgetId);
    const doc = await fetchQuoteDocument(ref.quoteId, ref.key, ctx.appId, ctx.apiKey);
    const report = buildQuoteShapeReport(doc);
    report.quoteId = ref.quoteId;
    report.widgetId = widgetId || 'demo';
    report.appId = String(ctx.appId);
    console.error('[quote-shape] ' + JSON.stringify(report).slice(0, 6000));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify(report, null, 2));
  } catch (e) {
    const msg = String((e && e.message) || 'failed');
    const friendly = msg === 'widget_not_found' ? 'That widget id was not found.'
      : msg === 'no_client_credentials' ? 'That widget\'s client has no Travelify credentials on file.'
        : msg === 'widget_no_client' ? 'That widget has no owning client recorded.'
          : /Quote API 404|Quote not found/.test(msg) ? 'Travelify did not return a quote for that id and key with these credentials. Check the widget id belongs to the same client as the quote.'
            : msg;
    return res.status(502).json({ error: friendly });
  }
}
