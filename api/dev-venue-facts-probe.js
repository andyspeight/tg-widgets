/**
 * TEMPORARY venue research endpoint — deleted once venue-facts.json exists.
 *
 * Researches each venue against Wikidata, matched by COORDINATES rather than
 * trusting a name search: a candidate found by name only counts if its own
 * coordinate sits within 2km of ours, which is what stops "Windsor Park" in
 * Belfast matching a park in Windsor. Runs server-side because the build
 * sandbox cannot reach Wikimedia. Same paging pattern as the geocoder probe.
 *
 * Per venue: entity search on the name (then aliases), coordinate-gated pick,
 * then capacity (P1083), opening (P1619, falling back to inception P571),
 * official website (P856), image (P18) with its Commons author and licence,
 * and the English Wikipedia link. Missing facts stay missing — the fact sheet
 * omits them rather than inventing.
 */
import { readFileSync } from 'node:fs';

const UA = 'tg-widgets-venue-facts/1.0 (one-off registry build; andy.speight@agendas.group)';
const WD = 'https://www.wikidata.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

let PLAN = null;
function plan() {
  if (PLAN) return PLAN;
  const snapUrl = new URL('./_data/events-snapshot.json', import.meta.url);
  const snap = JSON.parse(readFileSync(snapUrl, 'utf8'));
  const geoUrl = new URL('./_data/venue-geo.json', import.meta.url);
  const geo = JSON.parse(readFileSync(geoUrl, 'utf8'));
  const byKey = new Map(geo.venues.map((v) => [v[0], { lat: v[1], lng: v[2] }]));
  PLAN = snap.venues
    .filter((v) => byKey.has(v.key))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((v) => ({ key: v.key, name: v.name, aliases: v.aliases || [], geo: byKey.get(v.key) }));
  return PLAN;
}

const km = (a, b) => {
  const dLat = (a.lat - b.lat) * 111;
  const dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};

// Wikimedia throttles bursts from cloud IPs, and a throttled request must not
// silently become "no such venue": back off and retry once before giving up.
async function api(base, params) {
  const url = base + '?' + new URLSearchParams({ format: 'json', ...params }).toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
      if (r.ok) return r.json();
    } catch (e) { /* fall through to the backoff */ }
    await new Promise((ok) => setTimeout(ok, 1800));
  }
  return null;
}

const claim = (e, p) => {
  const c = e.claims && e.claims[p] && e.claims[p][0];
  return c && c.mainsnak && c.mainsnak.datavalue ? c.mainsnak.datavalue.value : null;
};

async function research(v) {
  // Names to try: registry name, then aliases (sponsor renames live there),
  // with bracketed qualifiers stripped for the search.
  const names = [v.name, ...v.aliases].map((n) => n.replace(/\s*\([^)]*\)\s*/g, ' ').trim()).filter(Boolean);
  let match = null;
  for (const name of names.slice(0, 3)) {
    const s = await api(WD, { action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: 7 });
    const ids = ((s && s.search) || []).map((x) => x.id);
    if (!ids.length) continue;
    const g = await api(WD, { action: 'wbgetentities', ids: ids.join('|'), props: 'claims|sitelinks/urls|labels' });
    let best = null;
    for (const id of ids) {
      const e = g && g.entities && g.entities[id];
      if (!e) continue;
      const coord = claim(e, 'P625');
      if (!coord) continue;
      const d = km({ lat: coord.latitude, lng: coord.longitude }, v.geo);
      if (d < 2 && (!best || d < best.d)) best = { e, d };
    }
    if (best) { match = best.e; break; }
  }
  if (!match) return { key: v.key };

  const out = { key: v.key, qid: match.id };
  const cap = claim(match, 'P1083');
  if (cap && cap.amount) out.capacity = Math.round(Math.abs(parseFloat(cap.amount)));
  const opened = claim(match, 'P1619') || claim(match, 'P571');
  if (opened && opened.time) {
    const y = parseInt(opened.time.slice(1, 5), 10);
    if (y >= 1800 && y <= 2027) out.opened = y;
  }
  const site = claim(match, 'P856');
  if (typeof site === 'string' && /^https?:\/\//.test(site)) out.website = site.slice(0, 200);
  const enwiki = match.sitelinks && match.sitelinks.enwiki && match.sitelinks.enwiki.url;
  if (enwiki) out.wiki = enwiki;

  const img = claim(match, 'P18');
  if (typeof img === 'string' && /\.(jpe?g|png|webp)$/i.test(img)) {
    const file = img.replace(/ /g, '_');
    const meta = await api(COMMONS, {
      action: 'query', titles: 'File:' + img, prop: 'imageinfo',
      iiprop: 'extmetadata', iiextmetadatafilter: 'Artist|LicenseShortName',
    });
    const pages = meta && meta.query && meta.query.pages;
    const info = pages && Object.values(pages)[0];
    const md = info && info.imageinfo && info.imageinfo[0] && info.imageinfo[0].extmetadata;
    const strip = (h) => String(h || '').replace(/<[^>]*>/g, '').trim().slice(0, 80);
    out.img = {
      u: 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file) + '?width=900',
      page: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file),
      by: md ? strip(md.Artist && md.Artist.value) : '',
      lic: md ? strip(md.LicenseShortName && md.LicenseShortName.value) : '',
    };
  }
  return out;
}

export default async function handler(req, res) {
  const all = plan();

  // ?debug=<key>: show the raw search candidates and their distances for one
  // venue, because guessing why a match fails wastes deploy cycles.
  if (req.query.debug) {
    const v = all.find((x) => x.key === req.query.debug);
    if (!v) { res.status(404).json({ error: 'unknown key' }); return; }
    const names = [v.name, ...v.aliases].map((n) => n.replace(/\s*\([^)]*\)\s*/g, ' ').trim()).filter(Boolean);
    const out = { venue: v, tried: [] };
    for (const name of names.slice(0, 3)) {
      const s = await api(WD, { action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: 7 });
      const ids = ((s && s.search) || []).map((x) => ({ id: x.id, label: x.label, desc: x.description }));
      const g = ids.length ? await api(WD, { action: 'wbgetentities', ids: ids.map((x) => x.id).join('|'), props: 'claims' }) : null;
      for (const c of ids) {
        const e = g && g.entities && g.entities[c.id];
        const coord = e ? claim(e, 'P625') : null;
        c.km = coord ? +km({ lat: coord.latitude, lng: coord.longitude }, v.geo).toFixed(2) : null;
      }
      out.tried.push({ name, searchOk: !!s, candidates: ids });
    }
    res.status(200).json(out);
    return;
  }
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const count = Math.min(60, Math.max(1, parseInt(req.query.count, 10) || 40));
  const slice = all.slice(offset, offset + count);

  const rows = [];
  let i = 0;
  const worker = async () => {
    while (i < slice.length) {
      const v = slice[i++];
      try { rows.push(await research(v)); }
      catch (e) { rows.push({ key: v.key, err: String(e && e.message).slice(0, 60) }); }
      await new Promise((ok) => setTimeout(ok, 400));
    }
  };
  await Promise.all([worker(), worker()]);

  res.setHeader('Cache-Control', 'no-store');
  const pad = Math.min(120000, Math.max(0, parseInt(req.query.pad, 10) || 0));
  res.status(200).json({ total: all.length, offset, count: slice.length, rows,
    pad: pad ? ' '.repeat(pad) : undefined });
}
