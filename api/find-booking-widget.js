/**
 * GET /api/find-booking-widget?lunaClientName=X
 *
 * DIAGNOSTIC BUILD: surfaces underlying Airtable errors in the JSON response
 * so we can debug without round-tripping to Vercel logs. Once working, swap
 * back to the production version that hides internals.
 */

const BASE_ID = 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 60;
const rateBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 1;
    bucket.resetAt = now + RATE_WINDOW_MS;
  } else {
    bucket.count += 1;
  }
  rateBuckets.set(ip, bucket);
  return bucket.count > RATE_MAX;
}

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  return String(fwd).split(',')[0].trim();
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function getAirtableKey() {
  return process.env.AIRTABLE_API_KEY
      || process.env.AIRTABLE_KEY
      || process.env.AIRTABLE_TOKEN
      || process.env.AIRTABLE_PAT
      || '';
}

function parseSettings(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

const SETTINGS_FIELD_CANDIDATES = ['Settings', 'settings', 'Config', 'config'];

function getSettingsRaw(fields) {
  for (const name of SETTINGS_FIELD_CANDIDATES) {
    if (fields[name] !== undefined) return fields[name];
  }
  for (const key of Object.keys(fields)) {
    const parsed = parseSettings(fields[key]);
    if (parsed && parsed.lunaIntegration) return fields[key];
  }
  return null;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (isRateLimited(getIp(req))) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  let lunaClientName = '';
  if (req.query && req.query.lunaClientName) {
    lunaClientName = String(req.query.lunaClientName);
  } else if (req.url) {
    try {
      const u = new URL(req.url, 'http://x');
      lunaClientName = u.searchParams.get('lunaClientName') || '';
    } catch (_) {}
  }
  lunaClientName = lunaClientName.trim();

  if (!lunaClientName || lunaClientName.length < 2 || lunaClientName.length > 100) {
    return res.status(404).json({ error: 'not_found' });
  }

  const apiKey = getAirtableKey();
  if (!apiKey) {
    return res.status(500).json({
      error: 'server_misconfigured',
      detail: 'No Airtable key in env (tried AIRTABLE_API_KEY, AIRTABLE_KEY, AIRTABLE_TOKEN, AIRTABLE_PAT)'
    });
  }

  // Try to fetch one page of widgets and surface any Airtable error verbatim
  const baseUrl = 'https://api.airtable.com/v0/' + BASE_ID + '/' + WIDGETS_TABLE;
  const firstUrl = baseUrl + '?pageSize=100';

  let firstRes;
  try {
    firstRes = await fetch(firstUrl, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json' }
    });
  } catch (err) {
    return res.status(500).json({
      error: 'fetch_threw',
      detail: err && err.message ? err.message : String(err)
    });
  }

  if (!firstRes.ok) {
    const body = await firstRes.text().catch(() => '');
    return res.status(500).json({
      error: 'airtable_http_' + firstRes.status,
      detail: body.slice(0, 800),
      requestUrl: firstUrl,
      keyPrefix: apiKey.slice(0, 6) + '…'
    });
  }

  let firstData;
  try {
    firstData = await firstRes.json();
  } catch (err) {
    return res.status(500).json({
      error: 'airtable_invalid_json',
      detail: err && err.message ? err.message : String(err)
    });
  }

  const allRecords = Array.isArray(firstData.records) ? firstData.records.slice() : [];

  // Paginate up to 5 pages total (500 records). Errors here are non-fatal —
  // we proceed with what we have and note the issue in diagnostics.
  let offset = firstData.offset;
  let pages = 1;
  const pageErrors = [];
  while (offset && pages < 5) {
    const url = baseUrl + '?pageSize=100&offset=' + encodeURIComponent(offset);
    try {
      const r = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json' }
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        pageErrors.push('page ' + (pages + 1) + ': ' + r.status + ' ' + body.slice(0, 200));
        break;
      }
      const d = await r.json();
      if (Array.isArray(d.records)) allRecords.push(...d.records);
      offset = d.offset;
      pages += 1;
    } catch (err) {
      pageErrors.push('page ' + (pages + 1) + ' threw: ' + (err && err.message ? err.message : String(err)));
      break;
    }
  }

  const target = lunaClientName.toLowerCase();
  let scanned = 0;
  let withSettings = 0;
  let withLuna = 0;
  for (const rec of allRecords) {
    scanned += 1;
    const fields = rec.fields || {};
    const settings = parseSettings(getSettingsRaw(fields));
    if (!settings) continue;
    withSettings += 1;

    const luna = settings.lunaIntegration;
    if (!luna || !luna.connected) continue;
    withLuna += 1;
    if (typeof luna.clientName !== 'string') continue;

    if (luna.clientName.trim().toLowerCase() === target) {
      return res.status(200).json({
        widgetId: rec.id,
        connected: true,
        clientName: luna.clientName
      });
    }
  }

  // Not found — but include diagnostics so we can see what was scanned.
  return res.status(404).json({
    error: 'not_found',
    diagnostics: {
      scannedRecords: scanned,
      recordsWithSettings: withSettings,
      recordsWithLunaConnected: withLuna,
      requestedClientName: lunaClientName,
      pageErrors: pageErrors.length ? pageErrors : undefined
    }
  });
}
