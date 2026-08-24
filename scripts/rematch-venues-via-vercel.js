/**
 * Venue rematch probe — PRESERVED for the next predecessor discovery. It ran
 * as a temporary Vercel endpoint on 24 Aug 2026 and was then removed from
 * api/. To run again: edit PLAN below (key, reviewed article title, supplier
 * anchor, feed city), copy this file to api/dev-venue-rematch-probe.js on a
 * work branch, add a vercel.json functions entry with maxDuration 60, push,
 * fetch /api/dev-venue-rematch-probe from the branch preview, then write the
 * PASSING facts into api/_data/venue-facts-overrides.json (omit anything
 * whose verdict failed, skip any venue whose coordKm is over 2), patch
 * api/_data/venue-facts.json the same way, and delete the api/ copy again.
 *
 * Six venues had coordinate-matched the Wikipedia article for the DEMOLISHED
 * building on the same ground (or the Millennium Dome for The O2) and were
 * purged. This probe rematches each to its hand-reviewed CURRENT article,
 * pulls the Wikidata claims fresh, and applies the same double verification
 * as scripts/verify-venue-facts-crawl.js: identity needs the reviewed title
 * to resolve AND the item's own coordinate within 2km of our supplier
 * anchor; each fact then needs the live article's infobox to corroborate the
 * Wikidata claim. The caller applies only what passes.
 */

const UA = 'tg-widgets-venue-rematch/1.0 (one-off double-verification; andy.speight@agendas.group)';

// Hand-reviewed current articles, 22 Aug 2026. ref = our supplier anchor.
// city = the feed's own city claim where it has one (verified, not assumed).
const PLAN = [
  { key: 'wembleystadium', title: 'Wembley Stadium', name: 'Wembley Stadium', ref: [51.5559, -0.27959], city: 'London' },
  { key: 'sanmamesstadium', title: 'San Mamés Stadium (2013)', name: 'San Mamés Stadium', ref: [43.26428, -2.95037], city: null },
  { key: 'stadelouisii', title: 'Stade Louis II', name: 'Stade Louis II', ref: [43.7276, 7.41561], city: null },
  { key: 'hidegkutinandorstadion', title: 'Hidegkuti Nándor Stadion', name: 'Hidegkuti Nandor Stadion', ref: [47.4909, 19.1067], city: null },
  { key: 'sergiolanfranchi', title: 'Stadio Sergio Lanfranchi', name: 'Sergio Lanfranchi ( XXV Aprile)', ref: [44.8044, 10.3285], city: null },
  { key: 'theo2', title: 'The O2 Arena', name: 'The O2', ref: [51.5028, 0.00312], city: 'London' },
];

async function api(base, params) {
  const url = base + '?' + new URLSearchParams({ format: 'json', ...params }).toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
      if (r.ok) return r.json();
    } catch (e) { /* back off */ }
    await new Promise((ok) => setTimeout(ok, 1800));
  }
  return null;
}
const wp = (p) => api('https://en.wikipedia.org/w/api.php', p);
const wd = (p) => api('https://www.wikidata.org/w/api.php', p);
const commons = (p) => api('https://commons.wikimedia.org/w/api.php', p);

const fold = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const kmBetween = (a, b) => {
  const rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

// Best-ranked claim value for a property.
function claim(claims, prop) {
  const list = (claims && claims[prop]) || [];
  const pick = list.find((c) => c.rank === 'preferred') || list.find((c) => c.rank === 'normal') || list[0];
  return pick && pick.mainsnak && pick.mainsnak.datavalue && pick.mainsnak.datavalue.value;
}

async function rematch(v) {
  const out = { key: v.key, title: v.title };

  const pp = await wp({ action: 'query', titles: v.title, prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1' });
  const page = pp && pp.query && Object.values(pp.query.pages || {})[0];
  const qid = page && page.pageprops && page.pageprops.wikibase_item;
  const resolved = page && page.title;
  if (!qid || !resolved) return { ...out, ok: false, why: 'no page or item' };
  out.resolved = resolved; out.qid = qid;

  const wt = await wp({ action: 'parse', page: resolved, prop: 'wikitext', section: '0', redirects: '1' });
  const text = wt && wt.parse && wt.parse.wikitext && wt.parse.wikitext['*'];
  if (!text) return { ...out, ok: false, why: 'no wikitext' };

  const ent = await wd({ action: 'wbgetentities', ids: qid, props: 'claims' });
  const claims = ent && ent.entities && ent.entities[qid] && ent.entities[qid].claims;
  if (!claims) return { ...out, ok: false, why: 'no claims' };

  const coord = claim(claims, 'P625');
  out.coordKm = coord ? Math.round(kmBetween(v.ref, [coord.latitude, coord.longitude]) * 100) / 100 : null;

  const capRaw = claim(claims, 'P1083');
  const cap = capRaw && parseInt(String(capRaw.amount).replace('+', ''), 10);
  const openedRaw = claim(claims, 'P1619') || claim(claims, 'P571');
  const opened = openedRaw && parseInt(String(openedRaw.time).slice(1, 5), 10);
  const web = claim(claims, 'P856') || null;
  const imgName = claim(claims, 'P18') || null;

  // Same corroboration checks as the crawl verifier.
  const lines = text.split('\n');
  const grab = (re) => lines.filter((l) => re.test(l)).join(' ');
  const verdicts = {};
  if (cap) {
    const nums = (grab(/capacity/i).match(/\d[\d,.]{2,}/g) || [])
      .map((x) => parseInt(x.replace(/[,.]/g, ''), 10)).filter((x) => x >= 200 && x <= 300000);
    verdicts.capOk = nums.some((n) => Math.abs(n - cap) <= Math.max(50, cap * 0.01));
  }
  if (opened) {
    verdicts.openedOk = new RegExp('\\b' + opened + '\\b')
      .test(grab(/opened|built|inaugurat|broke.?ground|construction/i));
  }
  if (web) {
    try {
      verdicts.webOk = fold(text).includes(fold(new URL(web).hostname.replace(/^www\./, '')));
    } catch (e) { verdicts.webOk = false; }
  }
  if (v.city) verdicts.cityOk = fold(text).includes(fold(v.city));

  let img = null;
  if (imgName) {
    const file = String(imgName).replace(/ /g, '_');
    const meta = await commons({ action: 'query', titles: 'File:' + file, prop: 'imageinfo', iiprop: 'extmetadata' });
    const info = meta && meta.query && Object.values(meta.query.pages || {})[0];
    const ext = info && info.imageinfo && info.imageinfo[0] && info.imageinfo[0].extmetadata;
    const by = ext && ext.Artist && String(ext.Artist.value).replace(/<[^>]*>/g, '').trim();
    const lic = ext && ext.LicenseShortName && ext.LicenseShortName.value;
    if (by && lic) {
      img = {
        u: 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file) + '?width=900',
        page: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file),
        by, lic,
      };
    }
  }

  return { ...out, ok: true, verdicts, facts: { cap: cap || null, opened: opened || null, web,
    wiki: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(resolved.replace(/ /g, '_')), img, city: v.city } };
}

export default async function handler(req, res) {
  const rows = [];
  for (const v of PLAN) {
    try { rows.push(await rematch(v)); }
    catch (e) { rows.push({ key: v.key, ok: false, why: String(e && e.message).slice(0, 80) }); }
    await new Promise((ok) => setTimeout(ok, 350));
  }
  res.setHeader('Cache-Control', 'no-store');
  const pad = Math.min(120000, Math.max(0, parseInt(req.query.pad, 10) || 0));
  res.status(200).json({ rows, pad: pad ? ' '.repeat(pad) : undefined });
}
