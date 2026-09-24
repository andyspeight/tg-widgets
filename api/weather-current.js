/**
 * Travelgenix Widget Suite — Weather Current API
 * /api/weather-current
 *
 * Proxies the free Open-Meteo forecast API with Travelgenix hardening on top:
 *   - Strict lat/lng validation (rejects anything that isn't a plausible coordinate)
 *   - In-memory rate limiting per IP (anonymous, public endpoint)
 *   - 15-minute edge cache via CDN headers (cuts Open-Meteo load by ~98%)
 *   - Open CORS (*), like every other public widget read: the widget runs on
 *     client websites, so a locked list would silently blank it on all of them
 *   - Uniform error shape that never leaks upstream details
 *   - Opinionated response shape — we return only what the widget needs,
 *     not whatever Open-Meteo happens to send. Stable contract, future-proof.
 *
 * Upstream: https://open-meteo.com/en/docs
 * Licence: Open-Meteo's free service is for NON-COMMERCIAL use only (up to
 * 10,000 calls a day, no key). Weather on paying clients' websites is
 * commercial, which needs one of their subscriptions: those come with an API
 * key and the customer-api.open-meteo.com host. Set OPEN_METEO_API_KEY in
 * Vercel and this route switches to the commercial host with that key; no
 * code change. The data is CC BY 4.0, so the widget shows a credit line.
 * With the 15-minute edge cache each place costs at most ~100 upstream calls a
 * day however many visitors it has.
 *
 * Usage from the widget:
 *   GET /api/weather-current?lat=35.3728&lng=25.7500&units=c
 *   →  { ok:true, temp:27, feels:29, code:1, desc:"Mainly clear",
 *        icon:"sun-cloud", wind:12, humidity:58, isDay:true,
 *        updated:"2026-04-23T10:15:00Z", source:"open-meteo" }
 *
 * Used by widget-weather.js (1.2.0+) for its "Right now" strip, when the
 * widget's liveWeather switch is on and the destination record carries
 * coordinates (/api/destination-content returns them as `geo`). On any
 * non-200 the widget simply leaves the strip out.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

// CORS is open (*), the convention for every public widget read here
// (setCors in _auth.js). Until 24 Sep 2026 this route echoed only five listed
// origins plus Duda previews, which would have blanked the live strip on every
// client's own website, the one place it has to work. Openness costs nothing:
// the data is public, there is no key or cookie to protect, the per-IP rate
// limit below applies whatever the origin, and the edge cache answers most
// calls without reaching this function at all. One shared cache entry per
// place (no Vary: Origin) is also what keeps that cache effective.

// Rate limit — per-IP, in-memory (Vercel warm instance). Gets reset on cold
// start, which is fine: we're defending against sustained abuse, not bursts.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;      // 1 minute
const RATE_LIMIT_MAX = 30;                   // 30 calls/min per IP
const ipHits = new Map();                    // ip -> [timestamps]

// Edge cache duration (Vercel / Cloudflare).
// Weather changes but not that fast — 15 min is the sweet spot for
// "looks live" without hammering Open-Meteo. The stale window is much longer
// so a quiet client site (no visitor within the fresh window) still serves an
// instant, slightly-older reading and refreshes it in the background, rather
// than making that visitor wait on Open-Meteo. A few hours stale at worst, and
// only until the next visitor triggers the background refresh.
const CACHE_SECONDS = 900;                   // 15 minutes fresh
const STALE_WHILE_REVALIDATE = 14400;        // then serve stale up to 4 hours while revalidating
const BROWSER_SECONDS = 300;                 // the visitor's own browser: 5 minutes

// Upstream. The free host by default; the commercial host once a key is set
// (see the licence note at the top).
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_CUSTOMER_URL = 'https://customer-api.open-meteo.com/v1/forecast';
const UPSTREAM_TIMEOUT_MS = 4000;

// ─────────────────────────────────────────────────────────────────────────────
// WMO weather code → icon + description
// https://open-meteo.com/en/docs → "WMO Weather interpretation codes"
// Icons map to the same vocabulary widget-weather.js already uses.
// ─────────────────────────────────────────────────────────────────────────────
const WMO = {
  0:  { icon: 'sun',         desc: 'Clear sky' },
  1:  { icon: 'sun-cloud',   desc: 'Mainly clear' },
  2:  { icon: 'sun-cloud',   desc: 'Partly cloudy' },
  3:  { icon: 'cloud',       desc: 'Overcast' },
  45: { icon: 'fog',         desc: 'Fog' },
  48: { icon: 'fog',         desc: 'Depositing rime fog' },
  51: { icon: 'drizzle',     desc: 'Light drizzle' },
  53: { icon: 'drizzle',     desc: 'Moderate drizzle' },
  55: { icon: 'drizzle',     desc: 'Dense drizzle' },
  56: { icon: 'drizzle',     desc: 'Light freezing drizzle' },
  57: { icon: 'drizzle',     desc: 'Dense freezing drizzle' },
  61: { icon: 'rain',        desc: 'Light rain' },
  63: { icon: 'rain',        desc: 'Moderate rain' },
  65: { icon: 'rain',        desc: 'Heavy rain' },
  66: { icon: 'rain',        desc: 'Light freezing rain' },
  67: { icon: 'rain',        desc: 'Heavy freezing rain' },
  71: { icon: 'snow',        desc: 'Light snow' },
  73: { icon: 'snow',        desc: 'Moderate snow' },
  75: { icon: 'snow',        desc: 'Heavy snow' },
  77: { icon: 'snow',        desc: 'Snow grains' },
  80: { icon: 'rain',        desc: 'Light rain showers' },
  81: { icon: 'rain',        desc: 'Rain showers' },
  82: { icon: 'rain',        desc: 'Violent rain showers' },
  85: { icon: 'snow',        desc: 'Light snow showers' },
  86: { icon: 'snow',        desc: 'Heavy snow showers' },
  95: { icon: 'storm',       desc: 'Thunderstorm' },
  96: { icon: 'storm',       desc: 'Thunderstorm with light hail' },
  99: { icon: 'storm',       desc: 'Thunderstorm with heavy hail' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function clientIp(req) {
  // Trust Vercel's x-forwarded-for. Take the first value; ignore the rest.
  const xff = req.headers['x-forwarded-for'] || '';
  const first = String(xff).split(',')[0].trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

function rateLimitHit(ip) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (ipHits.get(ip) || []).filter(t => t > cutoff);
  hits.push(now);
  ipHits.set(ip, hits);
  // Opportunistic cleanup — every ~100 requests, prune the map.
  if (ipHits.size > 500 && Math.random() < 0.01) {
    for (const [k, v] of ipHits.entries()) {
      const fresh = v.filter(t => t > cutoff);
      if (fresh.length === 0) ipHits.delete(k);
      else ipHits.set(k, fresh);
    }
  }
  return hits.length > RATE_LIMIT_MAX;
}

/**
 * Validate lat/lng. Reject:
 *   - Non-numeric input
 *   - Out of range (lat: -90..90, lng: -180..180)
 *   - NaN / Infinity
 *   - Obvious placeholders (0,0 — middle of the Atlantic, no real destination)
 * Return { ok:true, lat, lng } or { ok:false, reason }.
 */
function validateCoords(latRaw, lngRaw) {
  if (latRaw == null || lngRaw == null) {
    return { ok: false, reason: 'Missing lat or lng' };
  }
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: 'lat and lng must be numbers' };
  }
  if (lat < -90 || lat > 90) {
    return { ok: false, reason: 'lat out of range' };
  }
  if (lng < -180 || lng > 180) {
    return { ok: false, reason: 'lng out of range' };
  }
  if (lat === 0 && lng === 0) {
    return { ok: false, reason: 'lat/lng cannot both be zero' };
  }
  // Round to 4dp — Open-Meteo grid resolution is ~11km so extra precision is
  // wasted, and rounding improves cache hit rate dramatically.
  return {
    ok: true,
    lat: Math.round(lat * 10000) / 10000,
    lng: Math.round(lng * 10000) / 10000,
  };
}

function validateUnits(u) {
  const v = String(u || 'c').toLowerCase();
  return (v === 'f') ? 'f' : 'c';
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

function shapeResponse(raw, units) {
  const c = raw && raw.current;
  if (!c) return null;
  const code = Number.isFinite(c.weather_code) ? c.weather_code : 0;
  const wmo = WMO[code] || { icon: 'sun-cloud', desc: 'Unknown conditions' };
  return {
    ok: true,
    temp: Math.round(Number(c.temperature_2m)),
    feels: Math.round(Number(c.apparent_temperature)),
    code,
    desc: wmo.desc,
    icon: wmo.icon,
    wind: Math.round(Number(c.wind_speed_10m)),
    humidity: Math.round(Number(c.relative_humidity_2m)),
    isDay: c.is_day === 1,
    units,                                         // echo back so widget knows
    updated: new Date().toISOString(),
    source: 'open-meteo',
  };
}

function fail(res, status, reason) {
  // Uniform error shape. Never leak upstream error bodies.
  res.status(status).json({ ok: false, error: reason });
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

// An ES module, like the rest of api/: this repo is "type": "module", so the
// `module.exports =` this handler used to end with threw "module is not
// defined in ES module scope" on every call and the route answered
// FUNCTION_INVOCATION_FAILED on production (found 24 Sep 2026 while proving
// the Node 24 move; broken on Node 20 too). Guarded by test:api-esm.
export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return fail(res, 405, 'Method not allowed');
  }

  // Rate limit
  const ip = clientIp(req);
  if (rateLimitHit(ip)) {
    res.setHeader('Retry-After', '60');
    return fail(res, 429, 'Too many requests');
  }

  // Validate inputs
  const { lat: rawLat, lng: rawLng, units: rawUnits } = req.query || {};
  const coords = validateCoords(rawLat, rawLng);
  if (!coords.ok) return fail(res, 400, coords.reason);
  const units = validateUnits(rawUnits);

  // Build upstream URL with an explicit, fixed parameter set — no passthrough
  // of arbitrary query params. This is the SSRF guard: we never let the caller
  // influence the upstream URL beyond the two coordinates we validated.
  const apiKey = String(process.env.OPEN_METEO_API_KEY || '').trim();
  const params = new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lng),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day',
    temperature_unit: units === 'f' ? 'fahrenheit' : 'celsius',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
  });
  if (apiKey) params.set('apikey', apiKey);
  const upstreamUrl = `${apiKey ? OPEN_METEO_CUSTOMER_URL : OPEN_METEO_URL}?${params.toString()}`;

  let upstream;
  try {
    upstream = await fetchWithTimeout(upstreamUrl, UPSTREAM_TIMEOUT_MS);
  } catch (e) {
    // Timeout or network error. Don't leak the upstream URL or error object.
    return fail(res, 502, 'Upstream weather service unavailable');
  }

  if (!upstream.ok) {
    // Open-Meteo rejected the request. Don't pass its body through — that's
    // potentially an attack surface and might leak details. Map to 502.
    return fail(res, 502, 'Upstream weather service returned an error');
  }

  let raw;
  try {
    raw = await upstream.json();
  } catch {
    return fail(res, 502, 'Upstream response was not valid JSON');
  }

  const shaped = shapeResponse(raw, units);
  if (!shaped) {
    return fail(res, 502, 'Upstream response missing current weather block');
  }

  // Edge cache: 15 min fresh, then served stale for up to 4 hours while it
  // revalidates in the background, so a quiet site never waits on Open-Meteo.
  // The browser keeps it for 5 minutes too, so the editor's preview (which
  // reloads on every keystroke) and a page with several widgets for the same
  // place ask once.
  res.setHeader(
    'Cache-Control',
    `public, max-age=${BROWSER_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`
  );
  // The query string (lat, lng, units) is already part of the cache key, so a
  // °F answer can never reach a °C request. No Vary: Origin: with open CORS the
  // answer is the same for every site, so every site shares one cache entry.
  res.setHeader('Vary', 'Accept-Encoding');

  res.status(200).json(shaped);
}
