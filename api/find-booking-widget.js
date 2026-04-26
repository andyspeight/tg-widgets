/**
 * GET /api/find-booking-widget?lunaClientName=X
 *
 * Public lookup. Returns the My Booking widget ID linked to a given Luna
 * chat client name. Called by luna-chat-endpoint at runtime to discover
 * whether the visitor's site has booking lookup enabled.
 *
 * Returns:
 *   200 { widgetId: "tgw_...", connected: true, clientName: "..." }   when found
 *   404 { error: "not_found" }                                         when no widget links to that client
 *
 * Why this is safe to expose publicly:
 *   - The widget ID alone does NOT grant any data access. Customer data
 *     retrieval still requires a valid email + booking ref + departure date,
 *     which an attacker would not have.
 *   - The Luna client name is itself essentially public — it's embedded in
 *     the install snippet on every page that runs Luna.
 *   - Rate limited per IP to prevent enumeration scans.
 *
 * Important: returns the human-readable WidgetID (e.g. "tgw_1776..."), not
 * Airtable's internal record ID. The /api/widget-config endpoint looks up
 * by WidgetID, so that's what Luna needs to embed the widget.
 *
 * Module type: ESM (matches the rest of tg-widgets).
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

// First env var that exists wins. tg-widgets may use any of these names.
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

// The editor saves widget settings under the "Config" field per
// widget-config.js. Fall back to other common names just in case.
const SETTINGS_FIELD_CANDIDATES = ['Config', 'Settings', 'config', 'settings'];

function getSettingsRaw(fields) {
  for (const name of SETTINGS_FIELD_CANDIDATES) {
    if (fields[name] !== undefined) return fields[name];
  }
  // Last-resort scan: find any field whose value parses as JSON containing
  // a lunaIntegration key. Defensive, only matters if someone renames the
  // Config field upstream.
  for (const key of Object.keys(fields)) {
    const parsed = parseSettings(fields[key]);
    if (parsed && parsed.lunaIntegration) return fields[key];
  }
  return null;
}

// Fetch all widget records via Airtable's pagination. Limited to 5 pages
// (500 records) as a safety net.
async function fetchAllWidgets(apiKey) {
  const baseUrl = 'https://api.airtable.com/v0/' + BASE_ID + '/' + WIDGETS_TABLE;
  let offset = '';
  let pages = 0;
  const all = [];

  while (pages < 5) {
    const url = baseUrl + '?pageSize=100' + (offset ? '&offset=' + encodeURIComponent(offset) : '');
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json' }
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('Airtable ' + res.status + ': ' + body.slice(0, 300));
    }

    const data = await res.json();
    if (Array.isArray(data.records)) all.push(...data.records);

    if (!data.offset) break;
    offset = data.offset;
    pages += 1;
  }

  return all;
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
    console.error('[find-booking-widget] No Airtable key in env');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  let records;
  try {
    records = await fetchAllWidgets(apiKey);
  } catch (err) {
    console.error('[find-booking-widget] Airtable fetch failed:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'lookup_failed' });
  }

  const target = lunaClientName.toLowerCase();
  for (const rec of records) {
    const fields = rec.fields || {};
    const settings = parseSettings(getSettingsRaw(fields));
    if (!settings) continue;

    const luna = settings.lunaIntegration;
    if (!luna || !luna.connected) continue;
    if (typeof luna.clientName !== 'string') continue;

    if (luna.clientName.trim().toLowerCase() === target) {
      // Return the human-readable WidgetID field (e.g. "tgw_1776..."), NOT
      // Airtable's internal record ID. /api/widget-config?id= looks up by
      // the WidgetID field, so this is what Luna needs to embed the widget.
      const widgetId = fields.WidgetID;
      if (typeof widgetId !== 'string' || !widgetId) {
        // A widget with lunaIntegration but no WidgetID is a data integrity
        // issue — log and treat as not found rather than returning a broken ID.
        console.warn('[find-booking-widget] Matching widget missing WidgetID, recordId:', rec.id);
        continue;
      }

      return res.status(200).json({
        widgetId: widgetId,
        connected: true,
        clientName: luna.clientName
      });
    }
  }

  return res.status(404).json({ error: 'not_found' });
}
