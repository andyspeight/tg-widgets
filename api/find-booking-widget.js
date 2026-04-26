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
 * No auth required. No third-party npm dependencies — uses native fetch
 * against the Airtable REST API.
 *
 * Module type: ESM (matches the rest of tg-widgets).
 */

const BASE_ID = 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';

// Field IDs — match the rest of the codebase
const F_NAME = 'fldNVCcOLs0vLAYOk';
const F_TYPE = 'fldZH88nElhBLNo7N';
const F_SETTINGS = 'fldGRGAUjxfAPAHLz';

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

  try {
    // Filter to active My Booking widgets, then walk results in JS to inspect
    // the Settings JSON. Airtable formula language can't parse JSON, so we
    // pre-filter by widget type at the API level. A client typically has
    // <100 widgets, well within one page.
    const formula = `{${F_TYPE}} = 'My Booking'`;
    const url = 'https://api.airtable.com/v0/' + BASE_ID + '/' + WIDGETS_TABLE
      + '?filterByFormula=' + encodeURIComponent(formula)
      + '&pageSize=100'
      + '&fields%5B%5D=' + encodeURIComponent(F_NAME)
      + '&fields%5B%5D=' + encodeURIComponent(F_TYPE)
      + '&fields%5B%5D=' + encodeURIComponent(F_SETTINGS);

    const atRes = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json' }
    });

    if (!atRes.ok) {
      const errBody = await atRes.text().catch(() => '');
      console.error('[find-booking-widget] Airtable error', atRes.status, errBody.slice(0, 300));
      return res.status(500).json({ error: 'lookup_failed' });
    }

    const data = await atRes.json();
    const records = Array.isArray(data.records) ? data.records : [];
    const target = lunaClientName.toLowerCase();

    for (const rec of records) {
      const fields = rec.fields || {};
      const rawSettings = fields[F_SETTINGS];
      if (!rawSettings) continue;

      let settings;
      if (typeof rawSettings === 'object') {
        settings = rawSettings;
      } else if (typeof rawSettings === 'string') {
        try { settings = JSON.parse(rawSettings); } catch (_) { continue; }
      } else {
        continue;
      }

      const luna = settings && settings.lunaIntegration;
      if (!luna || !luna.connected) continue;
      if (typeof luna.clientName !== 'string') continue;

      // Case-insensitive comparison — Luna client names aren't case-sensitive
      // when the install snippet is parsed, so we match the same way here.
      if (luna.clientName.trim().toLowerCase() === target) {
        return res.status(200).json({
          widgetId: rec.id,
          connected: true,
          clientName: luna.clientName
        });
      }
    }

    return res.status(404).json({ error: 'not_found' });
  } catch (err) {
    console.error('[find-booking-widget] Lookup error:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'lookup_failed' });
  }
}
