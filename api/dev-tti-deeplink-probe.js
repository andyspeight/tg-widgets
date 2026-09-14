/**
 * TEMPORARY — TTI deeplink probe, round 2. Delete after the run.
 *
 * Round 1 (14 Sep 2026) settled the argument. A deeplink 302s to:
 *   https://www.traveldemo.site/results#/search/searchSession=40767448/BAB28492-...
 * So the deeplink RUNS A LIVE SEARCH and hands back a search session id. Andy
 * has been saying exactly this and I kept answering that it was just a page.
 *
 * What is still missing is the call that reads a session's results. The results
 * page is a Duda site whose JS does the polling, so this round digs it out:
 *   - captures the session id and guid from the redirect
 *   - unescapes the page payload and lists every travelify.io URL in it
 *   - lists the JS bundles the page loads, fetches a few, and greps them for
 *     the API paths they call
 *
 * That gives us the endpoint the browser uses, which is the endpoint the
 * nightly sweep should use.
 */

const BASE = 'https://dl.tvllnk.com/deeplink/';
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

const CASES = [
  ['250-dubai-nopin', link('250', DUBAI)],
  ['250-dubai-refn', link('250', { ...DUBAI, refn: 'TTI:10946397' })],
  ['250-gb-andys-code', link('250', { ctry: 'GB', refn: 'TTI:58612582' })],
  ['384-gb-andys-code', link('384', { ctry: 'GB', refn: 'TTI:58612582' })],
];

const get = (url, accept) => fetch(url, {
  redirect: 'manual',
  headers: { 'User-Agent': UA, Accept: accept || '*/*' },
  signal: AbortSignal.timeout(15000),
});

/** Pull the session out of the funnel URL the deeplink redirects to. */
function sessionOf(loc) {
  const m = /searchSession=([^/#?&]+)\/([^/#?&]+)/.exec(loc || '');
  return m ? { searchSession: m[1], guid: m[2] } : null;
}

/** URLs hide inside JSON-escaped HTML, so unescape before matching. */
function urlsIn(body, re) {
  const flat = body.replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/');
  return [...new Set([...flat.matchAll(re)].map((m) => m[0]))];
}

export default async function handler(req, res) {
  const only = String((req.query && req.query.only) || '');
  const wantBundles = String((req.query && req.query.bundles) || '') === '1';
  const rows = {};

  for (const [name, url] of CASES) {
    if (only && name !== only) continue;
    try {
      const r = await get(url, 'text/html');
      const loc = r.headers.get('location');
      const row = { status: r.status, location: loc };
      row.session = sessionOf(loc);
      rows[name] = row;
    } catch (e) { rows[name] = { error: String(e && e.message).slice(0, 200) }; }
  }

  // Dig the API out of the results page, once, using whichever session we got.
  let api = null;
  const first = Object.values(rows).find((x) => x && x.location);
  if (first && wantBundles) {
    api = {};
    try {
      const pageUrl = first.location.split('#')[0];
      const pr = await get(pageUrl, 'text/html');
      const body = await pr.text();
      api.pageStatus = pr.status;
      api.pageBytes = body.length;
      api.travelifyUrls = urlsIn(body, /https?:\/\/[a-z0-9.-]*travelify\.io[^"'\\\s<>)]*/gi).slice(0, 40);
      api.tvllnkUrls = urlsIn(body, /https?:\/\/[a-z0-9.-]*tvllnk\.com[^"'\\\s<>)]*/gi).slice(0, 20);
      const js = urlsIn(body, /https?:\/\/[^"'\\\s<>)]+\.js(?:\?[^"'\\\s<>)]*)?/gi);
      api.jsBundles = js.slice(0, 30);

      // Fetch the most likely bundles and grep them for the paths they call.
      const likely = js.filter((u) => /travelify|search|result|widget|engine|booking/i.test(u)).slice(0, 4);
      api.grepped = [];
      for (const u of likely) {
        try {
          const br = await get(u, '*/*');
          const t = await br.text();
          api.grepped.push({
            url: u.slice(0, 200), bytes: t.length,
            travelify: urlsIn(t, /https?:\/\/[a-z0-9.-]*travelify\.io[^"'`\\\s<>)]*/gi).slice(0, 25),
            paths: urlsIn(t, /["'`]\/(?:api|widgetsvc|search|results|session)[a-zA-Z0-9/_{}$.-]*/gi).slice(0, 25),
            mentionsSession: /searchSession/i.test(t),
          });
        } catch (e) { api.grepped.push({ url: u.slice(0, 200), error: String(e && e.message).slice(0, 120) }); }
      }
    } catch (e) { api.error = String(e && e.message).slice(0, 200); }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ranAt: new Date().toISOString(), rows, api });
}
