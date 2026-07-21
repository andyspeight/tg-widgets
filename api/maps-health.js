/**
 * GET /api/maps-health
 * MapTiler key health probe for the map widgets.
 *
 * The Maps and World Map widgets (and the paid-compare page and the Maps
 * editor's geocoding search) all ride on one shared, domain-restricted
 * MapTiler key that lives in client-side code. When that key stops working
 * the maps just go blank — a tile-level 403 happens after Leaflet has
 * initialised, so widget telemetry never hears about it and MapTiler's real
 * error message is only visible in a visitor's network tab.
 *
 * This endpoint fetches one tile server-side under three origin conditions
 * (none, ours, foreign) plus one geocoding lookup, and returns MapTiler's
 * exact status and body for each. The combination separates the failure
 * modes at a glance:
 *   - all four fail        → key deleted / quota exhausted / account issue
 *                            (the body says which)
 *   - only "ours" fails    → our domain fell off the key's allowlist
 *   - only "foreign" fails → restriction working as intended, key healthy
 *
 * Public and GET-only on purpose: the key is already visible in the widget
 * source, and the response contains nothing that isn't. Query input is
 * ignored. A short in-module memo (plus CDN caching) keeps repeat calls from
 * multiplying probe traffic.
 */

// Same shared key as widget-maps.js / widget-worldmap.js. Kept literal so the
// probe tests exactly what the widgets ship, not an env var that could drift.
const MAPTILER_KEY = 'zSDRMRY6Fi2YzknQVzXf';
const TILE_URL = `https://api.maptiler.com/maps/streets-v2/1/0/0.png?key=${MAPTILER_KEY}`;
const GEOCODE_URL = `https://api.maptiler.com/geocoding/London.json?key=${MAPTILER_KEY}&limit=1`;

const MEMO_MS = 60 * 1000;
let memo = null; // { at: epoch ms, payload }

async function probe(label, url, origin) {
  const headers = {};
  if (origin) {
    headers.Origin = origin;
    headers.Referer = origin + '/';
  }
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(6000), redirect: 'follow' });
    let message = '';
    if (!r.ok) {
      try { message = (await r.text()).slice(0, 300); } catch { /* body unreadable */ }
    }
    return { label, status: r.status, ok: r.ok, message };
  } catch (err) {
    return { label, status: 0, ok: false, message: String(err && err.message || err).slice(0, 300) };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (memo && Date.now() - memo.at < MEMO_MS) {
    return res.status(200).json(memo.payload);
  }

  const probes = await Promise.all([
    probe('tile (no origin)', TILE_URL, ''),
    probe('tile (widgets.travelify.io)', TILE_URL, 'https://widgets.travelify.io'),
    probe('tile (foreign origin)', TILE_URL, 'https://not-a-travelgenix-site.example'),
    probe('geocoding (no origin)', GEOCODE_URL, ''),
  ]);

  const payload = {
    at: new Date().toISOString(),
    healthy: probes[0].ok && probes[1].ok,
    probes,
  };
  memo = { at: Date.now(), payload };
  return res.status(200).json(payload);
}
