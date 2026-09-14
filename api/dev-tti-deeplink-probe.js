/**
 * TEMPORARY — TTI deeplink probe, round 6 (final). Delete after the run.
 *
 * Round 5 found the calls. The results read is:
 *
 *   buildTravelApiUrl(`search/${searchSessionId}`,
 *     'returnAllData=false&version=4&...&reloadAll=true')
 *
 * and there is also a direct POST to buildTravelApiUrl('search') with a JSON
 * body, which may start a search without a deeplink at all. Plus
 * searchcriteria/{id}, account/login (Authorization: apiCredentials) and
 * widgetsettings/{widgetId}.
 *
 * What is still unknown is the BASE and the HEADERS. So this round pulls the
 * definitions of buildTravelApiUrl, buildWidgetApiUrl, buildResultsHeaders and
 * whatever sets apiCredentials.
 */

const ENGINE = 'https://static.travelify.io/widgets/travel-results-v4/travel-results-widget.js';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36';

function windows(text, re, pad, max) {
  const seen = new Set(); const out = [];
  for (const m of text.matchAll(re)) {
    const a = Math.max(0, m.index - pad);
    const s = text.slice(a, m.index + m[0].length + pad).replace(/\s+/g, ' ');
    const k = s.slice(0, 50);
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export default async function handler(req, res) {
  const out = { ranAt: new Date().toISOString() };
  try {
    const r = await fetch(ENGINE, {
      redirect: 'follow', headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: AbortSignal.timeout(20000),
    });
    const t = await r.text();
    out.bytes = t.length;

    // The two URL builders, defined rather than called.
    out.buildTravelApiUrl = windows(t, /buildTravelApiUrl\s*\([^)]*\)\s*\{/g, 30, 2).map((s) => s.slice(0, 700));
    out.buildWidgetApiUrl = windows(t, /buildWidgetApiUrl\s*\([^)]*\)\s*\{/g, 30, 2).map((s) => s.slice(0, 700));
    out.buildResultsHeaders = windows(t, /buildResultsHeaders\s*\([^)]*\)\s*\{/g, 20, 2).map((s) => s.slice(0, 600));
    // Where the base and credentials come from.
    out.apiUrlAssign = windows(t, /\b(?:travelApiUrl|widgetApiUrl|apiCredentials)\b\s*[=:]/g, 150, 8);
    // The POST search body, which is the interesting alternative to a deeplink.
    out.postSearchBody = windows(t, /requestBody\s*=/g, 40, 3).map((s) => s.slice(0, 700));
  } catch (e) { out.error = String(e && e.message).slice(0, 300); }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
