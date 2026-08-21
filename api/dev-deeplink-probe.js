/**
 * TEMPORARY diagnostic — Travelify deeplink matcher, 21 Aug 2026.
 *
 * The Book buttons error with "Unable to match location". Two suspects:
 * the missing lat/lng/rad anchor (Andy's working example had one, the feed
 * has no coordinates so ours do not), or the comma our loc string carries
 * inside the taxonomy bracket (his working example was comma-free).
 *
 * Four fixed GETs, no inputs honoured, deleted as soon as the answer is in.
 * A success is a redirect to the search page; a failure is JSON in the body.
 */
const PROBES = [
  ['A-as-shipped', 'https://dl.tvllnk.com/deeplink/250?st=TicketsAttractions&supp=179&refe=393038&curr=GBP&fr=2026-08-23&to=2026-08-23&adt=2&chd=0&inf=0&loc=Manchester+City+vs+A.F.C.+Bournemouth+%28Football+%28Soccer%29%2C+English+Premier+League%29%3A+23-Aug-2026'],
  ['B-with-anchor', 'https://dl.tvllnk.com/deeplink/250?st=TicketsAttractions&supp=179&refe=393038&curr=GBP&fr=2026-08-23&to=2026-08-23&lat=53.4831&lng=-2.2004&rad=20&adt=2&chd=0&inf=0&loc=Manchester+City+vs+A.F.C.+Bournemouth+%28Football+%28Soccer%29%2C+English+Premier+League%29%3A+23-Aug-2026'],
  ['C-no-comma-loc', 'https://dl.tvllnk.com/deeplink/250?st=TicketsAttractions&supp=179&refe=393038&curr=GBP&fr=2026-08-23&to=2026-08-23&adt=2&chd=0&inf=0&loc=Manchester+City+vs+A.F.C.+Bournemouth%3A+23-Aug-2026'],
  ['D-xs2-no-anchor', 'https://dl.tvllnk.com/deeplink/250?st=TicketsAttractions&supp=144&refe=168e50ee39a24acf870d4527d5c20a38_spp&curr=GBP&fr=2026-09-04&to=2026-09-04&adt=2&chd=0&inf=0&loc=Italian+Grand+Prix+%28Formula+1%29%3A+04-Sep-2026'],
];

export default async function handler(req, res) {
  const out = [];
  for (const [name, url] of PROBES) {
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      const body = (await r.text()).slice(0, 400);
      out.push({ name, status: r.status, location: r.headers.get('location'), body });
    } catch (err) {
      out.push({ name, error: String(err && err.message) });
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
