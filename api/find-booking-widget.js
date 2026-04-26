/**
 * GET /api/find-booking-widget?lunaClientName=X
 *
 * Public lookup. Returns the My Booking widget ID linked to a given Luna
 * chat client name. Called by luna-chat-endpoint at runtime to discover
 * whether the visitor's site has booking lookup enabled.
 *
 * Returns:
 *   200 { widgetId: "rec...", connected: true, clientName: "..." }   when found
 *   404 { error: "not_found" }                                        when no widget links to that client
 *
 * Why this is safe to expose publicly:
 *   - The widget ID alone does NOT grant any data access. Customer data
 *     retrieval still requires a valid email + booking ref + departure date,
 *     which an attacker would not have.
 *   - The Luna client name is itself essentially public — it's embedded in
 *     the install snippet on every page that runs Luna.
 *   - Rate limited per IP to prevent enumeration scans.
 *
 * Implementation: no third-party dependencies, no Airtable formula. We list
 * all widget records and filter in JS. Any widget with a parseable
 * lunaIntegration block in its Settings JSON wins regardless of its Type
 * field — that's the only signal we trust anyway, since the editor only
 * writes lunaIntegration when the user explicitly connects.
 *
 * Module type: ESM (matches the rest of tg-widgets).
 */

const BASE_ID = 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';

// Simple in-memory rate limit. 60 lookups per IP per minute is more than
// enough for legitimate use (Luna caches the result per session anyway).
// Resets when the function cold-starts, which is fine — abuse would still
// surface in Vercel logs.
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

// Walk a Settings field and return parsed JSON, or null. Settings can be
// stored as a JSON string or, in newer rows, as already-parsed objects.
function parseSettings(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

// Find the Settings field on a record, by trying common field names in order.
// Avoids hard-coding a field ID that might not match this base.
const SETTINGS_FIELD_CANDIDATES = ['Settings', 'settings', 'Config', 'config'];

function getSettingsRaw(fields) {
  for (const name of SETTINGS_FIELD_CANDIDATES) {
    if (fields[name] !== undefined) return fields[name];
  }
  // Last resort: hunt for any field whose value parses as JSON containing
  // a lunaIntegration key. This is defensive and only matters if someone
  // renames the field upstream.
  for (const key of Object.keys(fields)) {
    const parsed = parseSettings(fields[key]);
    if (parsed && parsed.lunaIntegration) return fields[key];
  }
  return null;
}

// Fetch all widget records via Airtable's pagination. Limited to 5 pages
// (500 records) as a safety net — a single tg-widgets base shouldn't have
// more than that, and if it does we'll log and proceed with what we have.
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

  // Parse the lunaClientName from query string. Vercel populates req.query
  // for serverless functions, but fall back to URL parsing just in case.
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
    console.error('[find-booking-widget] No Airtable key in env (tried AIRTABLE_API_KEY, AIRTABLE_KEY, AIRTABLE_TOKEN, AIRTABLE_PAT)');
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
      return res.status(200).json({
        widgetId: rec.id,
        connected: true,
        clientName: luna.clientName
      });
    }
  }

  return res.status(404).json({ error: 'not_found' });
}
