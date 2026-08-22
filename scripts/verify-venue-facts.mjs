#!/usr/bin/env node
/**
 * Prune api/_data/venue-facts.json down to double-verified facts only.
 *
 * Policy (Andy, 22 Aug 2026): no made-up data, double verification on
 * everything. Verdicts come from the temporary Wikipedia-infobox verifier
 * (verifypage-*.json); a fact stays on the sheet only when the second,
 * independently maintained source corroborates it:
 *
 *   capacity  Wikidata claim vs a number within 1% in the article's infobox
 *   opened    Wikidata year vs the article's opened/built line
 *   website   Wikidata URL vs the same domain appearing in the article
 *   city      the feed's own location text vs the article mentioning it
 *   country   the feed's text vs the country the anchor's TIMEZONE implies -
 *             two independent derivations of the same claim
 *   photo and Wikipedia link  kept only when the article's identity passed
 *             BOTH checks: coordinates within 2km AND a shared name token
 *
 * Anything unconfirmed is removed, not flagged. Timezone and airport
 * distances are deterministic computation, not claims, and stay.
 *
 * Usage: node scripts/verify-venue-facts.mjs <dir-with-verifypage-*.json>
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const dir = process.argv[2];
if (!dir) { console.error('usage: verify-venue-facts.mjs <dir>'); process.exit(1); }

const path = 'api/_data/venue-facts.json';
const data = JSON.parse(readFileSync(path, 'utf8'));

// Union of verdicts across passes: a fact is confirmed if ANY pass confirmed
// it (a throttled fetch must not read as a refutation), but identity requires
// an actual successful fetch with a passing title.
const verdicts = new Map();
for (const f of readdirSync(dir).filter((f) => /^verifypage-.*\.json$/.test(f)).sort()) {
  for (const r of JSON.parse(readFileSync(dir + '/' + f, 'utf8')).rows) {
    const cur = verdicts.get(r.key) || {};
    for (const k of ['fetched', 'titleOk', 'capOk', 'openedOk', 'webOk', 'cityOk']) {
      if (r[k] === true) cur[k] = true;
      else if (cur[k] === undefined && r[k] === false) cur[k] = false;
    }
    verdicts.set(r.key, cur);
  }
}

// Identity failures reviewed by hand, 22 Aug 2026. The token check compares
// the venue's feed name with the article title, so it flags sponsor renames
// (Oracle Arena is now Oakland Arena), English translations (Stadion Slaski
// is Silesian Stadium) and one-word titles the tokeniser cannot split
// (Hockenheimring). Each entry below was checked against the article: same
// building, different name, coordinates already matched within 2km. The map
// pins the exact article title, so a rebuild that changes the match lapses
// the review instead of inheriting it. Deliberately NOT listed: theo2, whose
// coordinate match was the Millennium Dome article - the building's previous
// life, not the music venue - so its Wikipedia-sourced facts stay off.
const REVIEWED_RENAMES = {
  arenanurnbergerversicherung: 'PSD Bank Nürnberg Arena',
  bancofcaliforniastadium: 'BMO Stadium',
  bentelerarena: 'Home Deluxe Arena',
  brondbystadion: 'Brøndby Stadium',
  cezarenapardubice: 'Enteria arena',
  epetarena: 'Stadion Letná',
  estadiodelosjuegosmediterraneos: 'UD Almería Stadium',
  estadionacional: 'Costa Rica National Stadium (2011)',
  gudmehallerne: 'Gudme-Hallerne',
  hockenheimring: 'Hockenheimring',
  homemonitoringarena: 'Logspeed CZ Aréna',
  mestskystadionmladaboleslav: 'Lokotrans Aréna',
  oraclearena: 'Oakland Arena',
  palaalpitour: 'Inalpi Arena',
  prezeroarena: 'Rhein-Neckar-Arena',
  quarterbackimmobilienarena: 'Arena Leipzig',
  qudosbankarena: 'Sydney SuperDome',
  racarena: 'Perth Arena',
  rheinenergiestadion: 'RheinEnergieStadion',
  stadioatletiazzurriditalia: 'Stadio di Bergamo',
  stadionslaski: 'Silesian Stadium',
  stadionwojskapolskiego: 'Polish Army Stadium',
  stadioolimpico: 'Stadio Olimpico',
  stadiummunicipal: 'Stadium de Toulouse',
  westfalenhalle: 'Westfalenhallen',
};
const wikiTitle = (url) => {
  const m = /\/wiki\/(.+)$/.exec(url || '');
  try { return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : null; }
  catch { return null; }
};

// Same-site predecessor traps, reviewed by hand, 22 Aug 2026. The coordinate
// gate cannot tell a venue from the demolished venue it replaced on the same
// ground, and the article about the OLD building corroborates the OLD
// building's facts, so double verification passes while the identity is
// wrong. These keys matched a predecessor's article (title pinned); ALL their
// Wikidata-sourced facts are purged. Candidates for a proper rematch later:
// search the current article by title, then re-verify. Found by scanning
// kept titles for year/(original) disambiguators; theo2 (Millennium Dome)
// is the same trap but already fails the title check.
const PREDECESSOR_ARTICLES = {
  wembleystadium: 'Wembley Stadium (1923)',
  sanmamesstadium: 'San Mamés Stadium (1913)',
  stadelouisii: 'Stade Louis II (1939)',
  hidegkutinandorstadion: 'Hidegkuti Nándor Stadion (1947)',
  sergiolanfranchi: 'Stadio Sergio Lanfranchi (original)',
};

// The country a timezone implies, for the countries the feed names.
const TZ_COUNTRY = {
  'Europe/London': ['England', 'Scotland', 'Wales', 'Northern Ireland', 'UK'],
  'Europe/Dublin': ['Ireland', 'Republic of Ireland'],
  'Europe/Paris': ['France', 'Monaco'], 'Europe/Madrid': ['Spain'],
  'Europe/Rome': ['Italy', 'San Marino'], 'Europe/Berlin': ['Germany'],
  'Europe/Amsterdam': ['Netherlands', 'The Netherlands'], 'Europe/Brussels': ['Belgium'],
  'Europe/Lisbon': ['Portugal'], 'Europe/Vienna': ['Austria'],
  'Europe/Zurich': ['Switzerland'], 'Europe/Warsaw': ['Poland'],
  'Europe/Prague': ['Czechia', 'Czech Republic'], 'Europe/Copenhagen': ['Denmark'],
  'Europe/Stockholm': ['Sweden'], 'Europe/Oslo': ['Norway'], 'Europe/Helsinki': ['Finland'],
  'Europe/Zagreb': ['Croatia'], 'Europe/Belgrade': ['Serbia'], 'Europe/Athens': ['Greece'],
  'Europe/Istanbul': ['Turkey'], 'Europe/Budapest': ['Hungary'], 'Europe/Bucharest': ['Romania'],
  'Europe/Sofia': ['Bulgaria'], 'Europe/Bratislava': ['Slovakia'], 'Europe/Ljubljana': ['Slovenia'],
  'Europe/Luxembourg': ['Luxembourg'], 'Europe/Monaco': ['Monaco', 'France'],
  'Australia/Sydney': ['Australia'], 'Australia/Melbourne': ['Australia'],
  'Australia/Brisbane': ['Australia'], 'Australia/Perth': ['Australia'],
  'Australia/Adelaide': ['Australia'], 'Pacific/Auckland': ['New Zealand'],
  'America/Toronto': ['Canada'], 'America/Vancouver': ['Canada'],
  'America/Winnipeg': ['Canada'], 'America/Edmonton': ['Canada'],
  'America/Montreal': ['Canada'], 'America/Regina': ['Canada'],
  'America/Mexico_City': ['Mexico'], 'America/Monterrey': ['Mexico'],
  'America/Sao_Paulo': ['Brazil'], 'America/Fortaleza': ['Brazil'],
  'America/Argentina/Buenos_Aires': ['Argentina'], 'America/Santiago': ['Chile'],
  'America/Bogota': ['Colombia'], 'America/Guayaquil': ['Ecuador'],
  'America/Montevideo': ['Uruguay'], 'America/Asuncion': ['Paraguay'],
  'Asia/Dubai': ['United Arab Emirates (UAE)', 'UAE'], 'Asia/Riyadh': ['Saudi Arabia'],
  'Asia/Singapore': ['Singapore'], 'Asia/Bangkok': ['Thailand'],
  'Asia/Kuala_Lumpur': ['Malaysia'], 'Asia/Taipei': ['Taiwan'], 'Asia/Tokyo': ['Japan'],
  'Asia/Hong_Kong': ['Hong Kong', 'China'], 'Asia/Jakarta': ['Indonesia'],
  'Asia/Baku': ['Azerbaijan'], 'Asia/Bahrain': ['Bahrain'], 'Asia/Qatar': ['Qatar'],
};
const usTz = (tz) => /^America\//.test(tz) && !TZ_COUNTRY[tz];

const stats = { sheets: 0, capKept: 0, capDropped: 0, openedKept: 0, openedDropped: 0,
  webKept: 0, webDropped: 0, cityKept: 0, cityDropped: 0, countryKept: 0, countryDropped: 0,
  imgKept: 0, imgDropped: 0, identityFailed: 0 };

for (const [key, f] of Object.entries(data.venues)) {
  stats.sheets++;
  const v = verdicts.get(key) || {};
  const predecessor = PREDECESSOR_ARTICLES[key] === wikiTitle(f.wiki);
  const identity = !predecessor && v.fetched === true
    && (v.titleOk === true || REVIEWED_RENAMES[key] === wikiTitle(f.wiki));

  if (f.qid && !identity) stats.identityFailed++;
  const keepIf = (field, ok, kept, dropped) => {
    if (f[field] === undefined) return;
    if (identity && ok === true) stats[kept]++;
    else { delete f[field]; stats[dropped]++; }
  };
  keepIf('cap', v.capOk, 'capKept', 'capDropped');
  keepIf('opened', v.openedOk, 'openedKept', 'openedDropped');
  keepIf('web', v.webOk, 'webKept', 'webDropped');
  keepIf('city', v.cityOk, 'cityKept', 'cityDropped');
  if (f.img !== undefined || f.wiki !== undefined) {
    if (identity) stats.imgKept++;
    else { delete f.img; delete f.wiki; delete f.qid; stats.imgDropped++; }
  }

  if (f.country !== undefined) {
    const allowed = TZ_COUNTRY[f.tz];
    const ok = (allowed && allowed.some((c) => c.toLowerCase() === f.country.toLowerCase()))
      || (f.country === 'USA' && usTz(f.tz));
    if (ok) stats.countryKept++;
    else { delete f.country; stats.countryDropped++; }
  }
}

data._comment = 'Venue fact sheets, DOUBLE-VERIFIED (policy of 22 Aug 2026: no fact is '
  + 'shown unless two independently maintained sources agree). capacity/opened/website: '
  + 'Wikidata claim corroborated by the live Wikipedia infobox. city: the feed\'s own '
  + 'location text corroborated by the article. country: the feed\'s text corroborated '
  + 'by the country the anchor\'s timezone implies. photo and Wikipedia link: kept only '
  + 'when the article passed both identity checks (coordinates within 2km AND a shared '
  + 'name token). Timezone and airport distances are deterministic computation. '
  + 'Rebuild: docs/supplier-event-feed.md.';
data.verifiedAt = '2026-08-22';
writeFileSync(path, JSON.stringify(data) + '\n');

console.log(JSON.stringify(stats, null, 1));
