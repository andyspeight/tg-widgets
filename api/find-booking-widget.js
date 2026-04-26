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
 * No auth required.
 */

import Airtable from 'airtable';
import { setCors, sanitiseForFormula } from './_auth.js';

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
const rateLimitWindow = 60 * 1000;
const rateLimitMax = 60;
const rateBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + rateLimitWindow };
  if (now > bucket.resetAt) {
    bucket.count = 1;
    bucket.resetAt = now + rateLimitWindow;
  } else {
    bucket.count += 1;
  }
  rateBuckets.set(ip, bucket);
  return bucket.count > rateLimitMax;
}

function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown')
    .toString().split(',')[0].trim();
}

function notFound(res) {
  return res.status(404).json({ error: 'not_found' });
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (isRateLimited(getIp(req))) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const lunaClientName = String(req.query.lunaClientName || '').trim();
  if (!lunaClientName || lunaClientName.length < 2 || lunaClientName.length > 100) {
    return notFound(res);
  }

  if (!process.env.AIRTABLE_API_KEY) {
    console.error('[find-booking-widget] Missing AIRTABLE_API_KEY env var');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  try {
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(BASE_ID);

    // Filter to active My Booking widgets, then check the Settings JSON for a
    // matching lunaIntegration.clientName. Airtable's formula language can't
    // parse JSON, so we filter by widget type at the API level and walk
    // matching records in JS. A client should typically have <10 widgets.
    const safeName = sanitiseForFormula(lunaClientName);
    const records = await base(WIDGETS_TABLE).select({
      filterByFormula: `AND({${F_TYPE}} = 'My Booking', NOT({Status} = 'Archived'))`,
      maxRecords: 100,
      fields: [F_NAME, F_TYPE, F_SETTINGS],
    }).all();

    for (const rec of records) {
      const rawSettings = rec.get(F_SETTINGS);
      if (!rawSettings) continue;
      let settings;
      if (typeof rawSettings === 'object') {
        settings = rawSettings;
      } else {
        try { settings = JSON.parse(rawSettings); } catch { continue; }
      }
      const luna = settings && settings.lunaIntegration;
      if (!luna || !luna.connected) continue;
      // Case-insensitive comparison — Luna client names aren't case-sensitive
      // when the install snippet is parsed, so we match the same way here.
      if (typeof luna.clientName === 'string' &&
          luna.clientName.trim().toLowerCase() === lunaClientName.toLowerCase()) {
        return res.status(200).json({
          widgetId: rec.id,
          connected: true,
          clientName: luna.clientName,
        });
      }
    }

    return notFound(res);
  } catch (err) {
    console.error('[find-booking-widget] Lookup error:', err.message);
    return res.status(500).json({ error: 'lookup_failed' });
  }
}
