/**
 * TEMPORARY — TTI deeplink probe, round 3. Delete after the run.
 *
 * Established so far (14 Sep 2026), all measured, none assumed:
 *   - a deeplink 302s to /results#/search/searchSession={id}/{guid}, so it RUNS
 *     A LIVE SEARCH and hands back a session handle. Andy was right.
 *   - refn is accepted at the door: the pinned Dubai link got its own session.
 *   - ctry=GB with no city or coordinates is 406 Not Acceptable. A country on
 *     its own is not a valid search, which means the editor cannot collect just
 *     a code and a country.
 *   - the results page loads https://static.travelify.io/travelify-elements-v2.4.min.js
 *     (6.7KB) and that file is the only thing on the page referencing
 *     api.travelify.io.
 *
 * So: dump that loader whole. It is small enough to read, and it will name the
 * endpoint the browser polls for a session's results — which is the call the
 * nightly sweep needs to make.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const get = (url, extra) => fetch(url, {
  redirect: 'follow',
  headers: { 'User-Agent': UA, Accept: '*/*', ...(extra || {}) },
  signal: AbortSignal.timeout(15000),
});

const TARGETS = [
  'https://static.travelify.io/travelify-elements-v2.4.min.js',
];

export default async function handler(req, res) {
  const out = { ranAt: new Date().toISOString(), files: [] };

  // Anything the caller wants to look at, plus the loader.
  const extra = String((req.query && req.query.url) || '');
  const list = extra ? [extra] : TARGETS;

  for (const url of list) {
    try {
      const r = await get(url);
      const t = await r.text();
      out.files.push({
        url, status: r.status, bytes: t.length,
        contentType: r.headers.get('content-type') || null,
        // Small enough to read in full. This is the point of the round.
        body: t.slice(0, 12000),
      });
    } catch (e) { out.files.push({ url, error: String(e && e.message).slice(0, 200) }); }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
