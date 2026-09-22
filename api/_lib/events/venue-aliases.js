/**
 * api/_lib/events/venue-aliases.js — decided ground identities
 *
 * The same fault as the club duplicates, one level down. Our two suppliers name
 * a ground differently and the pass keys venues on a compacted name, so one
 * stadium becomes two: San Siro and Stadio San Siro, El Sadar and Estadio El
 * Sadar, the Bernabéu with and without its "El". Venue pages split, and the
 * false clashes it produced are what made the club merges harder to decide.
 *
 * The handover has reported these as `venueAliasCandidates` since August and
 * said not to apply them automatically, because the same signal also catches a
 * genuine supplier error: one Angels fixture listed at Dodger Stadium.
 *
 * ## What separates an alias from a supplier's mistake
 *
 * Who plays there. A ground spelled two ways hosts the SAME club under both
 * spellings; a misfiled fixture puts two DIFFERENT clubs' home grounds together.
 * Across the 21 candidates that splits them cleanly:
 *
 *     Bernabéu / El Bernabéu            real-madrid both      -> one ground
 *     Cornellà-El Prat / RCDE Stadium   espanyol both         -> one ground, renamed
 *     Ghelamco Arena / Planet Group     gent both             -> one ground, renamed
 *     Angel Stadium / Dodger Stadium    Angels vs Dodgers     -> a supplier error
 *     Honda Center / United Center      Ducks vs Blackhawks   -> a supplier error
 *
 * Name overlap is the second signal, and it catches the pair whose two clubs
 * read differently (Balaídos, where one spelling is mostly the B team's). It
 * has to ignore generic words: "Centre" alone would have merged Centre Bell in
 * Montreal with the Canadian Tire Centre in Ottawa.
 *
 * ## One deliberate omission
 *
 * Estadio Benito Villamarín and Estadio de La Cartuja pass both tests, on 17
 * fixtures, and are NOT merged. They are two real stadiums in Seville. Betis
 * are playing at La Cartuja while Villamarín is rebuilt and one supplier still
 * writes the old name, which is why they look like one ground. Folding them
 * would tidy a page by claiming something untrue, so their fixtures stay split.
 *
 * 22 Sep 2026.
 */

/** variant venue key -> canonical venue key. */
export const VENUE_ALIASES = {
  // Spain
  estadiosantiagobernabeu: 'elestadiosantiagobernabeu',   // x19, real-madrid both
  estadiomunicipaldebalaidos: 'estadioabancabalaidos',    // x18, "Balaídos" in both
  estadionuevocarlostartiere: 'nuevoestadiocarlostartiere', // x17, real-oviedo both
  metropolitanostadium: 'estadiometropolitanomadrid',     // x17, atletico-madrid both
  estadidesonmoix: 'visitmallorcastadium',                // x17, mallorca both
  estadicornellaelprat: 'rcdestadium',                    // x16, espanyol both, renamed
  sanmamesstadium: 'estadiosanmames',                     // x16, athletic-bilbao both
  elsadarstadium: 'estadioelsadar',                       // ca-osasuna both
  // Italy
  sansiro: 'stadiosansiro',                               // x14, inter and milan both
  stadioatletiazzurriditalia: 'stadiodibergamo',          // x13, atalanta both, renamed
  // Belgium
  planetgrouparena: 'ghelamcoarena',                      // x8, gent both, renamed
  mauricedufrasnestadion: 'stademauricedufrasne',         // x8, standard-liege both
  // Denmark
  parken: 'teliaparken',                                  // x7, copenhagen both
  // France
  parcolympiquelyonnais: 'groupamastadium',               // lyon both, renamed
};

/**
 * Pairs the candidate list offers that must NEVER be merged, with the reason.
 *
 * Every one is a supplier filing a fixture at the wrong ground. They are
 * written down because the next person to look at the candidate list will see
 * the same rows and needs to know they were considered.
 */
export const NEVER_MERGE_VENUES = [
  ['angelstadium', 'dodgerstadium', 'Anaheim and Los Angeles. One misfiled Angels fixture.'],
  ['gatewaycenterarena', 'statefarmarena', 'The Dream and the Hawks play at different Atlanta arenas.'],
  ['centrebell', 'scotiabankarena', 'Montreal and Toronto.'],
  ['canadiantirecentre', 'scotiabankarena', 'Ottawa and Toronto.'],
  ['canadiantirecentre', 'centrebell', 'Ottawa and Montreal. Both are a "Centre", which is not evidence.'],
  ['hondacenter', 'unitedcenter', 'Anaheim and Chicago. Both are a "Center", which is not evidence.'],
  ['estadiobenitovillamarin', 'estadiodelacartuja', 'Two real stadiums in Seville. See the note above.'],
];

/** A Map, because the key looked up is derived from a feed value. */
const TABLE = new Map(Object.entries(VENUE_ALIASES));

/** The canonical key for a ground, or the key unchanged. */
export function canonicalVenueKey(key) {
  if (!key) return key;
  let cur = key;
  // Follow a chain (a -> b -> c) but never loop.
  for (let i = 0; i < 8; i++) {
    const next = TABLE.get(cur);
    if (!next || next === cur) break;
    cur = next;
  }
  return cur;
}
