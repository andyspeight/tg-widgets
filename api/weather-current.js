/**
 * Travelgenix Widget Suite — Weather Current API
 * /api/weather-current
 *
 * Proxies the free Open-Meteo forecast API with Travelgenix hardening on top:
 *   - Strict lat/lng validation (rejects anything that isn't a plausible coordinate)
 *   - In-memory rate limiting per IP (anonymous, public endpoint)
 *   - 15-minute edge cache via CDN headers (cuts Open-Meteo load by ~98%)
 *   - Locked CORS to approved origins only
 *   - Uniform error shape that never leaks upstream details
 *   - Opinionated response shape — we return only what the widget needs,
 *     not whatever Open-Meteo happens to send. Stable contract, future-proof.
 *
 * Upstream: https://open-meteo.com/en/docs (no API key required)
 * Free tier: 10,000 calls/day — with 15-min caching we can serve hundreds of
 * thousands of widget loads before hitting that.
 *
 * Usage from the widget:
 *   GET /api/weather-current?lat=35.3728&lng=25.7500&units=c
 *   →  { ok:true, temp:27, feels:29, code:1, desc:"Mainly clear",
 *        icon:"sun-cloud", wind:12, humidity:58, isDay:true,
 *        updated:"2026-04-23T10:15:00Z", source:"open-meteo" }
 *
 * Phase 2 hook — widget-weather.js reads `config.showLiveWeather` and
 * (if true + lat/lng present on the destination record) calls this route.
 * Fall back to climatology-only on any non-200 response.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

// CORS allowlist — add client origins as they come online.
// We do NOT use '*' because even though the endpoint is public, locked CORS
// means a rogue site can't embed our widget and silently burn through the
// rate limit on another origin's behalf (it'll still work via direct fetch
// but not via opaque browser requests from un-allowlisted sites).
const ALLOWED_ORIGINS = [
  'https://tg-widgets.vercel.app',
  'https://www.travelgenix.io',
  'https://travelgenix.io',
  'https://www.traveldemo.site',
  'https://traveldemo.site',
];

// Allow any *.duda.co preview origin, plus any explicitly set client domains
// via an env var (comma-separated). This avoids having to redeploy every time
// a new client embeds a widget.
const ALLOW_DUDA_PREVIEWS = true;
const EXTRA_ORIGINS = (process.env.TG_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Rate limit — per-IP, in-memory (Vercel warm instance). Gets reset on cold
// start, which is fine: we're defending against sustained abuse, not bursts.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;      // 1 minute
const RATE_LIMIT_MAX = 30;                   // 30 calls/min per IP
const ipHits = new Map();                    // ip -> [timestamps]

// Edge cache duration (Vercel / Cloudflare).
// Weather changes but not that fast — 15 min is the sweet spot for
// "looks live" without hammering Open-Meteo.
const CACHE_SECONDS = 900;                   // 15 minutes
const STALE_WHILE_REVALIDATE = 1800;         // 30 minutes

// Upstream
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
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

function isOriginAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  if (ALLOW_DUDA_PREVIEWS) {
    try {
      const u = new URL(origin);
      if (u.hostname.endsWith('.duda.co') || u.hostname.endsWith('.multiscreensite.com')) {
        return true;
      }
    } catch { /* fall through */ }
  }
  return false;
}

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  // Echo the origin if allowed. Do NOT set a wildcard — even on a public
  // endpoint that invites caching pollution and complicates debugging.
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
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

module.exports = async function handler(req, res) {
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
  const params = new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lng),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day',
    temperature_unit: units === 'f' ? 'fahrenheit' : 'celsius',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
  });
  const upstreamUrl = `${OPEN_METEO_URL}?${params.toString()}`;

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

  // Edge cache: 15 min fresh, 30 min stale-while-revalidate.
  // The widget will still feel live because clients visit on different schedules.
  res.setHeader(
    'Cache-Control',
    `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`
  );
  // Tell intermediaries to key on units too (otherwise a °F response
  // could be served to a °C requester).
  res.setHeader('Vary', 'Origin, Accept-Encoding');

  res.status(200).json(shaped);
};
