/**
 * POST /api/sea-route  ·  Travelgenix Widget Suite
 *
 * Given ordered cruise ports, return a maritime route polyline that stays OFF
 * land. Used by the offer builder's Cruise route section and stored on the
 * offer, so the offer page can draw the route without any live routing.
 *
 * Body:   { ports: [{ lat, lng, name? }, ...] }   (2..14 ordered ports)
 * Returns { ok: true, line: [[lng, lat], ...], nm, ports }
 *
 * The route is computed with searoute-js over a bundled marine network — NO
 * external calls at runtime — by finding the sea path between each consecutive
 * pair of ports and stitching them into one line. A pair that will not snap to
 * the network falls back to a straight leg so the line is never broken.
 */
import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import searoute from 'searoute-js';

const MAX_PORTS = 14;

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return null; } }
  return (b && typeof b === 'object') ? b : null;
}
function ipOf(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function feat(p) {
  return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } };
}

// searoute-js logs internally; silence it so it does not flood the function logs.
function quietSearoute(a, b) {
  const orig = console.log;
  console.log = function () {};
  try { return searoute(a, b); }
  catch (e) { return null; }
  finally { console.log = orig; }
}

// Pure: ordered ports → { line: [[lng, lat] ...], nm }. Exported for tests.
export function computeRoute(ports) {
  const line = [];
  let nm = 0;
  for (let i = 0; i < ports.length - 1; i++) {
    const seg = quietSearoute(feat(ports[i]), feat(ports[i + 1]));
    let coords = (seg && seg.geometry && Array.isArray(seg.geometry.coordinates)) ? seg.geometry.coordinates.slice() : null;
    if (coords && coords.length >= 2) {
      if (seg.properties && isFinite(seg.properties.length)) nm += seg.properties.length;
    } else {
      // No sea path found (a port too far from the network) — a straight leg
      // keeps the drawn line continuous rather than broken.
      coords = [[ports[i].lng, ports[i].lat], [ports[i + 1].lng, ports[i + 1].lat]];
    }
    if (i > 0 && line.length) coords.shift(); // drop the point shared with the previous leg
    for (const c of coords) {
      const lng = Number(c[0]), lat = Number(c[1]);
      if (isFinite(lng) && isFinite(lat)) line.push([lng, lat]);
    }
  }
  return { line, nm: Math.round(nm) };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!applyRateLimit(res, 'searoute:' + ipOf(req), RATE_LIMITS.widgetWrite)) return;

  const body = readBody(req);
  if (!body) return res.status(400).json({ error: 'Body is not valid JSON.' });

  const raw = Array.isArray(body.ports) ? body.ports.slice(0, MAX_PORTS) : [];
  const ports = raw.map((p) => ({
    lat: Number(p && p.lat),
    lng: Number(p && p.lng),
    name: String((p && p.name) || '').slice(0, 80),
  })).filter((p) => isFinite(p.lat) && isFinite(p.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180);

  if (ports.length < 2) return res.status(400).json({ error: 'Give at least two ports with coordinates.' });

  try {
    const { line, nm } = computeRoute(ports);
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    return res.status(200).json({ ok: true, line, nm, ports });
  } catch (e) {
    return res.status(500).json({ error: 'Could not build the route.' });
  }
}

export const _test = { computeRoute };
