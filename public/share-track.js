// =============================================================================
//  /api/share-track.js
// =============================================================================
//
//  Receives share-click events from the Social Share widget on a client page.
//  Public endpoint — no auth required, fail-open by design.
//
//  Phase 1 (current): accept the request, validate, drop. Logs to stdout for
//  visibility but does NOT write to Airtable yet.
//
//  Phase 2 (next session): when the ShareClicks Airtable table exists, write
//  one record per click. Schema proposed:
//    - WidgetID (linked record → Widgets table)
//    - Platform (singleSelect: whatsapp | facebook | twitter | linkedin |
//                pinterest | reddit | email | sms | copy | native)
//    - PageURL (URL)
//    - ClickedAt (createdTime, system field)
//
//  Why a no-op now: the widget calls navigator.sendBeacon() which fires on
//  click and never blocks the share itself. A 404 here would log noise in
//  client-side consoles every time a visitor shares. A 204 keeps that quiet
//  while we figure out the storage shape.
//
// =============================================================================

const ALLOWED_PLATFORMS = new Set([
  'whatsapp', 'facebook', 'twitter', 'linkedin', 'pinterest',
  'reddit', 'email', 'sms', 'copy', 'native',
]);

const MAX_PAYLOAD_BYTES = 4 * 1024;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// In-memory IP throttle — simple guard against accidental floods
const ipBuckets = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 60;
function rateLimited(ip) {
  const now = Date.now();
  const bucket = ipBuckets.get(ip) || [];
  const fresh = bucket.filter(t => now - t < RATE_WINDOW_MS);
  if (fresh.length >= RATE_MAX) {
    ipBuckets.set(ip, fresh);
    return true;
  }
  fresh.push(now);
  ipBuckets.set(ip, fresh);
  return false;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Beacons can land as POST with text/plain content-type. Accept both.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit
  const ip = getClientIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Parse body — Vercel may pre-parse JSON; sendBeacon may send a Blob string.
  let payload = req.body;
  try {
    if (typeof payload === 'string') {
      // Cap size before parsing
      if (payload.length > MAX_PAYLOAD_BYTES) {
        return res.status(413).json({ error: 'Payload too large' });
      }
      payload = JSON.parse(payload);
    } else if (payload && typeof payload === 'object') {
      // already parsed by Vercel
    } else {
      payload = {};
    }
  } catch (e) {
    // Invalid JSON — return 204 anyway so we don't spam client consoles.
    return res.status(204).end();
  }

  // Validate fields
  const widgetId = typeof payload.widgetId === 'string' ? payload.widgetId.slice(0, 32) : '';
  const platform = typeof payload.platform === 'string' ? payload.platform.toLowerCase().slice(0, 24) : '';
  const pageUrl = typeof payload.pageUrl === 'string' ? payload.pageUrl.slice(0, 500) : '';

  if (!widgetId || !ALLOWED_PLATFORMS.has(platform)) {
    return res.status(204).end();
  }

  // Phase 1: structured log only.
  // Anything inside the literal `[share-track]` prefix can be grepped later.
  console.log('[share-track]', JSON.stringify({
    widgetId,
    platform,
    pageUrl,
    ip: ip.slice(0, 64),
    ts: new Date().toISOString(),
  }));

  return res.status(204).end();
}
