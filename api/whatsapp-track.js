// =============================================================================
//  /api/whatsapp-track.js
// =============================================================================
//
//  Receives "Start chat" click events from the WhatsApp Chat widget on a
//  client page. Public endpoint — no auth, fail-open.
//
//  Phase 1 (current): accept the request, validate, log to stdout.
//  Phase 2 (next session): when the WhatsAppClicks Airtable table exists,
//  write one record per click with WidgetID, AgentIndex, PageURL, ClickedAt.
//
//  Why no-op now: the widget calls navigator.sendBeacon() on click. A 404
//  here would log noise in client-side consoles every time a visitor hits
//  "Start chat". A 204 stays quiet while we shape the storage.
//
// =============================================================================

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

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

  let payload = req.body;
  try {
    if (typeof payload === 'string') {
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
    return res.status(204).end();
  }

  const widgetId = typeof payload.widgetId === 'string' ? payload.widgetId.slice(0, 32) : '';
  const agentIndex = Number.isFinite(Number(payload.agentIndex)) ? Math.max(0, Math.min(20, Math.floor(Number(payload.agentIndex)))) : 0;
  const pageUrl = typeof payload.pageUrl === 'string' ? payload.pageUrl.slice(0, 500) : '';

  if (!widgetId) {
    return res.status(204).end();
  }

  console.log('[whatsapp-track]', JSON.stringify({
    widgetId,
    agentIndex,
    pageUrl,
    ip: ip.slice(0, 64),
    ts: new Date().toISOString(),
  }));

  return res.status(204).end();
}
