/**
 * TEMPORARY — TTI deeplink response probe. Delete after the run.
 *
 * Andy (14 Sep 2026): "there is no other call - you need to do a full live
 * search using the deeplink, and capture the response and then add that to the
 * cache". He is right and I had been arguing from an assumption instead of a
 * measurement, so this measures it.
 *
 * scripts/probe-flight-deeplink.js already established that a deeplink 302s
 * into the Travelify results funnel. What it never captured is what sits at the
 * END of that chain, which is the only thing that decides whether a nightly job
 * can read offers out of it. So this follows every hop to the last page and
 * reports:
 *
 *   - the whole redirect chain, so we can see where the funnel lands
 *   - the final content type and size
 *   - whether the body is JSON
 *   - a generous slice of the body, enough to tell a rendered results page from
 *     an empty application shell
 *   - every script/src and every API-looking URL in the page
 *
 * That last one is the prize. If the results page is a JS app that fetches its
 * results from somewhere, that fetch is the call the sweep should be making,
 * and the deeplink is how we learn its shape.
 *
 * Runs on a branch preview only. Fetch it, read it, delete the file.
 */

const BASE = 'https://dl.tvllnk.com/deeplink/';

// The shape is taken from the two real links Andy supplied on 14 Sep: an area
// search at CITY scale with the property pinned by refn alone.
function link(appId, params) {
  const q = new URLSearchParams({
    st: 'Accommodation',
    curr: 'GBP',
    nat: 'GB',
    frd: '30',
    dur: '7',
    adt: '2', chd: '0', inf: '0',
    ...params,
  });
  return BASE + appId + '?' + q.toString();
}

const DUBAI = { loc: 'Dubai, United Arab Emirates', loct: 'City', lat: '25.049', lng: '55.118', rad: '28' };

const CASES = [
  // Controls: does a plain city search render results at all, on each app?
  ['250-dubai-nopin', link('250', DUBAI)],
  ['384-dubai-nopin', link('384', DUBAI)],
  // The same search PINNED, which is the shape the sweep would use.
  ['250-dubai-refn', link('250', { ...DUBAI, refn: 'TTI:10946397' })],
  // Andy's own hotel, the one that keeps coming back area-only.
  ['250-gb-andys-code', link('250', { ctry: 'GB', refn: 'TTI:58612582' })],
  ['384-gb-andys-code', link('384', { ctry: 'GB', refn: 'TTI:58612582' })],
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function probe(url) {
  const out = { hops: [] };
  let current = url;
  for (let hop = 0; hop < 8; hop++) {
    const r = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(20000),
    });
    const loc = r.headers.get('location');
    out.hops.push({ status: r.status, url: current.slice(0, 300), location: loc ? loc.slice(0, 300) : null });
    if (loc && r.status >= 300 && r.status < 400) { current = new URL(loc, current).toString(); continue; }

    const body = await r.text();
    out.finalUrl = current;
    out.status = r.status;
    out.contentType = r.headers.get('content-type') || null;
    out.bytes = body.length;
    try { JSON.parse(body); out.isJson = true; } catch { out.isJson = false; }

    // Enough to tell a rendered page from a shell.
    out.head = body.slice(0, 3000);
    // Every script the page loads, and anything that looks like a data call.
    out.scripts = [...new Set([...body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))].slice(0, 25);
    out.apiish = [...new Set([...body.matchAll(/["'`](https?:\/\/[^"'`\s]*(?:api|search|offer|avail)[^"'`\s]*)["'`]/gi)].map((m) => m[1]))].slice(0, 25);
    // Does the page already contain prices or hotel-shaped content?
    out.hasPriceMarkup = /(£|&pound;|GBP)\s?\d{2,}/.test(body);
    out.mentionsNoResults = /no results|no availability|nothing found|no hotels/i.test(body);
    return out;
  }
  out.error = 'too many redirects';
  return out;
}

export default async function handler(req, res) {
  const only = String((req.query && req.query.only) || '');
  const rows = {};
  for (const [name, url] of CASES) {
    if (only && name !== only) continue;
    try { rows[name] = { url, ...(await probe(url)) }; }
    catch (e) { rows[name] = { url, error: String(e && e.message).slice(0, 200) }; }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ranAt: new Date().toISOString(), rows });
}
