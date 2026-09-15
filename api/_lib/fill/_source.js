/**
 * The two-source fixer for airports.
 *
 * Andy's rule is that nothing factual gets written unless two INDEPENDENT
 * sources say the same thing. The airport-spotlight skill enforces that by hand
 * for narrative. This does it by machine for the facts a machine can settle:
 *
 *   OurAirports open dataset (CSV)   name, municipality, ISO country, lat/lon,
 *                                    home_link, wikipedia_link
 *   Wikidata (SPARQL, keyed on P238) label, P17/P297 country, P931 place served,
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
 * The website misses are genuine disagreements between two real sites.
 *
 * CITY SERVED was the one this could not do, and the reason was the question
 * rather than the sources. It asked Wikidata for P131, the administrative area
 * an airport STANDS IN, so Heathrow came back as the London Borough of
 * Hillingdon and Brussels as Zaventem, and the honest verdict was always "they
 * disagree". Wikidata has a property for the question actually being asked,
 * P931, "place served by transport hub". Asked that one, on 15 Sep 2026, the
 * two sources agreed on 302 of the 362 airports that held no answer at all, and
 * against the 238 a person had already filled in they contradicted the record
 * seven times, every one of them island-or-capital wording rather than a wrong
 * place. The 60 that still hold are real disagreements worth holding: Malpensa
 * is Ferno to one and Milan to the other.
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
/**
 * BUMP THE VERSION WHENEVER THE COMPARISON RULES CHANGE. A cached pair is a
 * verdict, not raw data, so a verdict reached under the old rules would go on
 * being served for thirty days after the rules improved.
 *
 *   v2  the territory rule, 14 Sep 2026. Without the bump the ten airports held
 *       that morning would have stayed held until October while the code that
 *       fixed them sat live.
 *   v3  the third opinion on official websites, same day. Every one of the 291
 *       airports still missing one already carries a v2 verdict saying the two
 *       sources disagreed, and those would have been served straight back.
 *   v4  the article corroborating a site only OurAirports had, same day again.
 *       The 217 left after v3 all carry a verdict saying only one source had
 *       one, which is exactly the case v4 reopens.
 */
const CACHE_KEY = iata => 'dfill:src:air:v4:' + iata;
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

/**
 * The city at the head of an OurAirports municipality. It writes the province or
 * the district after the name, so "Pisa (PI)", "Kuta, Badung" and "Cincinnati /
 * Covington" all name their city first and qualify it afterwards. Pure.
 */
export function placeHead(value) {
  return String(value || '').replace(/\s*\([^)]*\)\s*$/, '').split(/\s*[,/]\s*/)[0].trim();
}

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

/**
 * How this column already spells things, where the standard list disagrees.
 *
 * The names come from Intl's region list, which is CLDR. CLDR is right and also
 * not what a UK travel agent writes: it gives "United States", "United Arab
 * Emirates" and "Macao SAR China" where the 590 airports already in the table
 * say USA, UAE and Hong Kong. Writing the CLDR spelling would put a second
 * convention into a column that already has one, which is the thing the country
 * rule below is careful to avoid.
 *
 * This is a rendering of a verified code, not a claim about the place. The fact
 * is the ISO code both sources agreed on. How it is spelled in English is house
 * style, and the house style here is the one Andy's own records set.
 */
const COUNTRY_NAME = {
  US: 'USA',
  AE: 'UAE',
  MO: 'Macau',
  VC: 'St Vincent and the Grenadines',
};

/**
 * The same site, or one sitting under the other. Bari's airport is written
 * aeroportidipuglia.it by one source and bari.airports.aeroportidipuglia.it by
 * another, and those are the same place.
 *
 * Deliberately NOT a registrable-domain comparison. Doing that properly needs a
 * public suffix list, and doing it naively by taking the last two labels makes
 * rac.co.rw and kenyaairports.co.ke both "co.rw" and "co.ke", which would match
 * unrelated sites under the same country code and quietly break the one rule
 * this whole file exists to keep.
 */
export function sameSite(a, b) {
  if (!a || !b) return false;
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

let _regionNames = null;
function countryName(iso) {
  const code = String(iso || '').toUpperCase();
  if (!code) return '';
  if (COUNTRY_NAME[code]) return COUNTRY_NAME[code];
  if (!_regionNames) {
    try { _regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); }
    catch { _regionNames = { of: c => c }; }
  }
  let name;
  try { name = _regionNames.of(code) || ''; } catch { return ''; }
  return name
    .replace(/\s+SAR\s+China$/i, '')   // Hong Kong SAR China -> Hong Kong
    .replace(/\bU\.S\./g, 'US')        // U.S. Virgin Islands -> US Virgin Islands
    .replace(/\bSt\./g, 'St')           // UK English drops the stop
    .replace(/\s*&\s*/g, ' and ')      // Turks & Caicos -> Turks and Caicos
    .trim();
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
  //
  // A DEPENDENT TERRITORY IS NOT A DISAGREEMENT. This blocked ten airports on
  // 14 Sep 2026 with "they disagree: TC against GB" and nine others like it.
  // Neither source was wrong. They were answering different questions:
  // OurAirports records the ISO 3166-1 territory an airport sits in (TC, PR,
  // GU, VG, VI, GP, MO, PF), and Wikidata's P17 records the sovereign state it
  // belongs to (GB, US, FR, CN). Both true of Providenciales.
  //
  // So the comparison is against every ISO code Wikidata places the airport
  // inside, its P131 chain as well as P17. Wikidata independently says
  // Providenciales is in Turks and Caicos, so writing that is still two sources
  // agreeing rather than a preference for one of them. An airport with no
  // territory above it is unaffected: for Heathrow both answers are GB.
  //
  // The territory is also the answer the product needs. Nobody sells a holiday
  // to "United Kingdom" meaning Providenciales.
  const oaCc = String(oa.country || '').toUpperCase();
  const wdCc = String(wd.countryCode || '').toUpperCase();
  const wdAll = wd.isoCodes instanceof Set && wd.isoCodes.size
    ? wd.isoCodes
    : new Set([wdCc].filter(Boolean));
  const ccAgree = !!oaCc && wdAll.has(oaCc);
  // Say it in place names. "they disagree: TC against GB" is true and unreadable,
  // and it was the reason a real hold could not be understood from the dashboard.
  const named = c => countryName(c) || c;
  note('country', ccAgree ? countryName(oaCc) : '',
    !oaCc || !wdAll.size ? 'only one source names a country'
      : 'they disagree: one source says ' + named(oaCc) + ', the other says ' +
        [...wdAll].sort().map(named).join(' or '));

  // City served. This used to ask Wikidata for P131, which is the administrative
  // area an airport STANDS IN, and then report honestly that the two sources
  // never agreed. They never agreed because they were being asked different
  // questions: P131 says Dublin airport is in Fingal and Brussels is in
  // Zaventem. Wikidata has a property for the actual question, P931, "place
  // served by transport hub", and asked that one the two sources agree on 302
  // of the 362 airports that had no answer at all. Checked first against 238
  // values a person had set by hand: where both sources agreed, they contradicted
  // the record seven times and all seven were island-or-capital wording rather
  // than a wrong place.
  const oaCity = placeHead(oa.city);
  const cityAgree = !!oaCity && !!wd.city && normalizeName(oaCity) === normalizeName(wd.city);
  note('city', cityAgree ? oaCity : '',
    wd.ambiguousCity ? 'Wikidata lists several places for it'
      : !oaCity || !wd.city ? 'only one source names a place'
        : 'they disagree: ' + oaCity + ' against ' + wd.city);

  // Official website. Compared by host, because the same site is written
  // http://www.x.com/ by one and https://x.com by the other.
  const oaHost = siteHost(oa.site), wdHost = siteHost(wd.site);
  const siteAgree = sameSite(oaHost, wdHost);
  // The airport's own Wikipedia article is asked in two cases, and refused in a
  // third. warmAirports does the asking.
  if (!siteAgree && wd.wiki) {
    if (oaHost && wdHost) {
      // Both have one and they differ. The article breaks the tie, two of three.
      pending.site = { both: true, oa: oa.site, wd: wd.site, article: wd.wiki };
    } else if (oaHost && !wdHost) {
      // Only OurAirports has one, and the article can corroborate it. An
      // aviation dataset and an encyclopaedia are separate projects with
      // separate contributors, so that is two independent sources.
      //
      // THE MIRROR CASE IS DELIBERATELY MISSING. When only Wikidata has a site,
      // its own Wikipedia article agreeing proves very little: the two are
      // sister projects that import from each other constantly, and P856 is
      // routinely lifted from the infobox it would be checked against. It would
      // have been worth about 15 more airports in a sample of 100 and it would
      // have made "two independent sources agree" mean less than it says.
      pending.site = { both: false, oa: oa.site, wd: '', article: wd.wiki };
    }
  }
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
 * A single airport can return several rows, because an airport can serve more
 * than one place: Basel Mulhouse serves three countries' cities. A field with more
 * than one distinct value across those rows is ambiguous, and ambiguous is
 * treated as not corroborated rather than resolved by picking the first.
 */
/** "Point(lon lat)" as numbers, or null. */
function parsePoint(wkt) {
  const m = /Point\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/.exec(wkt || '');
  return m ? { lon: parseFloat(m[1]), lat: parseFloat(m[2]) } : null;
}

/** Are all of these the same place, within the tolerance used everywhere else? */
function onePlace(points) {
  for (let i = 1; i < points.length; i++) {
    const d = haversineKm(points[0].lat, points[0].lon, points[i].lat, points[i].lon);
    if (d == null || d > COORD_TOLERANCE_KM) return false;
  }
  return true;
}

export function reconcileWikidata(json, iatas) {
  const rows = (json && json.results && json.results.bindings) || [];
  const acc = new Map();
  for (const b of rows) {
    const g = k => (b[k] && b[k].value) || '';
    const iata = g('iata').toUpperCase();
    if (!iata) continue;
    const cur = acc.get(iata) || {
      entities: new Set(), names: new Set(), isos: new Set(), terrs: new Set(),
      cities: new Set(), sites: new Set(), arts: new Set(), coords: new Set(),
    };
    if (g('airport')) cur.entities.add(g('airport'));
    if (g('airportLabel')) cur.names.add(g('airportLabel'));
    if (g('iso')) cur.isos.add(g('iso').toUpperCase());
    if (g('terr')) cur.terrs.add(g('terr').toUpperCase());
    if (g('servedLabel') && !/^Q\d+$/.test(g('servedLabel'))) cur.cities.add(g('servedLabel'));
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
    // Coordinates. One IATA code can belong to more than one Wikidata entity
    // when a civil airport and a co-located air base are recorded separately,
    // as at Faa'a, where PPT is on both the airport and the airbase half a
    // kilometre away. Points that all sit inside the same tolerance are
    // describing one place, so they are treated as one rather than discarded as
    // ambiguous. Points genuinely far apart stay ambiguous and the record is
    // held, which is the case this strictness was there for.
    let lat, lon;
    const points = [...a.coords].map(parsePoint).filter(Boolean);
    if (points.length && onePlace(points)) { lat = points[0].lat; lon = points[0].lon; }

    out.set(String(iata).toUpperCase(), {
      iata: String(iata).toUpperCase(),
      entity: only(a.entities).replace('http://www.wikidata.org/entity/', 'https://www.wikidata.org/wiki/'),
      name: only(a.names),
      countryCode: only(a.isos),
      // Every ISO 3166-1 code Wikidata places this airport inside, sovereign
      // state and dependent territory alike. See the country rule in
      // agreedFields for why both are needed.
      isoCodes: new Set([...a.isos, ...a.terrs]),
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
  return `SELECT ?iata ?airport ?airportLabel ?iso ?terr ?servedLabel ?coord ?site ?article WHERE {
  VALUES ?iata { ${values} }
  ?airport wdt:P238 ?iata.
  OPTIONAL { ?airport wdt:P17 ?country. OPTIONAL { ?country wdt:P297 ?iso. } }
  OPTIONAL { ?airport wdt:P931 ?served. }
  OPTIONAL { ?airport wdt:P131* ?admin. ?admin wdt:P297 ?terr. }
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
 * The website an article STATES ITSELF, from its infobox wikitext. Pure.
 *
 * THE TEMPLATE CHECK IS THE WHOLE POINT. Many airport articles write
 * "| website = {{Official URL}}", and that template reads the value straight
 * out of Wikidata. Taking it would be Wikidata agreeing with Wikidata, dressed
 * up as a third source, and it would put a single-sourced value into a column
 * whose entire promise is that two independent sources agreed. Measured on
 * 14 Sep 2026 it was one article in twenty-three, so the trap is real and rare,
 * which is the worst combination: rare enough to miss, real enough to matter.
 *
 * Only a literal URL written into the article counts.
 */
export function localSiteFromWikitext(wikitext) {
  const m = /^[ \t]*\|[ \t]*website[ \t]*=[ \t]*(.*)$/im.exec(wikitext || '');
  if (!m) return { url: '', why: 'the article lists no website' };
  const v = m[1].trim();
  if (!v) return { url: '', why: 'the article lists no website' };
  if (/^\{\{\s*(official url|official website|url)\s*\}\}$/i.test(v)) {
    return { url: '', why: 'the article takes its website from Wikidata, so it is not a third opinion' };
  }
  // {{URL|x}}, {{URL|url=x}}, {{Official website|url=x}}, [https://x text], or a bare URL.
  const first = re => {
    const x = re.exec(v);
    return x ? String(x[1]).replace(/^\s*(?:url|1)\s*=\s*/i, '').trim() : '';
  };
  let u = first(/\{\{\s*(?:URL|official website)\s*\|\s*([^|}]+)/i)
       || first(/\[\s*(https?:\/\/[^\s\]]+)/i)
       || first(/^(https?:\/\/\S+)/i);
  if (!u) return { url: '', why: 'the article states its website in a form we cannot read' };
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/\//, '');
  try { new URL(u); } catch { return { url: '', why: 'the article states an unusable website' }; }
  return { url: u, why: '' };
}

/**
 * Lead-section wikitext for a batch of articles, keyed by the title asked for.
 *
 * Section 0 only, because the infobox lives there and a full airport article is
 * several hundred kilobytes. Twenty titles came back in about seventeen.
 */
async function resolveArticleSites(articleUrls, fetchImpl) {
  const titles = [...new Set(articleUrls.map(wikiTitle).filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < titles.length; i += 20) {
    const chunk = titles.slice(i, i + 20);
    const url = WIKIPEDIA_API + '?action=query&format=json&formatversion=2&redirects=1' +
      '&prop=revisions&rvprop=content&rvslots=main&rvsection=0&origin=*&titles=' +
      encodeURIComponent(chunk.join('|'));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await (fetchImpl || fetch)(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!r || !r.ok) continue;
      mergeArticleText(await r.json(), chunk, out);
    } catch { /* unresolved titles simply leave the record held */ }
    finally { clearTimeout(t); }
  }
  return out;
}

/**
 * Fold one wikitext answer back onto the titles asked for, following the
 * normalisation and redirects the API reports. Pure.
 */
export function mergeArticleText(json, asked, out) {
  const q = (json && json.query) || {};
  const norm = new Map((q.normalized || []).map(n => [n.from, n.to]));
  const red = new Map((q.redirects || []).map(n => [n.from, n.to]));
  const byTitle = new Map((q.pages || []).map(p => [
    p.title,
    (p.revisions && p.revisions[0] && p.revisions[0].slots &&
     p.revisions[0].slots.main && p.revisions[0].slots.main.content) || '',
  ]));
  for (const t of asked) {
    let k = norm.get(t) || t;
    k = red.get(k) || k;
    const text = byTitle.get(k);
    if (text) out.set(t, text);
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

/**
 * The opening section of a Wikipedia article, as plain text.
 *
 * WHY THE WRITER NEEDS THIS. An airport record holds about 23 characters the
 * writer can use: a three-letter code, a country, two coordinates. The floor
 * for writing anything at all is 60, so every Overview was refused before a
 * model was ever called. Measured on 14 Sep 2026 the article intro averages 883
 * characters of real, cited, third-party fact, and we already hold the article
 * URL for 567 of the 600 airports.
 *
 * It is EVIDENCE, not copy. The gate still checks every claim in the written
 * value against what was handed to it, so a sentence that strays beyond the
 * article is held exactly as it is today. The bar does not move; the record
 * simply stops being empty.
 *
 * exintro gives the lead section only, explaintext strips the markup, so this
 * is a few hundred bytes rather than the several hundred kilobytes a full
 * article would cost.
 */
export async function wikipediaIntro(articleUrl, fetchImpl) {
  const title = wikiTitle(articleUrl);
  if (!title) return { ok: false, why: 'no Wikipedia article on this record' };
  const url = WIKIPEDIA_API + '?action=query&format=json&formatversion=2&redirects=1' +
    '&prop=extracts&exintro=1&explaintext=1&origin=*&titles=' + encodeURIComponent(title);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await (fetchImpl || fetch)(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r || !r.ok) return { ok: false, why: 'Wikipedia answered ' + (r ? r.status : 'nothing') };
    const j = await r.json();
    const page = ((j && j.query && j.query.pages) || [])[0];
    const text = String((page && page.extract) || '').replace(/\s+/g, ' ').trim();
    if (!text) return { ok: false, why: 'the article has no opening section' };
    return { ok: true, text, source: articleUrl };
  } catch (err) {
    return { ok: false, why: 'Wikipedia could not be reached: ' + String(err.message || err) };
  } finally { clearTimeout(t); }
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
      delete p.pending.wiki;
    }
  }

  // THE THIRD OPINION, and the only place this file asks for one.
  //
  // Where both sources have an official website and the two differ, the
  // airport's own Wikipedia article is asked to break the tie. Two of three
  // agreeing is still two independent sources agreeing, which is the rule, so
  // long as the third really is independent. Measured over 23 real clashes on
  // 14 Sep 2026 it backed OurAirports 4 times and Wikidata 11, and named a
  // different site again 5 times, so it is genuinely its own opinion rather
  // than a copy of either. It settled 15 of the 22 it could see.
  //
  // Only a website written into the article counts. See localSiteFromWikitext
  // for why a template that reads Wikidata is refused rather than trusted.
  const ties = missing.filter(i => {
    const p = _pairs.get(i);
    return p && p.ok && p.pending && p.pending.site;
  });
  if (ties.length) {
    const text = await (deps.resolveArticles || resolveArticleSites)(
      ties.map(i => _pairs.get(i).pending.site.article), deps.fetchImpl);
    for (const iata of ties) {
      const p = _pairs.get(iata);
      const t = p.pending.site;
      const wt = text.get(wikiTitle(t.article));
      const third = wt ? localSiteFromWikitext(wt) : { url: '', why: 'the article could not be read' };
      const h = siteHost(third.url), ho = siteHost(t.oa), hw = siteHost(t.wd);
      const backs = sameSite(h, ho) ? t.oa : (hw && sameSite(h, hw)) ? t.wd : '';
      if (backs) {
        p.agreed.site = tidyUrl(backs, third.url);
        p.brokeTieOn = p.brokeTieOn || {};
        p.brokeTieOn.site = { article: t.article, both: !!t.both };
        delete p.why.site;
      } else if (t.both) {
        p.why.site = h
          ? 'all three sources name a different site: ' + ho + ', ' + hw + ' and ' + h
          : 'they point at different sites, ' + ho + ' and ' + hw + ', and ' + third.why;
      } else {
        p.why.site = h
          ? 'only OurAirports has an official website and the article names another: ' + ho + ' against ' + h
          : 'only one source has an official website, and ' + third.why;
      }
      delete p.pending.site;
    }
  }

  for (const iata of missing) {
    const pair = _pairs.get(iata);
    if (!pair) continue;
    if (pair.pending && !Object.keys(pair.pending).length) delete pair.pending;
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
  if (!pair) return { ok: false, transient: true, why: 'the two sources could not be reached for ' + code };
  // A source that did not answer has decided nothing. Say so, so the caller can
  // put the record back in the queue rather than record a verdict it never got.
  if (!pair.ok) return { ok: false, why: pair.reason, transient: !!pair.transient };

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
  // Say which two of the three agreed, so a value settled by a tie-break can
  // never be mistaken later for one the first two sources agreed on outright.
  const tie = pair.brokeTieOn && pair.brokeTieOn[key];
  if (tie) {
    const article = typeof tie === 'string' ? tie : tie.article;
    const wasTie = typeof tie === 'string' ? true : !!tie.both;
    return { ok: true, value, evidence: wasTie
      ? 'OurAirports and Wikidata named different sites for IATA code ' + code +
        '. The Wikipedia article ' + article + ' states ' + JSON.stringify(value) +
        ', which settles it two to one.'
      : 'Only OurAirports had a website for IATA code ' + code +
        '. The Wikipedia article ' + article + ' independently states ' +
        JSON.stringify(value) + ', so two sources agree.' };
  }
  return { ok: true, value, evidence: both + ' Both give ' + JSON.stringify(value) + '.' };
}
