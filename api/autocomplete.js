/**
 * /api/autocomplete.js  (ESM)
 * ----------------------------------------------------------------
 * Translating proxy in front of Travelify's location autocomplete.
 *
 * A customer types a place name in their own language ("Londra") and this
 * endpoint turns it into the English name Travelify indexes ("London") on the
 * way in, then puts Travelify's English names back into the customer's language
 * ("Londra") on the way out. To the caller it behaves like a drop-in for
 * https://api.travelify.io/autocomplete — same query-string parameters, same
 * JSON array response, upstream status codes and error bodies relayed as-is.
 *
 * Language comes from the standard Language parameter the search box already
 * sends (Language=ro). Only the small set of names that genuinely differ between
 * languages is translated (see api/_lib/exonyms.js); the long tail passes
 * through untouched, which is the correct match and display for it.
 *
 * AUTH — the proxy holds no Travelify secrets of its own. When the box sends an
 * Authorization header (and Referer) we forward them verbatim. For the MVP demo
 * there is no real box, so with no Authorization present we fall back to
 * Travelify's published demo application (App 250, the same test creds already
 * shipped in api/_lib/travelify.js) so the demo returns real results. Production
 * boxes bring their own login and that fallback is never taken.
 *
 * Scope for the MVP: query translation via a hand-seeded RO dictionary, no AI.
 * See docs/autocomplete-translation-spec.md.
 */

import { setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import { resolveQuery, toLocal } from './_lib/exonyms.js';
import { TRAVELIFY_ORIGIN } from './_lib/travelify.js';

const UPSTREAM = 'https://api.travelify.io/autocomplete';

// Published Travelify demo application — safe to ship (it is in Travelify's own
// docs) and already used by api/_lib/travelify.js for the demo booking flow.
// Only used when the caller sends no Authorization of its own (MVP demo).
const DEMO_APP_ID = '250';
const DEMO_PUBLIC_KEY = 'A41D180E-CBFE-4E30-A47D-FAAB424A650D';

// The documented Travelify autocomplete parameters we forward. Whitelisted so
// junk query keys never reach upstream. Only Query is ever rewritten.
const PASS_PARAMS = [
  'Query', 'Language', 'CountryCode', 'BlockCountryCode', 'TopQuery',
  'SearchType', 'GeographyType', 'LinkGeography', 'LinkId', 'MinStarRating',
  'BlockLevel', 'ListID', 'Split', 'Numeric', 'MaxItems', 'ShowSupplier',
];

// Case-insensitive view of req.query, first value wins for repeated keys.
function pickParams(query) {
  const out = {};
  for (const key of Object.keys(query || {})) {
    const v = query[key];
    out[key.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

// Drop control characters (including CR/LF, so no header injection via forwarded
// values) and cap length. Codepoint filter keeps the source ASCII-only.
function clean(value, max = 100) {
  const str = String(value == null ? '' : value);
  let out = '';
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) continue;
    out += ch;
  }
  return out.slice(0, max);
}

// Put the human-readable fields of one location (and its nested subLocations)
// back into the customer's language. Everything else is left untouched.
function localiseLocation(loc, lang) {
  if (!loc || typeof loc !== 'object') return loc;
  if (typeof loc.name === 'string') loc.name = toLocal(loc.name, lang);
  if (typeof loc.parentName === 'string') loc.parentName = toLocal(loc.parentName, lang);
  if (typeof loc.summary === 'string') loc.summary = toLocal(loc.summary, lang);
  if (Array.isArray(loc.subLocations)) {
    loc.subLocations = loc.subLocations.map((sub) => localiseLocation(sub, lang));
  }
  return loc;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ success: false, errors: ['Method not allowed'] });
  }

  // IP rate limit is the abuse control — this endpoint is public by design.
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
             req.headers['x-real-ip'] || 'unknown';
  if (!applyRateLimit(res, `autocomplete:${ip}`, RATE_LIMITS.widgetRead)) return;

  res.setHeader('Cache-Control', 'no-store');

  const p = pickParams(req.query);
  const rawQuery = clean(p.query, 100).trim();
  const language = clean(p.language, 6).trim() || 'en';
  const langCode = language.slice(0, 2).toLowerCase();

  // Match the box behaviour and spare upstream: nothing useful below 2 chars.
  if (rawQuery.length < 2) return res.status(200).json([]);

  // Resolve the typed word to the English name Travelify knows. No match means
  // the long tail — we search the raw text, which is correct for it.
  const resolution = resolveQuery(rawQuery, langCode);
  const effectiveQuery = resolution.canonical || rawQuery;

  // Build the upstream request from the whitelisted params, Query rewritten.
  const upstream = new URL(UPSTREAM);
  for (const name of PASS_PARAMS) {
    const raw = p[name.toLowerCase()];
    if (raw == null || raw === '') continue;
    let val = clean(raw, 100);
    if (name === 'MaxItems') {
      const n = parseInt(val, 10);
      if (!Number.isFinite(n)) continue;
      val = String(Math.min(40, Math.max(1, n)));
    }
    upstream.searchParams.set(name, val);
  }
  upstream.searchParams.set('Query', effectiveQuery);
  if (!upstream.searchParams.has('Language')) upstream.searchParams.set('Language', language);

  // Auth: forward the box's own login when present, else the demo app (MVP).
  const headers = { Accept: 'application/json' };
  const incomingAuth = req.headers['authorization'];
  if (incomingAuth) {
    headers.Authorization = incomingAuth;
    if (req.headers['referer']) headers.Referer = req.headers['referer'];
  } else {
    headers.Authorization = `Token ${DEMO_APP_ID}:${DEMO_PUBLIC_KEY}`;
    headers.Origin = TRAVELIFY_ORIGIN;
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('[api/autocomplete] upstream request failed:', err && err.message);
    return res.status(502).json({ success: false, errors: ['Upstream request failed'], isSessionTimeout: false });
  }

  const text = await upstreamRes.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Non-JSON upstream body — relay verbatim with its status.
    res.status(upstreamRes.status);
    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'text/plain; charset=utf-8');
    return res.send(text);
  }

  // Error object or any non-array shape — relay upstream status and body as-is.
  if (!upstreamRes.ok || !Array.isArray(data)) {
    return res.status(upstreamRes.status).json(data);
  }

  const localised = data.map((loc) => localiseLocation(loc, langCode));

  // Resolution telemetry via headers so the JSON body stays a pure drop-in.
  res.setHeader('Access-Control-Expose-Headers', 'X-TG-Query-Original, X-TG-Query-Resolved, X-TG-Match, X-TG-Lang');
  res.setHeader('X-TG-Query-Original', encodeURIComponent(rawQuery));
  res.setHeader('X-TG-Query-Resolved', encodeURIComponent(effectiveQuery));
  res.setHeader('X-TG-Match', resolution.via || 'passthrough');
  res.setHeader('X-TG-Lang', langCode);

  return res.status(200).json(localised);
}
