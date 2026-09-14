/**
 * TEMPORARY — TTI deeplink probe, round 5. Delete after the run.
 *
 * The chain so far, every step measured on 14 Sep 2026:
 *   1. deeplink -> 302 -> /results#/search/searchSession={id}/{guid}
 *   2. results page -> travelify-elements-v2.4.min.js (a loader)
 *   3. loader -> GET api.travelify.io/elements/2?wids=18777,9161,9162,9934
 *      -> manifest of the real engine scripts
 *   4. the engine is travel-results-v4/travel-results-widget.js (344KB), and it
 *      builds the path:  `search/${encodeURIComponent(this.searchSessionId)}`
 *
 * Missing: the BASE that path hangs off. The file holds no absolute
 * travelify.io URL, so the base is configured rather than hardcoded. This round
 * greps context windows around the call sites to find it.
 */

const ENGINE = 'https://static.travelify.io/widgets/travel-results-v4/travel-results-widget.js';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/** Context windows around each match, deduped, so we can read the call site. */
function windows(text, re, pad, max) {
  const seen = new Set(); const out = [];
  for (const m of text.matchAll(re)) {
    const a = Math.max(0, m.index - pad);
    const s = text.slice(a, m.index + m[0].length + pad).replace(/\s+/g, ' ');
    const k = s.slice(0, 60);
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export default async function handler(req, res) {
  const url = String((req.query && req.query.url) || ENGINE);
  const out = { ranAt: new Date().toISOString(), url };
  try {
    const r = await fetch(url, {
      redirect: 'follow', headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: AbortSignal.timeout(20000),
    });
    const t = await r.text();
    out.status = r.status; out.bytes = t.length;

    // The call site itself.
    out.searchCall = windows(t, /search\/\$\{encodeURIComponent\(this\.searchSessionId\)\}/g, 320, 3);
    // Where the base comes from.
    out.apiBase = windows(t, /(?:apiUrl|apiBase|baseUrl|serviceUrl|apiEndpoint|endpointUrl|svcUrl)\s*[=:]/gi, 160, 10);
    // Any https literal at all, in case the base is built from parts.
    out.httpsLiterals = [...new Set([...t.matchAll(/https?:\/\/[a-z0-9.-]+[^"'`\s<>)]{0,60}/gi)].map((m) => m[0]))].slice(0, 25);
    // How it fetches.
    out.fetchSites = windows(t, /\b(?:fetch|axios\.get|\$\.ajax|XMLHttpRequest)\s*\(/g, 200, 6);
    // widgetsvc is the surface we already know about.
    out.widgetsvc = windows(t, /widgetsvc/gi, 200, 6);
  } catch (e) { out.error = String(e && e.message).slice(0, 300); }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
