/**
 * TEMPORARY — TTI deeplink probe, round 7: the end-to-end proof. Delete after.
 *
 * Everything is now known and measured:
 *   deeplink -> 302 -> /results#/search/searchSession={id}/{guid}
 *   engine   -> GET {travelApiDomain}/search/{sessionId}
 *                 ?returnAllData=false&version=4&reloadAll=true
 *   travelApiDomain in production is api.travelify.io, and the engine's
 *   PRODUCTION_API_RUNTIME ships apiCredentials as '', so the browser makes
 *   this call unauthenticated: the session id IS the capability.
 *
 * Round 7 result: api.travelify.io/search/40767552 answered with a real JSON
 * error, 404 "Unrecognised API method". So the host is right and the path is
 * missing a prefix. buildTravelApiUrl delegates to buildApiUrl, which is what
 * adds it. Round 8 reads buildApiUrl in full.
 *
 * So run exactly what the browser runs, and nothing else. Build the link,
 * follow the 302, take the session, call the search endpoint the same way the
 * page does, and report what comes back.
 *
 * Reports SHAPE not payload, so the output stays readable. If this returns 401
 * the answer is to route it through our existing credential lookup, the same
 * one /api/offers already uses — never to guess at a token.
 */

const BASE = 'https://dl.tvllnk.com/deeplink/';
const API = 'https://api.travelify.io';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36';

function link(appId, params) {
  const q = new URLSearchParams({
    st: 'Accommodation', curr: 'GBP', nat: 'GB', frd: '30', dur: '7',
    adt: '2', chd: '0', inf: '0', ...params,
  });
  return BASE + appId + '?' + q.toString();
}
const DUBAI = { loc: 'Dubai, United Arab Emirates', loct: 'City', lat: '25.049', lng: '55.118', rad: '28' };

/** Describe a JSON body without printing all of it. */
function shapeOf(v, depth = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return depth > 1 ? `array(${v.length})` : { array: v.length, first: v.length ? shapeOf(v[0], depth + 1) : null };
  if (typeof v === 'object') {
    if (depth > 1) return `object(${Object.keys(v).length} keys)`;
    const o = {};
    for (const k of Object.keys(v).slice(0, 30)) o[k] = shapeOf(v[k], depth + 1);
    return o;
  }
  if (typeof v === 'string') return v.length > 60 ? `string(${v.length})` : `"${v}"`;
  return typeof v;
}

export default async function handler(req, res) {
  const ENGINE = 'https://static.travelify.io/widgets/travel-results-v4/travel-results-widget.js';
  const out = { ranAt: new Date().toISOString() };
  function windows(text, re, pad, max) {
    const seen = new Set(); const o = [];
    for (const m of text.matchAll(re)) {
      const a = Math.max(0, m.index - pad);
      const t = text.slice(a, m.index + m[0].length + pad).replace(/\s+/g, ' ');
      const k = t.slice(0, 50);
      if (seen.has(k)) continue;
      seen.add(k); o.push(t);
      if (o.length >= max) break;
    }
    return o;
  }
  try {
    const r = await fetch(ENGINE, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    out.bytes = t.length;
    // The builder that actually assembles the URL, in full this time.
    out.buildApiUrl = windows(t, /buildApiUrl\s*\(\s*domain/g, 10, 2).map((x) => x.slice(0, 1400));
    out.buildTravelApiUrl = windows(t, /buildTravelApiUrl\s*\(path/g, 10, 2).map((x) => x.slice(0, 500));
    out.buildWidgetApiUrl = windows(t, /buildWidgetApiUrl\s*\(path/g, 10, 2).map((x) => x.slice(0, 500));
    // Any path prefix constant it might be prepending.
    out.prefixes = windows(t, /["'`](?:\/)?(?:widgetsvc|travelsvc|api|v[0-9]|travel)\/?["'`]/g, 90, 12);
  } catch (e) { out.error = String(e && e.message).slice(0, 300); }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
