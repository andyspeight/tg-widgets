/**
 * Travelgenix Widget Suite — Exonym dictionary + place-name translation
 *
 * The autocomplete translator (api/autocomplete.js) uses this to turn a place
 * name typed in the customer's language into the English name Travelify indexes
 * (Londra -> London) on the way in, and to put Travelify's English names back
 * into the customer's language (London -> Londra) on the way out.
 *
 * KEY IDEA — we do NOT translate Travelify's million+ location names. Almost
 * none of them differ between languages: resorts, hotels, airports, ports,
 * points of interest and small towns are spelled the same everywhere. Only a
 * small, stable set genuinely differs (countries and major cities). We hold that
 * set here; everything else passes straight through unchanged, which is the
 * correct display for the long tail.
 *
 * Matching is case AND accent insensitive (see normalise) because customers type
 * without diacritics — "Veneția", "Venetia" and "VENETIA" must resolve alike.
 *
 * Canonical (English) forms are a best first guess. They get tuned once we can
 * see live Travelify results, since a match depends on the exact spelling
 * Travelify indexes. See docs/autocomplete-translation-spec.md.
 *
 * Pure module, no Node or browser APIs, so tests import it directly
 * (tests/autocomplete-translate.test.mjs).
 */

// Fold to a comparison key: lowercase, map the Romanian special letters, strip
// remaining European accents, collapse whitespace. Romanian ș/ț use a
// comma-below that does not live in the combining-diacritics block, so they are
// mapped explicitly before the generic accent strip handles ü, é and friends.
export function normalise(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[șş]/g, 's')
    .replace(/[țţ]/g, 't')
    .replace(/[ăâ]/g, 'a')
    .replace(/î/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Table key from a language code: first two letters, lowercased (ro-RO -> ro).
function langKey(lang) {
  return String(lang == null ? '' : lang).trim().toLowerCase().slice(0, 2);
}

// Seed exonyms per language. Each entry is [ localName, canonicalEnglishName ].
// Only names that genuinely differ from English are listed. The first local form
// listed for a given English name is the one shown back to the customer.
export const EXONYMS = {
  ro: [
    // Cities
    ['Londra', 'London'],
    ['Roma', 'Rome'],
    ['Milano', 'Milan'],
    ['Napoli', 'Naples'],
    ['Torino', 'Turin'],
    ['Genova', 'Genoa'],
    ['Veneția', 'Venice'],
    ['Florența', 'Florence'],
    ['Viena', 'Vienna'],
    ['München', 'Munich'],
    ['Köln', 'Cologne'],
    ['Praga', 'Prague'],
    ['Varșovia', 'Warsaw'],
    ['Cracovia', 'Krakow'],
    ['Lisabona', 'Lisbon'],
    ['Atena', 'Athens'],
    ['Salonic', 'Thessaloniki'],
    ['Bruxelles', 'Brussels'],
    ['Anvers', 'Antwerp'],
    ['Haga', 'The Hague'],
    ['Copenhaga', 'Copenhagen'],
    ['Nisa', 'Nice'],
    ['Marsilia', 'Marseille'],
    ['Sevilla', 'Seville'],
    ['Moscova', 'Moscow'],
    ['Belgrad', 'Belgrade'],
    ['București', 'Bucharest'],
    ['Pekin', 'Beijing'],
    // Countries
    ['Anglia', 'England'],
    ['Marea Britanie', 'Great Britain'],
    ['Regatul Unit', 'United Kingdom'],
    ['Scoția', 'Scotland'],
    ['Țara Galilor', 'Wales'],
    ['Irlanda', 'Ireland'],
    ['Franța', 'France'],
    ['Germania', 'Germany'],
    ['Spania', 'Spain'],
    ['Italia', 'Italy'],
    ['Grecia', 'Greece'],
    ['Elveția', 'Switzerland'],
    ['Olanda', 'Netherlands'],
    ['Țările de Jos', 'Netherlands'],
    ['Belgia', 'Belgium'],
    ['Danemarca', 'Denmark'],
    ['Suedia', 'Sweden'],
    ['Norvegia', 'Norway'],
    ['Finlanda', 'Finland'],
    ['Polonia', 'Poland'],
    ['Ungaria', 'Hungary'],
    ['Cehia', 'Czech Republic'],
    ['Slovacia', 'Slovakia'],
    ['Croația', 'Croatia'],
    ['Muntenegru', 'Montenegro'],
    ['Portugalia', 'Portugal'],
    ['Turcia', 'Turkey'],
    ['Egipt', 'Egypt'],
    ['Maroc', 'Morocco'],
    ['Rusia', 'Russia'],
    ['Cipru', 'Cyprus'],
    ['Islanda', 'Iceland'],
    ['Letonia', 'Latvia'],
    ['Lituania', 'Lithuania'],
    ['Statele Unite', 'United States'],
    ['Emiratele Arabe Unite', 'United Arab Emirates'],
    // Islands and regions people book
    ['Creta', 'Crete'],
    ['Rodos', 'Rhodes'],
    ['Sicilia', 'Sicily'],
    ['Insulele Canare', 'Canary Islands'],
  ],
};

// Build lookup maps once at load. forward: normalised local -> canonical.
// reverse: normalised canonical -> local display (first local wins).
const MAPS = (() => {
  const out = {};
  for (const [lang, pairs] of Object.entries(EXONYMS)) {
    const forward = new Map();
    const reverse = new Map();
    for (const [local, canonical] of pairs) {
      forward.set(normalise(local), canonical);
      const ck = normalise(canonical);
      if (!reverse.has(ck)) reverse.set(ck, local);
    }
    out[lang] = { forward, reverse };
  }
  return out;
})();

export function hasLanguage(lang) {
  return Object.prototype.hasOwnProperty.call(MAPS, langKey(lang));
}

/**
 * Resolve a typed query to the English name Travelify knows.
 * Returns { canonical, matched, via } where via is 'exact' | 'prefix' | null.
 * On no match, canonical is null and the caller should search the raw text.
 *
 * Exact match first. Then a guarded prefix match: if the letters typed so far
 * uniquely point at a single English name we resolve early (so "Lo" already
 * finds London); if they point at more than one, we do not guess.
 */
export function resolveQuery(query, lang) {
  const maps = MAPS[langKey(lang)];
  const q = normalise(query);
  if (!maps || !q) return { canonical: null, matched: false, via: null };

  if (maps.forward.has(q)) {
    return { canonical: maps.forward.get(q), matched: true, via: 'exact' };
  }

  if (q.length >= 2) {
    const canonicals = new Set();
    let sample = null;
    for (const [key, value] of maps.forward) {
      if (key.startsWith(q)) { canonicals.add(value); sample = value; }
    }
    if (canonicals.size === 1) {
      return { canonical: sample, matched: true, via: 'prefix' };
    }
  }

  return { canonical: null, matched: false, via: null };
}

/**
 * Put an English location name back into the customer's language for display.
 * Whole-string match first, then comma-separated segments (so "Heathrow, London"
 * becomes "Heathrow, Londra"). Anything with no local form is returned unchanged,
 * which is the correct display for the long tail.
 */
export function toLocal(name, lang) {
  const maps = MAPS[langKey(lang)];
  if (!maps || typeof name !== 'string' || !name) return name;

  const whole = maps.reverse.get(normalise(name));
  if (whole) return whole;

  if (name.indexOf(',') === -1) return name;

  let changed = false;
  const parts = name.split(',').map((part) => {
    const trimmed = part.trim();
    const local = maps.reverse.get(normalise(trimmed));
    if (!local) return part;
    changed = true;
    const at = part.indexOf(trimmed);
    return part.slice(0, at) + local + part.slice(at + trimmed.length);
  });
  return changed ? parts.join(',') : name;
}
