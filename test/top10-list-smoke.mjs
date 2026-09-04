/**
 * Smoke test for the Top 10 Destinations list contract.
 *
 * Covers the pure half of the widget: reference validation, the Airtable
 * formula the references are interpolated into, card shaping, the best-months
 * derivation, and the integrity of the eight curated lists that ship with it.
 *
 * The rules being guarded, and why:
 *  - The list is a set of REFERENCES, never a snapshot. Content comes back live
 *    on every request, so a card shaped here must carry no config.
 *  - A record id reaches an Airtable formula by string interpolation. It is
 *    re-validated at that point, not just at the entry point.
 *  - Ranks close up when a reference no longer resolves, so a deleted record
 *    shortens the list rather than leaving a gap at number four.
 *  - Tags are filtered to the locked 32-tag vocabulary, so a rogue Airtable
 *    edit cannot propagate a junk tag onto a client's site.
 *
 * Run: node test/top10-list-smoke.mjs
 */
import {
  LEVEL_MAP,
  MAX_ITEMS,
  TAG_VOCAB,
  RECORD_ID_RE,
  txt,
  firstUrl,
  firstLine,
  parseBestForTags,
  bestMonthsPhrase,
  toCard,
  normaliseRefs,
  recordIdFormula,
  orderAndRank,
  PRESET_LISTS,
  findPreset,
  presetCatalogue,
} from '../api/_lib/top10-list.js';

let pass = 0;
const fails = [];
function ok(label, cond) { if (cond) { pass++; } else { fails.push(label); } }
function eq(label, actual, expected) {
  const good = actual === expected;
  if (good) pass++; else fails.push(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

const REC = 'recImleW2loMFZeJ5';   // a real Grace Bay id, shape-valid
const REC2 = 'recAAAAAAAAAAAAAA';

// ---- txt: strips markup and caps length ----------------------------------
eq('txt strips tags', txt('<b>Santorini</b>'), 'Santorini');
eq('txt strips a script tag', txt('<script>alert(1)</script>Nice'), 'alert(1)Nice');
eq('txt trims', txt('   Rome   '), 'Rome');
eq('txt caps length', txt('a'.repeat(500), 10).length, 10);
eq('txt on a non-string', txt(42), '');
eq('txt on null', txt(null), '');

// ---- URL handling: allowlist, first line only ----------------------------
eq('firstUrl takes the first valid line', firstUrl('https://a.test/1.jpg\nhttps://b.test/2.jpg'), 'https://a.test/1.jpg');
eq('firstUrl skips a blank first line', firstUrl('\n  \nhttps://c.test/3.jpg'), 'https://c.test/3.jpg');
eq('firstUrl rejects javascript:', firstUrl('javascript:alert(1)'), '');
eq('firstUrl rejects data:', firstUrl('data:text/html,<script>'), '');
eq('firstUrl rejects a bare path', firstUrl('/images/x.jpg'), '');
eq('firstUrl on a non-string', firstUrl(null), '');
eq('firstLine takes line one', firstLine('Ana Photo\nBen Photo'), 'Ana Photo');
eq('firstLine strips markup', firstLine('<i>Ana</i>'), 'Ana');

// ---- Tag vocabulary ------------------------------------------------------
eq('vocabulary is 32 tags', TAG_VOCAB.size, 32);
ok('known tags pass', parseBestForTags(['Beach', 'Luxury']).length === 2);
ok('unknown tags are dropped', parseBestForTags(['Beach', 'Haunted', '<img>']).length === 1);
ok('select objects are unwrapped', parseBestForTags([{ id: 's1', name: 'Beach' }]).length === 1);
ok('tags are capped at four', parseBestForTags(['Beach', 'Luxury', 'Culture', 'Budget', 'Romance']).length === 4);
ok('a non-array yields none', parseBestForTags('Beach').length === 0);
ok('null yields none', parseBestForTags(null).length === 0);

// ---- Best months ---------------------------------------------------------
eq('a summer run', bestMonthsPhrase('off,off,off,shoulder,best,best,best,best,best,shoulder,off,off'), 'May to Sep');
eq('a winter run wraps the year end', bestMonthsPhrase('best,best,best,off,off,off,off,off,off,off,best,best'), 'Nov to Mar');
eq('all twelve is year round', bestMonthsPhrase(Array(12).fill('best').join(',')), 'Year round');
eq('a single best month', bestMonthsPhrase('off,off,off,off,off,off,best,off,off,off,off,off'), 'Jul');
eq('scattered months are listed, not ranged',
  bestMonthsPhrase('best,off,best,off,best,off,off,off,off,off,off,off'), 'Jan, Mar, May');
eq('no best month', bestMonthsPhrase(Array(12).fill('off').join(',')), '');
eq('wrong token count', bestMonthsPhrase('best,best,best'), '');
eq('a non-string', bestMonthsPhrase(null), '');
eq('padding and case tolerated',
  bestMonthsPhrase(' OFF , off,off,off, BEST ,best,best,off,off,off,off,off'), 'May to Jul');

// ---- toCard --------------------------------------------------------------
const resortFields = {
  [LEVEL_MAP.resort.fields.name]: 'Grace Bay',
  [LEVEL_MAP.resort.fields.slug]: 'grace-bay',
  [LEVEL_MAP.resort.fields.tagline]: 'Three miles of powder sand.',
  [LEVEL_MAP.resort.fields.region]: 'Turks & Caicos',
  [LEVEL_MAP.resort.fields.images]: 'https://img.test/gb.jpg\nhttps://img.test/gb2.jpg',
  [LEVEL_MAP.resort.fields.attributions]: 'Ana Photo\nBen Photo',
  [LEVEL_MAP.resort.fields.bestForTags]: ['Beach', 'Luxury', 'Nope'],
  [LEVEL_MAP.resort.fields.flightTime]: '9h 40m',
  [LEVEL_MAP.resort.fields.climateSeason]: 'best,best,best,best,off,off,off,off,off,off,best,best',
};
const card = toCard('resort', REC, resortFields);
eq('card name', card.name, 'Grace Bay');
eq('card slug', card.slug, 'grace-bay');
eq('card region', card.region, 'Turks & Caicos');
eq('card image is the first', card.image, 'https://img.test/gb.jpg');
eq('card credit is the first', card.attribution, 'Ana Photo');
eq('card drops the junk tag', card.tags.length, 2);
eq('card flight time', card.flightTime, '9h 40m');
eq('card best months wrap', card.bestMonths, 'Nov to Apr');
eq('card carries its level', card.level, 'resort');
eq('card carries its id', card.recordId, REC);
ok('card has no rank of its own', card.rank === undefined);
ok('an unknown level yields no card', toCard('planet', REC, resortFields) === null);
ok('an empty record still shapes', toCard('city', REC, {}).name === '');

// ---- normaliseRefs -------------------------------------------------------
eq('a good reference survives', normaliseRefs([{ level: 'resort', recordId: REC }]).length, 1);
eq('level is lowercased', normaliseRefs([{ level: 'RESORT', recordId: REC }])[0].level, 'resort');
eq('an unknown level is dropped', normaliseRefs([{ level: 'planet', recordId: REC }]).length, 0);
eq('a bad record id is dropped', normaliseRefs([{ level: 'resort', recordId: 'not-a-record' }]).length, 0);
eq('an injection attempt is dropped',
  normaliseRefs([{ level: 'resort', recordId: "rec'),OR(1=1" }]).length, 0);
eq('duplicates collapse', normaliseRefs([
  { level: 'resort', recordId: REC }, { level: 'resort', recordId: REC },
]).length, 1);
eq('the same id at two levels is kept', normaliseRefs([
  { level: 'resort', recordId: REC }, { level: 'city', recordId: REC },
]).length, 2);
eq('the list is capped', normaliseRefs(
  Array.from({ length: 40 }, (_, i) => ({ level: 'resort', recordId: 'rec' + String(i).padStart(14, '0') }))
).length, MAX_ITEMS);
eq('a non-array yields none', normaliseRefs('nope').length, 0);
eq('null entries are skipped', normaliseRefs([null, undefined, { level: 'resort', recordId: REC }]).length, 1);
eq('refs carry only level and id', Object.keys(normaliseRefs([
  { level: 'resort', recordId: REC, evil: '<script>', name: 'x' },
])[0]).sort().join(','), 'level,recordId');

// ---- recordIdFormula -----------------------------------------------------
eq('a single id needs no OR', recordIdFormula([REC]), `RECORD_ID()='${REC}'`);
ok('two ids are OR-joined', recordIdFormula([REC, REC2]) === `OR(RECORD_ID()='${REC}',RECORD_ID()='${REC2}')`);
eq('an empty set yields no formula', recordIdFormula([]), '');
eq('a non-array yields no formula', recordIdFormula(null), '');
eq('an unsafe id is filtered at the point of use', recordIdFormula(["rec'),OR(1=1"]), '');
eq('an unsafe id among good ones is filtered',
  recordIdFormula([REC, "'; DROP"]), `RECORD_ID()='${REC}'`);
ok('no formula can contain a quote outside our own',
  !recordIdFormula([REC, REC2]).includes("''"));

// ---- orderAndRank --------------------------------------------------------
const found = new Map([
  [`resort:${REC}`, { level: 'resort', recordId: REC, name: 'Grace Bay' }],
  [`resort:${REC2}`, { level: 'resort', recordId: REC2, name: 'Le Morne' }],
]);
const ordered = orderAndRank([
  { level: 'resort', recordId: REC2 },
  { level: 'resort', recordId: REC },
], found);
eq('order follows the request, not Airtable', ordered[0].name, 'Le Morne');
eq('ranks start at one', ordered[0].rank, 1);
eq('ranks increment', ordered[1].rank, 2);

const withGap = orderAndRank([
  { level: 'resort', recordId: REC2 },
  { level: 'resort', recordId: 'recZZZZZZZZZZZZZZ' },   // never resolves
  { level: 'resort', recordId: REC },
], found);
eq('an unresolved reference is dropped', withGap.length, 2);
eq('ranks close up rather than leaving a gap', withGap[1].rank, 2);
eq('the survivor after the gap is right', withGap[1].name, 'Grace Bay');
eq('nothing found yields nothing', orderAndRank([{ level: 'city', recordId: REC }], found).length, 0);
eq('no refs yields nothing', orderAndRank([], found).length, 0);

// ---- The curated lists that ship -----------------------------------------
eq('eight curated lists ship', PRESET_LISTS.length, 8);
const ids = new Set();
for (const list of PRESET_LISTS) {
  const tag = `preset ${list.id}`;
  ok(`${tag} has a slug-shaped id`, /^[a-z0-9-]{1,40}$/.test(list.id));
  ok(`${tag} id is unique`, !ids.has(list.id));
  ids.add(list.id);
  ok(`${tag} has a title`, typeof list.title === 'string' && list.title.length > 3);
  ok(`${tag} has a subtitle`, typeof list.subtitle === 'string' && list.subtitle.length > 10);
  ok(`${tag} has a known level`, Boolean(LEVEL_MAP[list.level]));
  ok(`${tag} is exactly ten`, Array.isArray(list.items) && list.items.length === 10);
  ok(`${tag} survives validation intact`, normaliseRefs(list.items).length === 10);
  ok(`${tag} entries all sit at the list's level`, list.items.every(i => i.level === list.level));
  ok(`${tag} entries have valid record ids`, list.items.every(i => RECORD_ID_RE.test(i.recordId)));
  ok(`${tag} entries have a slug`, list.items.every(i => typeof i.slug === 'string' && i.slug.length > 0));
  ok(`${tag} entries are distinct`, new Set(list.items.map(i => i.recordId)).size === 10);
  // House style: no em dashes in anything a visitor reads.
  ok(`${tag} title has no em dash`, !list.title.includes('—'));
  ok(`${tag} subtitle has no em dash`, !list.subtitle.includes('—'));
}

// ---- findPreset / catalogue ----------------------------------------------
ok('a known preset resolves', findPreset('beach-escapes') !== null);
ok('an unknown preset does not', findPreset('does-not-exist') === null);
ok('a path-shaped id is rejected', findPreset('../../etc/passwd') === null);
ok('an id with a quote is rejected', findPreset("beach' OR '1") === null);
ok('a non-string is rejected', findPreset(null) === null);
const cat = presetCatalogue();
eq('the catalogue lists every preset', cat.length, PRESET_LISTS.length);
ok('the catalogue counts entries', cat.every(c => c.count === 10));
ok('the catalogue leaks no record ids', !JSON.stringify(cat).includes('rec'));

// ---- Field map integrity -------------------------------------------------
for (const [level, map] of Object.entries(LEVEL_MAP)) {
  ok(`${level} has a table id`, /^tbl[A-Za-z0-9]{14}$/.test(map.tableId));
  ok(`${level} field ids are well formed`,
    Object.values(map.fields).every(f => /^fld[A-Za-z0-9]{14}$/.test(f)));
  ok(`${level} carries every card field`,
    ['name', 'slug', 'tagline', 'region', 'images', 'attributions', 'bestForTags', 'flightTime', 'climateSeason']
      .every(k => typeof map.fields[k] === 'string'));
}
ok('the three levels have distinct tables',
  new Set(Object.values(LEVEL_MAP).map(m => m.tableId)).size === 3);
ok('LEVEL_MAP is frozen', Object.isFrozen(LEVEL_MAP));

// ---- Report --------------------------------------------------------------
if (fails.length) {
  console.error(`\n✗ top10-list: ${fails.length} failed, ${pass} passed\n`);
  fails.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(`✓ top10-list: ${pass} assertions passed`);
