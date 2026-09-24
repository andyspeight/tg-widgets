/**
 * Travelgenix Widget Suite — Weather Current API
 * /api/weather-current
 *
 * Proxies MET Norway's Locationforecast with Travelgenix hardening on top:
 *   - Strict lat/lng validation (rejects anything that isn't a plausible coordinate)
 *   - In-memory rate limiting per IP (anonymous, public endpoint)
 *   - Edge cache for as long as MET says its forecast holds (15 min to 1 hour)
 *   - Open CORS (*), like every other public widget read: the widget runs on
 *     client websites, so a locked list would silently blank it on all of them
 *   - Uniform error shape that never leaks upstream details
 *   - Opinionated response shape — we return only what the widget needs,
 *     not whatever the source happens to send. Stable contract: the same
 *     fields and WMO weather codes whichever service is behind it.
 *
 * Upstream: MET Norway (the Norwegian Meteorological Institute, the data
 * behind yr.no), Locationforecast 2.0, https://api.met.no. Chosen 24 Sep 2026
 * because it is free INCLUDING commercial use, with no key: Andy asked for a
 * free service once it turned out Open-Meteo's free tier is non-commercial
 * only, and weather on paying clients' websites is commercial.
 *   - Licence: NLOD 2.0 and CC BY 4.0, credit to MET Norway. The widget shows
 *     "Data by MET Norway" on the strip. Keep that credit wherever this data
 *     is shown.
 *   - Their terms: identify the application in the User-Agent (a missing or
 *     generic one is refused with 403), do not ask again before the Expires
 *     time they send, stay under 20 requests a second in total. The edge
 *     cache keeps us far below that: one call per place per cache period,
 *     however many visitors that place has.
 *   - They send no "feels like", so it is worked out here (apparentTemp), and
 *     wind comes in m/s and leaves as km/h, as it always has.
 *
 * Usage from the widget:
 *   GET /api/weather-current?lat=35.3728&lng=25.7500&units=c
 *   →  { ok:true, temp:27, feels:29, code:1, desc:"Mainly clear",
 *        icon:"sun-cloud", wind:12, humidity:58, isDay:true,
 *        updated:"2026-04-23T10:15:00Z", source:"met-norway" }
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

// Edge cache duration (Vercel).
// Weather changes but not that fast. Fresh for as long as MET Norway's
// Expires header says (their terms ask us not to ask sooner), but never less
// than 15 minutes nor more than an hour. The stale window is much longer so a
// quiet client site (no visitor within the fresh window) still serves an
// instant, slightly-older reading and refreshes it in the background, rather
// than making that visitor wait on the upstream. A few hours stale at worst,
// and only until the next visitor triggers the background refresh.
const CACHE_SECONDS = 900;                   // at least 15 minutes fresh
const CACHE_MAX_SECONDS = 3600;              // at most an hour
const STALE_WHILE_REVALIDATE = 14400;        // then serve stale up to 4 hours while revalidating
const BROWSER_SECONDS = 300;                 // the visitor's own browser: 5 minutes

// Upstream: MET Norway Locationforecast 2.0, the compact form (all we use).
const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
// MET requires every request to name the application and a way to reach its
// owner. MET_NO_USER_AGENT in Vercel overrides this, e.g. to add an email.
const DEFAULT_USER_AGENT = 'TravelgenixWidgets/1.2 (+https://widgets.travelify.io)';
const UPSTREAM_TIMEOUT_MS = 4000;

// ─────────────────────────────────────────────────────────────────────────────
// WMO weather code → icon + description
// The route has always answered in WMO weather codes, and the widget translates
// them into six languages, so MET's symbol codes are mapped onto them below.
// 68/69 and 83/84 are WMO's "rain and snow mixed" (sleet) and its showers.
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
  68: { icon: 'rain',        desc: 'Light sleet' },
  69: { icon: 'rain',        desc: 'Sleet' },
  71: { icon: 'snow',        desc: 'Light snow' },
  73: { icon: 'snow',        desc: 'Moderate snow' },
  75: { icon: 'snow',        desc: 'Heavy snow' },
  77: { icon: 'snow',        desc: 'Snow grains' },
  80: { icon: 'rain',        desc: 'Light rain showers' },
  81: { icon: 'rain',        desc: 'Rain showers' },
  82: { icon: 'rain',        desc: 'Violent rain showers' },
  83: { icon: 'rain',        desc: 'Light sleet showers' },
  84: { icon: 'rain',        desc: 'Sleet showers' },
  85: { icon: 'snow',        desc: 'Light snow showers' },
  86: { icon: 'snow',        desc: 'Heavy snow showers' },
  95: { icon: 'storm',       desc: 'Thunderstorm' },
  96: { icon: 'storm',       desc: 'Thunderstorm with light hail' },
  99: { icon: 'storm',       desc: 'Thunderstorm with heavy hail' },
};

// MET Norway symbol code, less its _day / _night / _polartwilight suffix, to
// the nearest WMO code. Every "...andthunder" symbol is a thunderstorm (95).
// MET has no drizzle or hail symbols, so those WMO codes simply never appear.
const MET_TO_WMO = {
  clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45,
  lightrain: 61, rain: 63, heavyrain: 65,
  lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82,
  lightsleet: 68, sleet: 69, heavysleet: 69,
  lightsleetshowers: 83, sleetshowers: 84, heavysleetshowers: 84,
  lightsnow: 71, snow: 73, heavysnow: 75,
  lightsnowshowers: 85, snowshowers: 85, heavysnowshowers: 86,
};

export function metSymbolToWmo(symbol) {
  const base = String(symbol || '').split('_')[0].toLowerCase();
  if (!base) return null;
  if (base.includes('thunder')) return 95;
  return Object.prototype.hasOwnProperty.call(MET_TO_WMO, base) ? MET_TO_WMO[base] : null;
}

// "Feels like": the apparent temperature the Australian Bureau of Meteorology
// publishes (Steadman), from air temperature (C), relative humidity (%) and
// wind (m/s). MET Norway does not send one.
export function apparentTemp(tC, rh, windMs) {
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * tC) / (237.7 + tC));
  return tC + 0.33 * e - 0.70 * windMs - 4.0;
}

// The forecast hour nearest now: the last one that starts no more than 30
// minutes from now (so at 13:40 it is the 14:00 hour, at 13:20 the 13:00).
function currentSlot(series, nowMs) {
  if (!Array.isArray(series) || !series.length) return null;
  let pick = series[0];
  for (const s of series) {
    const t = Date.parse(s && s.time);
    if (!Number.isFinite(t)) continue;
    if (t <= nowMs + 30 * 60 * 1000) pick = s; else break;
  }
  return pick;
}

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
  // Round to 4dp — forecast grids are kilometres wide so extra precision is
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
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': String(process.env.MET_NO_USER_AGENT || '').trim() || DEFAULT_USER_AGENT,
        'Accept': 'application/json',
      },
    });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

export function shapeResponse(raw, units, nowMs = Date.now()) {
  const props = raw && raw.properties;
  const slot = currentSlot(props && props.timeseries, nowMs);
  const data = slot && slot.data;
  const d = data && data.instant && data.instant.details;
  if (!d) return null;
  const tC = Number(d.air_temperature);
  if (d.air_temperature == null || !Number.isFinite(tC)) return null;
  const rh = d.relative_humidity != null && Number.isFinite(Number(d.relative_humidity)) ? Number(d.relative_humidity) : null;
  const ws = d.wind_speed != null && Number.isFinite(Number(d.wind_speed)) ? Number(d.wind_speed) : null;   // m/s
  const next = data.next_1_hours || data.next_6_hours || data.next_12_hours;
  const symbol = String((next && next.summary && next.summary.symbol_code) || '');
  const code = metSymbolToWmo(symbol);
  const wmo = code !== null ? WMO[code] : null;
  const feelsC = rh !== null ? apparentTemp(tC, rh, ws || 0) : null;
  const conv = (c) => (units === 'f' ? c * 9 / 5 + 32 : c);
  const updated = props.meta && typeof props.meta.updated_at === 'string' ? props.meta.updated_at : '';
  return {
    ok: true,
    temp: Math.round(conv(tC)),
    feels: feelsC === null ? null : Math.round(conv(feelsC)),
    code,
    desc: wmo ? wmo.desc : '',
    icon: wmo ? wmo.icon : 'sun-cloud',
    wind: ws === null ? null : Math.round(ws * 3.6),   // km/h
    humidity: rh === null ? null : Math.round(rh),
    isDay: !/_night$/.test(symbol),
    units,                                         // echo back so widget knows
    updated: /^\d{4}-\d{2}-\d{2}T/.test(updated) ? updated : new Date(nowMs).toISOString(),
    source: 'met-norway',
  };
}

// How long the edge may treat this answer as fresh: until MET's Expires, held
// between 15 minutes and an hour.
function freshSeconds(upstream) {
  let exp = NaN;
  try { exp = Date.parse(upstream.headers.get('expires')); } catch { /* no headers */ }
  if (!Number.isFinite(exp)) return CACHE_SECONDS;
  return Math.max(CACHE_SECONDS, Math.min(CACHE_MAX_SECONDS, Math.round((exp - Date.now()) / 1000)));
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
  // influence the upstream URL beyond the two coordinates we validated. MET
  // asks for no more than 4 decimals, which validateCoords already rounds to.
  const params = new URLSearchParams({
    lat: String(coords.lat),
    lon: String(coords.lng),
  });
  const upstreamUrl = `${MET_URL}?${params.toString()}`;

  let upstream;
  try {
    upstream = await fetchWithTimeout(upstreamUrl, UPSTREAM_TIMEOUT_MS);
  } catch (e) {
    // Timeout or network error. Don't leak the upstream URL or error object.
    return fail(res, 502, 'Upstream weather service unavailable');
  }

  if (!upstream.ok) {
    // MET refused the request (403 for a bad User-Agent, 429 when throttled).
    // Don't pass its body through — that's potentially an attack surface and
    // might leak details. Map to 502, which is never cached.
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

  // Edge cache: fresh until MET's Expires (15 min to an hour), then served
  // stale for up to 4 hours while it revalidates in the background, so a quiet
  // site never waits on the upstream.
  // The browser keeps it for 5 minutes too, so the editor's preview (which
  // reloads on every keystroke) and a page with several widgets for the same
  // place ask once.
  res.setHeader(
    'Cache-Control',
    `public, max-age=${BROWSER_SECONDS}, s-maxage=${freshSeconds(upstream)}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`
  );
  // The query string (lat, lng, units) is already part of the cache key, so a
  // °F answer can never reach a °C request. No Vary: Origin: with open CORS the
  // answer is the same for every site, so every site shares one cache entry.
  res.setHeader('Vary', 'Accept-Encoding');

  res.status(200).json(shaped);
}
