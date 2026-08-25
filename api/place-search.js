/**
 * Travelgenix Widget Suite — Google business search (for the Reviews editor)
 * /api/place-search?q=<business name>
 *
 * The Reviews editor lets a client type their business name and pick it from a
 * dropdown, exactly like the good review widgets — no opaque "Place ID" to hunt
 * down. Wextractor (our reviews provider) can only take a Google Place ID, it
 * cannot search by name, so this endpoint resolves a name to its matches using
 * Google's own Places Text Search (New). The client picks one, we store its
 * Place ID, and the reviews feed pulls the reviews through Wextractor as usual.
 *
 * This runs ONLY from our editor (when a client sets up their widget), never on
 * a visitor's page, so the call volume is tiny and the cost is pennies. The key
 * is ours (env GOOGLE_PLACES_API_KEY), held server-side; a missing key fails
 * clean at 503 without calling Google.
 *
 * Response:
 *   { ok:true, results:[ { placeId, name, address, rating, total } ] }
 */

'use strict';

// ─── CORS (same posture as the other widget data endpoints) ──────────────────
const ALLOWED_ORIGINS = [
  'https://tg-widgets.vercel.app',
  'https://widgets.travelify.io',
  'https://www.travelgenix.io',
  'https://travelgenix.io',
  'https://www.traveldemo.site',
  'https://traveldemo.site',
];
const EXTRA_ORIGINS = (process.env.TG_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin) || EXTRA_ORIGINS.includes(origin)) return true;
  try {
    const h = new URL(origin).hostname;
    if (h === 'duda.co' || h.endsWith('.duda.co') || h.endsWith('.dudamobile.com') || h.endsWith('.multiscreensite.com')) return true;
  } catch (e) { /* ignore */ }
  return false;
}
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ─── Rate limit (per IP) ─────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 40;
const ipHits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) { for (const [k, v] of ipHits) { if (!v.length || now - v[v.length - 1] > RATE_LIMIT_WINDOW_MS) ipHits.delete(k); } }
  return hits.length > RATE_LIMIT_MAX;
}

function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

// ─── Google Places Text Search (New) ─────────────────────────────────────────
const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount';
const PLACES_TIMEOUT_MS = 6000;
const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

/** Map a Places Text Search (New) response to our small result shape. Pure — unit-tested. */
export function parsePlaces(j) {
  const places = Array.isArray(j && j.places) ? j.places : [];
  const out = [];
  for (const p of places) {
    const placeId = String((p && p.id) || '');
    const name = clip((p && p.displayName && (p.displayName.text || p.displayName)) || (p && p.name) || '', 120);
    if (!placeId || !name) continue;
    out.push({
      placeId,
      name,
      address: clip((p && p.formattedAddress) || '', 200),
      rating: Number(p && p.rating) || 0,
      total: Number(p && p.userRatingCount) || 0,
    });
    if (out.length >= 6) break;
  }
  return out;
}

async function searchPlaces(q) {
  if (!GOOGLE_PLACES_KEY) return { error: 'Business search is not set up yet.', status: 503 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLACES_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(PLACES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: q, languageCode: 'en' }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return { error: e.name === 'AbortError' ? 'The search took too long.' : 'Could not reach business search.', status: e.name === 'AbortError' ? 504 : 502 };
  }
  clearTimeout(timer);

  if (!r.ok) {
    // Surface Google's own reason so a setup problem (API not enabled, billing
    // off, key restriction) names itself instead of hiding behind a generic line.
    let detail = '';
    try { const j = await r.json(); detail = (j && j.error && (j.error.message || j.error.status)) || ''; } catch (e) {}
    if (detail) console.error('[place-search] Google', r.status, detail);
    if (r.status === 401 || r.status === 403) {
      return { error: detail ? ('Google refused the search: ' + String(detail)) : 'Google refused the search — check the key is enabled for Places API (New), billing is on, and any key restriction allows it.', status: 502 };
    }
    return { error: detail ? ('Business search error: ' + String(detail)) : 'Business search returned an error.', status: 502 };
  }
  let j;
  try { j = await r.json(); } catch (e) { return { error: 'Could not read the search response.', status: 502 }; }
  return { ok: true, results: parsePlaces(j) };
}

function fail(res, status, error) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ ok: false, error });
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (rateLimited(ip)) return fail(res, 429, 'Too many searches — please slow down.');

  const q = String(req.query.q || '').trim();
  if (q.length < 3) return fail(res, 400, 'Type at least three characters.');
  if (q.length > 120) return fail(res, 400, 'That search is too long.');

  const result = await searchPlaces(q);
  if (result.error) return fail(res, result.status || 502, result.error);

  // Editor-only + names change slowly — a short edge cache trims duplicate
  // lookups while a client is typing without hiding new businesses for long.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  return res.status(200).json({ ok: true, results: result.results, count: result.results.length });
}

// Exposed for unit tests — never used at runtime.
export const _test = { parsePlaces, searchPlaces };
