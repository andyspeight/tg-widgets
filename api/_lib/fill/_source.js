/**
 * The two-source fixer for airports.
 *
 * Andy's rule is that nothing factual gets written unless two INDEPENDENT
 * sources say the same thing. The airport-spotlight skill enforces that by hand
 * for narrative. This does it by machine for the facts a machine can settle:
 *
 *   OurAirports open dataset (CSV)   name, municipality, ISO country, lat/lon,
 *                                    home_link, wikipedia_link
 *   Wikidata (SPARQL, keyed on P238) label, P17/P297 country, P131 place,
 *                                    P625 coordinates, P856 site, enwiki article
 *
 * They are genuinely independent: different maintainers, different editing
 * processes, different failure modes. Neither is derived from the other.
 *
 * WHAT IT WILL NOT DO, and why that matters more than what it will:
 *   - It will not write a field only one source has seen. A single source is a
 *     hold, never an answer.
 *   - It will not pick a winner when the two disagree. Munich is munich-airport.com
 *     to OurAirports and munich-airport.de to Wikidata; both are real, so the
 *     field stays blank and a person decides.
 *   - It will not touch a field that already holds something. An existing value
 *     is a human's work.
 *   - It will not invent an IATA code. Everything here is keyed on the code the
 *     record already carries, so a record without one cannot be verified at all.
 *
 * MEASURED YIELD over 40 real records from the base, 11 Sep 2026:
 *   coordinates 40/40, country 38/40, Wikipedia URL 40/40,
 *   official website 18/40, city served 11/40.
 * Wikipedia URL was 36/40 until redirects were resolved: every one of the four
 * misses was one article under two names, not two articles.
 * The website misses are genuine disagreements between two real sites. The city
 * misses are Wikidata answering a different question: P131 gives the
 * administrative area (Heathrow sits in the London Borough of Hillingdon), not
 * the city the airport serves. Both are left blank rather than guessed.
 *
 * COST: nothing. No model is involved at any point.
 *
 * Tests: npm run test:destinations-source
 */

import { parseOurAirports, splitCsvLine, haversineKm, crossVerify, normalizeName }
  from '../../reference/_breadth_fill.js';
import { getJson, setJsonEx, configured as redisConfigured } from '../../_redis.js';

const OURAIRPORTS_CSV = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const COORD_TOLERANCE_KM = 50;
const UA = 'LunaBrain/1.0 (+https://travelify.io)';
const CACHE_KEY = iata => 'dfill:src:air:' + iata;
/* Thirty days. Coordinates do not move, but an airport can gain a website, and
   a cached "the sources disagree" that never expires is wrong forever. */
const CACHE_TTL = 60 * 60 * 24 * 30;

/** Which airport fields these two sources can settle, and how. */
export const AIRPORT_SOURCED = {
  'Latitude': 'lat',
  'Longitude': 'lon',
  'Country Text': 'country',
  'City Served': 'city',
  'Official Website': 'site',
  'Wikipedia URL': 'wiki',
  'Source 1 URL': 'source1',
  'Source 2 URL': 'source2',
  'Verified Date': 'verified',
};

/** Is there a working fixer for this field on this content type? */
export function hasAirportFixer(label) {
  return Object.prototype.hasOwnProperty.call(AIRPORT_SOURCED, label);
}

/* ------------------------------------------------------------------ *
 * Pure comparison rules. One per field, each answering the same
 * question: did BOTH sources see this, and do they agree?
 * ------------------------------------------------------------------ */

/** The registrable host, lower-cased and without www. Pure. */
export function siteHost(url) {
  try {
    const h = new URL(String(url).trim()).hostname.toLowerCase();
    return h.replace(/^www\./, '');
  } catch { return ''; }
}

/** The article title from an en.wikipedia URL, spaces not underscores. Pure. */
export function wikiTitle(url) {
  try {
    const u = new URL(String(url).trim());
    if (!/^en\.wikipedia\.org$/i.test(u.hostname)) return '';
    const m = /^\/wiki\/(.+)$/.exec(u.pathname);
    return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : '';
  } catch { return ''; }
}

/** A Wikipedia URL folded to something comparable. Pure. */
export function wikiKey(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (!/\.wikipedia\.org$/i.test(u.hostname)) return '';
    return u.hostname.toLowerCase() + decodeURIComponent(u.pathname).toLowerCase().replace(/_/g, ' ');
  } catch { return ''; }
}

/** Prefer https, and prefer the form without a trailing slash. Pure. */
function tidyUrl(a, b) {
  const pick = [a, b].filter(Boolean).sort((x, y) => {
    const s = u => (/^https:/i.test(u) ? 0 : 1);
    return s(x) - s(y) || x.length - y.length;
  })[0] || '';
  return pick.replace(/\/+$/, '');
}

let _regionNames = null;
function countryName(iso) {
  if (!_regionNames) {
    try { _regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); }
    catch { _regionNames = { of: c => c }; }
  }
  try { return _regionNames.of(String(iso).toUpperCase()) || ''; } catch { return ''; }
}

/**
 * What do these two sources agree on, field by field? Pure.
 *
 * @param oa OurAirports record (parseOurAirports output, plus site/wiki)
 * @param wd Wikidata record, already reconciled across bindings
 * @returns {{ agreed: object, why: object }} agreed values, and why each miss missed
 */
export function agreedFields(oa, wd) {
  const agreed = {};
  const why = {};
  // Values the sources may yet agree on, once something is resolved.
  const pending = {};
  const note = (key, value, reason) => {
    if (value !== undefined && value !== null && value !== '') agreed[key] = value;
    else why[key] = reason;
  };

  // Coordinates. Two independent fixes inside the tolerance, or nothing.
  const dist = haversineKm(oa.lat, oa.lon, wd.lat, wd.lon);
  const coordsAgree = dist != null && dist <= COORD_TOLERANCE_KM;
  const coordWhy = dist == null
    ? 'only one source has coordinates'
    : 'the two sources place it ' + Math.round(dist) + 'km apart';
  note('lat', coordsAgree && Number.isFinite(oa.lat) ? oa.lat : '', coordWhy);
  note('lon', coordsAgree && Number.isFinite(oa.lon) ? oa.lon : '', coordWhy);

  // Country. Agreement is on the ISO code, which both sources carry and which
  // cannot be spelled two ways. The name written is a rendering of the agreed
  // code, not a third claim: the table already holds names rather than codes on
  // every record a person entered, and a column with both conventions in it is
  // no use to anyone.
  const oaCc = String(oa.country || '').toUpperCase();
  const wdCc = String(wd.countryCode || '').toUpperCase();
  const ccAgree = !!oaCc && oaCc === wdCc;
  note('country', ccAgree ? countryName(oaCc) : '',
    !oaCc || !wdCc ? 'only one source names a country'
      : 'they disagree: ' + oaCc + ' against ' + wdCc);

  // City served. Strict, and it misses often on purpose: Wikidata's P131 is the
  // administrative area, which is not the question being asked.
  const cityAgree = !!oa.city && !!wd.city && normalizeName(oa.city) === normalizeName(wd.city);
  note('city', cityAgree ? oa.city : '',
    wd.ambiguousCity ? 'Wikidata lists several places for it'
      : !oa.city || !wd.city ? 'only one source names a place'
        : 'they disagree: ' + oa.city + ' against ' + wd.city);

  // Official website. Compared by host, because the same site is written
  // http://www.x.com/ by one and https://x.com by the other.
  const oaHost = siteHost(oa.site), wdHost = siteHost(wd.site);
  const siteAgree = !!oaHost && oaHost === wdHost;
  note('site', siteAgree ? tidyUrl(oa.site, wd.site) : '',
    !oaHost || !wdHost ? 'only one source has an official website'
      : 'they point at different sites: ' + oaHost + ' and ' + wdHost);

  // Wikipedia article. Compared decoded, since one escapes accents and the
  // other does not. Different article titles are a real disagreement: they are
  // usually redirects, but we cannot tell which without following them.
  const oaWiki = wikiKey(oa.wiki), wdWiki = wikiKey(wd.wiki);
  const wikiAgree = !!oaWiki && oaWiki === wdWiki;
  note('wiki', wikiAgree ? tidyUrl(oa.wiki, wd.wiki) : '',
    !oaWiki || !wdWiki ? 'only one source has a Wikipedia article'
      : 'they name different articles');

  // Two DIFFERENT TITLES are not necessarily two different articles. One nearly
  // always redirects to the other: OurAirports says Taipei Songshan Airport and
  // Wikidata says Songshan Airport, and Wikipedia resolves both to one page. On
  // 11 Sep that artefact was holding 1 in 10 airports for a disagreement that
  // did not exist. Ask Wikipedia which page each title lands on, and if it is
  // the same page the two sources agree.
  if (!wikiAgree && oaWiki && wdWiki) {
    const a = wikiTitle(oa.wiki), b = wikiTitle(wd.wiki);
    if (a && b) pending.wiki = [a, b];
  }

  return { agreed, why, pending };
}

/* ------------------------------------------------------------------ *
 * Sources
 * ------------------------------------------------------------------ */

/* Held for the life of the function instance. A batch of 32 airports pays for
   the 13MB download once, and an idle worker never downloads it at all. Only
   the header and a code -> line index are kept: holding the whole file as well
   would be 13MB of a serverless function's memory doing nothing. */
let _csvHead = null;
let _csvIndex = null;
let _csvTried = false;

async function loadIndex(fetchImpl) {
  if (_csvIndex || _csvTried) return;
  _csvTried = true;
  let text = '';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await (fetchImpl || fetch)(OURAIRPORTS_CSV, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    text = r && r.ok ? await r.text() : '';
  } catch { text = ''; } finally { clearTimeout(t); }
  if (!text) return;

  const nl = text.indexOf('\n');
  if (nl === -1) return;
  _csvHead = text.slice(0, nl);
  const ci = splitCsvLine(_csvHead).indexOf('iata_code');
  if (ci === -1) { _csvHead = null; return; }

  const map = new Map();
  let from = nl + 1;
  while (from < text.length) {
    let to = text.indexOf('\n', from);
    if (to === -1) to = text.length;
    const line = text.slice(from, to);
    from = to + 1;
    if (!line) continue;
    const code = (splitCsvLine(line)[ci] || '').toUpperCase();
    if (code.length === 3) map.set(code, line);
  }
  _csvIndex = map;
  // text goes out of scope here, and with it the 13MB.
}

async function ourAirports(iatas, fetchImpl) {
  await loadIndex(fetchImpl);
  const out = new Map();
  if (!_csvIndex || !_csvHead) {
    return { reachable: false, reason: 'the OurAirports dataset could not be downloaded', map: out };
  }
  for (const iata of iatas) {
    const line = _csvIndex.get(iata);
    if (!line) continue;
    const rec = parseOurAirports(_csvHead + '\n' + line, iata);
    if (rec) out.set(iata, rec);
  }
  return { reachable: true, map: out };
}

/**
 * One SPARQL call for the whole batch, grouped back by IATA. Pure.
 *
 * A single airport can return several rows, because P131 often holds more than
 * one administrative area: Beijing Daxing sits across three. A field with more
 * than one distinct value across those rows is ambiguous, and ambiguous is
 * treated as not corroborated rather than resolved by picking the first.
 */
export function reconcileWikidata(json, iatas) {
  const rows = (json && json.results && json.results.bindings) || [];
  const acc = new Map();
  for (const b of rows) {
    const g = k => (b[k] && b[k].value) || '';
    const iata = g('iata').toUpperCase();
    if (!iata) continue;
    const cur = acc.get(iata) || {
      entities: new Set(), names: new Set(), isos: new Set(),
      cities: new Set(), sites: new Set(), arts: new Set(), coords: new Set(),
    };
    if (g('airport')) cur.entities.add(g('airport'));
    if (g('airportLabel')) cur.names.add(g('airportLabel'));
    if (g('iso')) cur.isos.add(g('iso').toUpperCase());
    if (g('placeLabel')) cur.cities.add(g('placeLabel'));
    if (g('site')) cur.sites.add(g('site'));
    if (g('article')) cur.arts.add(g('article'));
    if (g('coord')) cur.coords.add(g('coord'));
    acc.set(iata, cur);
  }

  const out = new Map();
  const only = s => (s.size === 1 ? [...s][0] : '');
  for (const iata of iatas) {
    const a = acc.get(String(iata).toUpperCase());
    if (!a) continue;
    let lat, lon;
    const c = only(a.coords);
    if (c) {
      const m = /Point\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/.exec(c);
      if (m) { lon = parseFloat(m[1]); lat = parseFloat(m[2]); }
    }
    out.set(String(iata).toUpperCase(), {
      iata: String(iata).toUpperCase(),
      entity: only(a.entities).replace('http://www.wikidata.org/entity/', 'https://www.wikidata.org/wiki/'),
      name: only(a.names),
      countryCode: only(a.isos),
      city: only(a.cities),
      ambiguousCity: a.cities.size > 1,
      site: only(a.sites),
      wiki: only(a.arts),
      lat, lon,
    });
  }
  return out;
}

export function sparqlFor(iatas) {
  const values = iatas
    .map(c => String(c).replace(/[^A-Z0-9]/gi, '').toUpperCase())
    .filter(c => c.length === 3)
    .map(c => '"' + c + '"')
    .join(' ');
  return `SELECT ?iata ?airport ?airportLabel ?iso ?placeLabel ?coord ?site ?article WHERE {
  VALUES ?iata { ${values} }
  ?airport wdt:P238 ?iata.
  OPTIONAL { ?airport wdt:P17 ?country. OPTIONAL { ?country wdt:P297 ?iso. } }
  OPTIONAL { ?airport wdt:P131 ?place. }
  OPTIONAL { ?airport wdt:P625 ?coord. }
  OPTIONAL { ?airport wdt:P856 ?site. }
  OPTIONAL { ?article schema:about ?airport ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
}

/**
 * "Could not reach it" is not the same answer as "it has never heard of this".
 *
 * Collapsing the two is how a deleted helper function became the sentence
 * "Wikidata does not have this code" against forty airports it knows perfectly
 * well, on 11 Sep 2026. Worse, warmAirports would have cached that verdict for
 * thirty days. A source that did not answer is reported as unreachable and
 * never cached.
 */
async function wikidata(iatas, fetchImpl) {
  if (!iatas.length) return { reachable: true, map: new Map() };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const url = WIKIDATA_SPARQL + '?format=json&query=' + encodeURIComponent(sparqlFor(iatas));
    const r = await (fetchImpl || fetch)(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r || !r.ok) return { reachable: false, reason: 'Wikidata answered ' + (r ? r.status : 'nothing'), map: new Map() };
    return { reachable: true, map: reconcileWikidata(await r.json(), iatas) };
  } catch (err) {
    return { reachable: false, reason: 'Wikidata could not be reached: ' + String(err.message || err), map: new Map() };
  } finally { clearTimeout(t); }
}

/**
 * Ask Wikipedia which page each title actually lands on, following redirects.
 * @returns {Promise<Map<string, {pageid:number, title:string}>>} keyed by the title asked for
 */
async function resolveWikiTitles(titles, fetchImpl) {
  const want = [...new Set(titles.filter(Boolean))];
  const out = new Map();
  // Anonymous callers may ask about 50 titles at a time.
  for (let i = 0; i < want.length; i += 40) {
    const chunk = want.slice(i, i + 40);
    const url = WIKIPEDIA_API + '?action=query&redirects=1&format=json&origin=*&titles=' +
      encodeURIComponent(chunk.join('|'));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await (fetchImpl || fetch)(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!r || !r.ok) continue;
      mergeWikiAnswer(await r.json(), chunk, out);
    } catch { /* leave them unresolved; they simply stay held */ }
    finally { clearTimeout(t); }
  }
  return out;
}

/**
 * Fold one API answer into the title -> page map. Pure, so the redirect logic
 * is testable without the network.
 */
export function mergeWikiAnswer(json, asked, out) {
  const q = (json && json.query) || {};
  const alias = new Map();                       // what we asked -> what it became
  for (const n of q.normalized || []) alias.set(n.from, n.to);
  for (const r of q.redirects || []) alias.set(r.from, r.to);

  const byTitle = new Map();
  for (const pid of Object.keys(q.pages || {})) {
    const page = q.pages[pid];
    if (!page || !page.title || Number(pid) < 0) continue;   // -1 is "no such page"
    byTitle.set(page.title, { pageid: Number(pid), title: page.title });
  }

  for (const title of asked) {
    // A title can be normalised and THEN redirected, so follow the chain.
    let cur = title;
    for (let hop = 0; hop < 4 && alias.has(cur); hop++) cur = alias.get(cur);
    const hit = byTitle.get(cur);
    if (hit) out.set(title, hit);
  }
  return out;
}

/** The canonical article URL for a resolved page. Pure. */
export function articleUrl(title) {
  return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(title).replace(/ /g, '_'))
    .replace(/%2F/g, '/').replace(/%3A/g, ':');
}

/* ------------------------------------------------------------------ *
 * The batch warm, and the per-field answer
 * ------------------------------------------------------------------ */

const _pairs = new Map();   // iata -> { ok, agreed, why, sources } for this invocation

/**
 * Look up everything this batch needs, in as few calls as possible.
 *
 * Redis holds a verified pair for 30 days, so a second run over the same
 * airports costs no network at all. Only the codes that miss the cache reach
 * the CSV and the SPARQL endpoint, and they go in one request each.
 */
export async function warmAirports(iataList, deps = {}) {
  const want = [...new Set(iataList.map(s => String(s || '').toUpperCase()).filter(s => /^[A-Z]{3}$/.test(s)))];
  const missing = [];

  for (const iata of want) {
    if (_pairs.has(iata)) continue;
    let cached = null;
    if (deps.cacheGet) cached = await deps.cacheGet(iata).catch(() => null);
    else if (redisConfigured()) cached = await getJson(CACHE_KEY(iata)).catch(() => null);
    if (cached) _pairs.set(iata, cached); else missing.push(iata);
  }
  if (!missing.length) return { warmed: want.length, fetched: 0 };

  const [oaRes, wdRes] = await Promise.all([
    (deps.ourAirports || ourAirports)(missing, deps.fetchImpl),
    (deps.wikidata || wikidata)(missing, deps.fetchImpl),
  ]);
  // A test seam may hand back a bare Map; treat that as reachable.
  const asResult = r => (r instanceof Map ? { reachable: true, map: r } : r);
  const oaOut = asResult(oaRes), wdOut = asResult(wdRes);

  // If a source did not answer at all, say so and cache nothing. Every item in
  // this batch is simply retried on the next run.
  if (!oaOut.reachable || !wdOut.reachable) {
    const reason = [oaOut.reachable ? '' : oaOut.reason, wdOut.reachable ? '' : wdOut.reason]
      .filter(Boolean).join('; ');
    for (const iata of missing) _pairs.set(iata, { ok: false, transient: true, reason });
    return { warmed: want.length, fetched: 0, unreachable: reason };
  }

  const oaMap = oaOut.map, wdMap = wdOut.map;
  for (const iata of missing) {
    const oa = oaMap.get(iata);
    const wd = wdMap.get(iata);
    let pair;
    if (!oa || !wd) {
      pair = {
        ok: false,
        reason: !oa && !wd ? 'neither OurAirports nor Wikidata has this code'
          : !oa ? 'OurAirports does not have this code'
            : 'Wikidata does not have this code',
      };
    } else {
      const cv = crossVerify(oa, wd);
      if (!cv.verified) {
        pair = { ok: false, reason: 'the two sources do not agree this is the same airport: ' + cv.conflicts.join(', ') };
      } else {
        const { agreed, why, pending } = agreedFields(oa, wd);
        pair = {
          ok: true, agreed, why, pending,
          sources: { one: OURAIRPORTS_CSV, two: wd.entity || 'https://www.wikidata.org/' },
        };
      }
    }
    _pairs.set(iata, pair);
  }

  // ONE TITLE IS NOT ONE ARTICLE. Where the two sources named different
  // Wikipedia titles, ask Wikipedia which page each lands on. Nearly always it
  // is the same page under a redirect, and holding those was refusing about one
  // airport in ten over a disagreement that did not exist. This resolves the
  // artefact; it does not lower the bar. Two sources still have to be pointing
  // at the same article.
  const titles = [];
  for (const iata of missing) {
    const p = _pairs.get(iata);
    if (p && p.ok && p.pending && p.pending.wiki) titles.push(p.pending.wiki[0], p.pending.wiki[1]);
  }
  if (titles.length) {
    const resolved = await (deps.resolveWiki || resolveWikiTitles)(titles, deps.fetchImpl);
    for (const iata of missing) {
      const p = _pairs.get(iata);
      if (!p || !p.ok || !p.pending || !p.pending.wiki) continue;
      const a = resolved.get(p.pending.wiki[0]);
      const b = resolved.get(p.pending.wiki[1]);
      if (a && b && a.pageid === b.pageid) {
        p.agreed.wiki = articleUrl(a.title);
        delete p.why.wiki;
      } else if (a && b) {
        p.why.wiki = 'they name two different articles, not one under another name';
      }
      delete p.pending;
    }
  }

  for (const iata of missing) {
    const pair = _pairs.get(iata);
    if (!pair) continue;
    // A settled verdict is cached, agreement or not: re-asking a source that
    // has never heard of a code, once a minute, helps nobody. A transient
    // failure never reaches here, so it is never cached.
    if (deps.cacheSet) await deps.cacheSet(iata, pair).catch(() => {});
    else if (redisConfigured()) await setJsonEx(CACHE_KEY(iata), pair, CACHE_TTL).catch(() => {});
  }
  return { warmed: want.length, fetched: missing.length };
}

/** For tests, and for a worker that wants a clean slate. */
export function _resetSourceCache() { _pairs.clear(); _csvHead = null; _csvIndex = null; _csvTried = false; }

/**
 * Answer one field for one airport from the warmed pair.
 *
 * @returns {{ok:true, value:*, evidence:string} | {ok:false, why:string}}
 */
export function sourceAirportField({ field, iata, nowIso }) {
  const key = AIRPORT_SOURCED[field && field.label];
  if (!key) return { ok: false, why: 'there is no two-source fixer for ' + (field && field.label) };

  const code = String(iata || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    return { ok: false, why: 'this record has no IATA code, and both sources are looked up by it' };
  }
  const pair = _pairs.get(code);
  if (!pair) return { ok: false, why: 'the two sources could not be reached for ' + code };
  if (!pair.ok) return { ok: false, why: pair.reason };

  const both = 'OurAirports and Wikidata agree, looked up by IATA code ' + code + '.';

  // The three that record the verification itself rather than a fact about the
  // place. They are only ever written alongside a pair that did agree.
  if (key === 'source1') return { ok: true, value: pair.sources.one, evidence: both };
  if (key === 'source2') return { ok: true, value: pair.sources.two, evidence: both };
  if (key === 'verified') {
    return { ok: true, value: (nowIso || new Date().toISOString()).slice(0, 10), evidence: both };
  }

  const value = pair.agreed[key];
  if (value === undefined || value === null || value === '') {
    return { ok: false, why: (pair.why && pair.why[key]) || 'the two sources do not agree on it' };
  }
  return { ok: true, value, evidence: both + ' Both give ' + JSON.stringify(value) + '.' };
}
