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
  const appId = String((req.query && req.query.app) || '250');
  const refn = String((req.query && req.query.refn) || 'TTI:10946397');
  const out = { ranAt: new Date().toISOString() };

  try {
    // 1. Run the search by following the deeplink.
    const dl = link(appId, { ...DUBAI, refn });
    out.deeplink = dl;
    const r1 = await fetch(dl, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    const loc = r1.headers.get('location');
    out.redirect = { status: r1.status, location: loc };
    const m = /searchSession=([^/#?&]+)\/([^/#?&]+)/.exec(loc || '');
    if (!m) { out.stopped = 'no search session in the redirect'; return res.status(200).json(out); }
    out.searchSession = m[1];

    // 2. Read that session exactly as the results page does: no Authorization,
    //    because the engine's production runtime carries none.
    const url = `${API}/search/${encodeURIComponent(m[1])}`
              + '?returnAllData=false&version=4&reloadAll=true';
    out.resultsUrl = url;
    const rr = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: (loc || '').split('#')[0] },
      signal: AbortSignal.timeout(20000),
    });
    const t = await rr.text();
    const a = { status: rr.status, contentType: rr.headers.get('content-type'), bytes: t.length };
    try {
      const j = JSON.parse(t);
      a.shape = shapeOf(j);
      const arr = j.results || j.data || j.offers || (Array.isArray(j) ? j : null);
      if (Array.isArray(arr)) {
        a.count = arr.length;
        a.firstKeys = arr.length ? Object.keys(arr[0]).slice(0, 40) : [];
        a.containsPinnedCode = JSON.stringify(arr).toUpperCase()
          .includes(refn.replace(/^[A-Z]+:/i, '').toUpperCase());
      }
    } catch { a.notJson = t.slice(0, 400); }
    out.results = a;
  } catch (e) { out.error = String(e && e.message).slice(0, 300); }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
