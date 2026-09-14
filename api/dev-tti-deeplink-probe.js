/**
 * TEMPORARY — TTI deeplink probe, round 4. Delete after the run.
 *
 * The chain, all measured on 14 Sep 2026:
 *   1. deeplink 302s to /results#/search/searchSession={id}/{guid}
 *      -> the deeplink RUNS A LIVE SEARCH and hands back a session handle
 *   2. the results page loads travelify-elements-v2.4.min.js, which is only a
 *      LOADER. It reads every <* class="travelify-widget" widgetid="..."> on the
 *      page and calls:
 *        GET https://api.travelify.io/elements/2?wids={ids}
 *      which returns { success, styles: [...], scripts2: { url: isModule } } —
 *      a manifest of the real engine's stylesheets and scripts.
 *
 * So the results engine is behind elements/2. This round walks that: pull the
 * widget ids off the results page, fetch the manifest, then grep the engine
 * scripts for the endpoint that reads a searchSession.
 *
 * Output kept deliberately small — ids, script urls, and matching paths only.
 */

const API = 'https://api.travelify.io';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const get = (url) => fetch(url, {
  redirect: 'follow', headers: { 'User-Agent': UA, Accept: '*/*' },
  signal: AbortSignal.timeout(15000),
});
const unescape_ = (s) => s.replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/').replace(/\\"/g, '"');

export default async function handler(req, res) {
  const out = { ranAt: new Date().toISOString() };
  const page = String((req.query && req.query.page) || 'https://www.traveldemo.site/results');

  try {
    // 1. The widget ids on the results page.
    const pr = await get(page);
    const body = unescape_(await pr.text());
    out.pageStatus = pr.status;
    const ids = [...new Set([...body.matchAll(/widgetid=["']([^"']+)["']/gi)].map((m) => m[1]))];
    out.widgetIds = ids.slice(0, 20);

    if (!ids.length) {
      // Fall back: show what class names are present so we can find the hook.
      out.travelifyClasses = [...new Set([...body.matchAll(/class=["']([^"']*travelify[^"']*)["']/gi)].map((m) => m[1]))].slice(0, 15);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(out);
    }

    // 2. The manifest.
    const mUrl = API + '/elements/2?wids=' + encodeURIComponent(ids.slice().sort().join(','));
    out.manifestUrl = mUrl;
    const mr = await get(mUrl);
    const mt = await mr.text();
    out.manifestStatus = mr.status;
    let manifest = null;
    try { manifest = JSON.parse(mt); } catch { out.manifestRaw = mt.slice(0, 600); }
    if (manifest) {
      out.styles = (manifest.styles || []).slice(0, 10);
      out.scripts = Object.keys(manifest.scripts2 || {}).slice(0, 15);
      if (manifest.errorMessage) out.manifestError = manifest.errorMessage;
    }

    // 3. Grep the engine scripts for the call that reads a session.
    out.engine = [];
    for (const s of (out.scripts || []).slice(0, 6)) {
      try {
        const sr = await get(s);
        const t = await sr.text();
        const hits = (re, n) => [...new Set([...t.matchAll(re)].map((m) => m[0]))].slice(0, n);
        out.engine.push({
          url: s.slice(0, 160), bytes: t.length,
          // Absolute Travelify URLs, and the relative paths it builds.
          travelifyUrls: hits(/https?:\/\/[a-z0-9.-]*travelify\.io[^"'`\s<>)]*/gi, 15),
          sessionPaths: hits(/["'`][^"'`\s]{0,40}(?:searchSession|SearchSession|sessionId)[^"'`\s]{0,60}["'`]/g, 15),
          searchPaths: hits(/["'`]\/(?:search|results?|offers?|availability|avail|session|widgetsvc)[a-zA-Z0-9/_{}$.?=&-]*["'`]/gi, 20),
        });
      } catch (e) { out.engine.push({ url: s.slice(0, 160), error: String(e && e.message).slice(0, 120) }); }
    }
  } catch (e) { out.error = String(e && e.message).slice(0, 300); }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
