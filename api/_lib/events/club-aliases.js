/**
 * api/_lib/events/club-aliases.js — decided club identities
 *
 * The normalise pass folds a club the feed spells two ways only when one key
 * is a PREFIX of the other and the extra words are club-type noise ("Ipswich"
 * / "Ipswich Town"). That is safe, and it is narrow. It never sees:
 *
 *     Sporting CP          / Sporting Club Portugal (Lisbon)
 *     Paris SG             / Paris Saint-Germain
 *     Lille LOSC           / Lille OSC
 *     Lyon                 / Olympique Lyonnais
 *     Troyes               / Estac Troyes
 *     Real Sporting de Gijón / Sporting de Gijon
 *
 * so it reported 17 candidates while a client counted 23 clubs in an 18-club
 * Primeira and 24 in an 18-club Ligue 1 (22 Sep 2026, via Andy). Every pair has
 * the same fingerprint: one entry with a full season of fixtures and one with
 * three or four, which is our second supplier spelling the same league its own
 * way.
 *
 * ## How these were decided, and why not by the prefix rule alone
 *
 * A club cannot be at two grounds on one day. So for a candidate pair, take
 * every date both appear on and compare the VENUE:
 *
 *     agree > clash -> one club, spelled twice
 *     clash > agree -> two clubs that happen to share a word
 *
 * It has to be the venue and not the opponent. Where a league is duplicated the
 * opponent is duplicated too, so "Paris SG v Troyes" and "Paris Saint-Germain v
 * Estac Troyes" read as a disagreement when they are one match. Comparing
 * opponents said PSG and Paris Saint-Germain were different clubs, which is how
 * that trap announces itself.
 *
 * A clash is not fatal on its own, because the venue registry still carries
 * unapplied aliases: Groupama Stadium and the Parc Olympique Lyonnais are one
 * ground, as are Telia Parken and Parken. Those produce a handful of false
 * clashes against many agreements. Two genuinely different clubs clash on
 * nearly every shared date (Dundee and Dundee United: 25 of 25).
 *
 * That settles most of them. A handful are recorded here from knowledge of the
 * clubs instead, because the feed gives too little to decide them either way,
 * and each of those says so in its comment.
 *
 * Applied to the 21 Aug 2026 snapshot, the table folds 35 duplicate spellings
 * and 178 double-listed matches, and takes thirteen of the fourteen leagues
 * worth checking to exactly the club count they should have. Belgium is left
 * two over: the feed spans two seasons, so a promoted and a relegated club can
 * both appear, and that is not the same fault.
 *
 * The table is written per competition because that is where each pair was
 * DECIDED: inside one league, two spellings of one name is a fact, and across
 * the whole feed it would be a guess. It is APPLIED everywhere, because a club
 * is the same club wherever it plays. Scoping the application too left Sporting
 * alive as a second club on the strength of one Taça da Liga fixture.
 *
 * 22 Sep 2026.
 */

/**
 * variant key -> canonical key, per competition.
 *
 * `ok`/`x` in a comment is the venue evidence: dates where both sides played at
 * the same ground, against dates where they did not. A pair with no counts was
 * decided by hand and says on what.
 */
export const CLUB_ALIASES = {
  'belgian-pro-league': {
    beveren: 'ksk-beveren',                        // 4ok 3x
    genk: 'krc-genk',                              // 17ok 3x
    leuven: 'oud-heverlee-leuven',                 // 5ok 2x
    antwerp: 'royal-antwerp',                      // 17ok 3x
    'union-st-gilloise': 'royale-union-st-gilloise', // 5ok 3x
    'st-truiden': 'sint-truidense-vv',             // the Dutch name of the same club
  },
  'danish-superliga': {
    // 0ok 1x, and the single clash is Telia Parken against Parken, which are
    // one ground. AGF are Aarhus; Viborg FF are Viborg.
    aarhus: 'agf-aarhus',
    viborg: 'viborg-ff',
  },
  'dutch-eredivisie': {
    excelsior: 'excelsior-rotterdam',              // 1ok 0x
    // 0ok 0x: the short spelling has one fixture and it is an away game, so
    // there is nothing to compare. SC Cambuur play in Leeuwarden.
    cambuur: 'cambuur-leeuwarden',
  },
  'austrian-bundesliga': {
    // 0ok 0x. RZ Pellets is a sponsor's name on Wolfsberger AC.
    wolfsberger: 'rz-pellets-wolfsberger',
    'rapid-vienna': 'rapid-wien',                  // 1ok 0x — the English spelling
  },
  'french-ligue-1': {
    auxerre: 'aj-auxerre',                         // 2ok 0x
    angers: 'angers-sco',                          // 2ok 1x
    'lille-osc': 'lille-losc',                     // 2ok 1x
    'paris-st-germain': 'paris-sg',                // 15ok 0x
    'estac-troyes': 'troyes',                      // 2ok 1x
    // 1ok 14x, and every one of those 14 is Groupama Stadium against the Parc
    // Olympique Lyonnais: the same ground, renamed. Merged on that basis.
    'olympique-lyonnais': 'lyon',
  },
  'german-bundesliga': {
    'fsv-mainz-05': 'fsv-mainz',                   // 4ok 0x
    hamburger: 'hamburg',                          // 4ok 0x
    'paderborn-07': 'paderborn',                   // 4ok 0x
    'bayern-munchen': 'bayern-munich',             // 4ok 0x — the German spelling
  },
  'italian-serie-a': {
    fiorentina: 'acf-fiorentina',                  // 4ok 3x
    genoa: 'genoa-cfc',                            // 5ok 3x
    'lazio-roma': 'lazio',                         // 22ok 3x — Lazio, NOT Roma
    lecce: 'us-lecce',                             // 5ok 3x
    // 5ok 21x, and all 21 are San Siro against Stadio San Siro: one ground,
    // and already a known venue alias the venue table has not had applied.
    internazionale: 'inter',
  },
  'portuguese-primeira': {
    'casa-pia-atletico-clube': 'casa-pia',         // 4ok 0x
    'estoril-praia': 'estoril',                    // 2ok 0x
    'estrela-da-amadora': 'estrela-amadora',       // 4ok 0x
    'sporting-portugal': 'sporting-cp',            // 18ok 0x
    // 1ok 1x, which decides nothing, and the clash is Morumbi against the Luz.
    // That is the CLUB_SPLITS entry below showing through rather than evidence
    // of two Portuguese clubs: Vitória SC are Guimarães either way.
    'vitoria-guimaraes': 'vitoria',
  },
  'spanish-la-liga': {
    // 4ok 24x, and every one of the 24 is El Sadar Stadium against Estadio El
    // Sadar. One ground, two spellings, same club.
    osasuna: 'ca-osasuna',
  },
  'spanish-segunda': {
    'sporting-gijon': 'real-sporting-gijon',       // 23ok 2x
    'ce-sabadell': 'sabadell',                     // 6ok 2x
  },
};

/**
 * The name a merged club is SHOWN under.
 *
 * Folding two spellings into one key does not decide which spelling a visitor
 * reads. The registry picks whichever the feed uses most, so the winner changes
 * with the supplier's row counts: on 22 Sep 2026 a refresh renamed Sporting CP
 * to "Sporting Club Portugal (Lisbon)" and fixtures started reading "RC Lens vs
 * Sporting Club Portugal (Lisbon)". Thirteen merged clubs sit in that position,
 * so any week's update could rename a client's own team.
 *
 * Pinning the name here makes it stop moving. The other spelling is still kept
 * as an alias, so searching for it still finds the club.
 *
 * These are the cleaner of the two spellings the feed already uses. This table
 * is not for renaming clubs to taste: the rule is to choose between what the
 * suppliers actually send, not to invent a third name.
 */
export const CLUB_NAMES = {
  'casa-pia': 'Casa Pia',
  estoril: 'Estoril',
  'estrela-amadora': 'Estrela Amadora',
  'sporting-cp': 'Sporting CP',
  vitoria: 'Vitória SC',
  // Paris SG reads too much like Paris FC, which is a different club in the
  // same league, so the unambiguous spelling wins here.
  'paris-sg': 'Paris Saint-Germain',
  troyes: 'Troyes',
  lyon: 'Lyon',
  'lille-losc': 'Lille LOSC',
  'fsv-mainz': 'FSV Mainz 05',
  paderborn: 'SC Paderborn',
  lazio: 'SS Lazio',
  inter: 'Inter',
  sabadell: 'Sabadell',
};

/** A Map, because the key looked up comes from the feed. */
const NAME_TABLE = new Map(Object.entries(CLUB_NAMES));

/** The pinned display name for a club, or '' to let the feed decide. */
export function pinnedClubName(key) {
  if (!key) return '';
  const n = NAME_TABLE.get(key);
  return typeof n === 'string' ? n : '';
}

/**
 * The opposite problem: one key holding two real clubs.
 *
 * A team key comes from the name with club words stripped, and nothing in it
 * says which country. So Vitória SC of Guimarães and Esporte Clube Vitória of
 * Salvador both reduce to `vitoria` and the pass filed 32 Portuguese fixtures
 * and 4 Brazilian ones under one club. Merging the Portuguese spellings without
 * this would have made that worse rather than better.
 *
 * Read as: in these competitions, this key is a different club, so re-key it.
 * A sweep of the whole snapshot found this is the only such collision, so the
 * table is deliberately a list of known cases rather than a general rule.
 */
export const CLUB_SPLITS = {
  vitoria: [
    { competitions: ['brazilian-serie-a', 'copa-do-brasil'], key: 'vitoria-salvador', name: 'EC Vitória' },
  ],
};

/**
 * Pairs that look mergeable and must never be merged, with the reason.
 *
 * These sit in exactly the shape the prefix rule and the venue test look at, so
 * without writing them down someone reasonable re-adds them later. The venue
 * test already rejects every one of them; this is the belt to that brace, and
 * it is what `npm run test:event-club-aliases` checks.
 */
export const NEVER_MERGE = [
  ['dundee', 'dundee-united', 'Two Dundee clubs. Dens Park and Tannadice, 25 of 25 shared dates apart.'],
  ['paris', 'paris-sg', 'Paris FC and Paris Saint-Germain. Stade Jean-Bouin and the Parc des Princes.'],
  ['paris', 'paris-st-germain', 'As above, against the other PSG spelling.'],
  ['gimnasia', 'gimnasia-mendoza', 'Argentina has several Gimnasia clubs.'],
  ['gimnasia', 'gimnasia-la-plata', 'As above.'],
  ['los-angeles', 'los-angeles-galaxy', 'LAFC and the LA Galaxy. 7 of 8 shared dates apart.'],
  ['roma', 'lazio-roma', 'Lazio Roma is Lazio. Roma are the other club in the city.'],
  ['zurich', 'grasshoppers-zurich', 'FC Zurich and Grasshoppers. 12 shared dates apart.'],
  ['real-madrid', 'atletico-madrid', 'Two Madrid clubs. 33 shared dates apart.'],
  ['new-york-red-bulls', 'new-york-city', 'Red Bulls and NYCFC.'],
  ['atletico-independiente', 'independiente-rivadavia', 'Independiente and Independiente Rivadavia.'],
  ['beveren', 'waasland-beveren', 'Kept apart until a season of fixtures decides it.'],
];

/** Every alias in the table, flattened to `competition\u0000variant` -> canonical. */
export function aliasLookup() {
  const out = new Map();
  for (const [comp, pairs] of Object.entries(CLUB_ALIASES)) {
    for (const [variant, canonical] of Object.entries(pairs)) out.set(`${comp}\u0000${variant}`, canonical);
  }
  return out;
}

/**
 * Every alias again, ignoring the competition.
 *
 * The table is written per competition because that is where each pair was
 * DECIDED: inside one league, two spellings of one name is a fact, and across
 * the whole feed it would be a guess. Applying it is a different question. A
 * club is the same club wherever it plays, so once "Sporting Club Portugal is
 * Sporting CP" has been settled in the Primeira it is just as true in the Taça
 * da Liga, and scoping the application left one stray fixture keeping the old
 * spelling alive as its own club in every picker.
 *
 * This is only safe while no variant points at two different clubs and no key
 * is both a variant and a canonical. Both are checked by
 * `npm run test:event-club-aliases`, so a future entry that breaks either one
 * fails rather than quietly folding the wrong pair.
 *
 * A key that means two real clubs in different countries is the CLUB_SPLITS
 * case, and splits run before aliases for exactly that reason.
 */
function globalLookup(table) {
  const out = new Map();
  for (const [composite, canonical] of table) out.set(composite.split('\u0000')[1], canonical);
  return out;
}
let GLOBAL_CACHE = null;

/** The canonical key for one club, or the key unchanged. */
export function canonicalClubKey(competition, key, lookup) {
  if (!key) return key;
  const table = lookup || aliasLookup();
  const global = (table === GLOBAL_CACHE?.from) ? GLOBAL_CACHE.map : globalLookup(table);
  GLOBAL_CACHE = { from: table, map: global };
  let cur = key;
  // Follow a chain (a -> b -> c) but never loop.
  for (let i = 0; i < 8; i++) {
    const next = (competition && table.get(`${competition}\u0000${cur}`)) || global.get(cur);
    if (!next || next === cur) break;
    cur = next;
  }
  return cur;
}

// A Map, not the object, because the key being looked up comes from the feed.
// `CLUB_SPLITS['constructor']` hands back a function off Object.prototype and
// the caller then iterates it, which is how the existing suite found this the
// moment it ran. The same rule is already written into the normalise pass: any
// lookup on data goes through a Map.
const SPLIT_TABLE = new Map(Object.entries(CLUB_SPLITS));

/** The re-keyed club for a split, or null when this key is not split here. */
export function splitClub(competition, key) {
  if (!competition || !key) return null;
  const rules = SPLIT_TABLE.get(key);
  if (!Array.isArray(rules)) return null;
  for (const r of rules) if (r.competitions.includes(competition)) return r;
  return null;
}
