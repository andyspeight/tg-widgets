/**
 * Smoke test for the Inspirator deck contract.
 *
 * Covers the pure half of the deck: level and tag validation, and the Airtable
 * formula those values are interpolated into.
 *
 * The rules being guarded, and why:
 *  - The deck formula is built by string concatenation, so the ONLY thing
 *    standing between a query string and an Airtable formula is that levels
 *    must be members of LEVEL_MAP and tags must be members of the locked
 *    32-tag vocabulary. If an unknown string can reach deckFormula, the
 *    endpoint becomes an arbitrary query against the destination base.
 *  - Every dealt card must have a photo. A swipe card is a photograph with a
 *    name on it, and 394 of 495 live resorts have no image, so without the
 *    photo clause four cards in five would be a grey box.
 *  - No tag may be a substring of another, or FIND() would match the wrong one
 *    and a "Beach" deck would quietly include something else.
 *
 * Run: node test/inspirator-deck-smoke.mjs
 */
import {
  LEVEL_MAP,
  VALID_LEVELS,
  TAG_VOCAB,
  DEFAULT_DECK_LEVELS,
  normaliseLevels,
  normaliseTags,
  deckFormula,
  toCard,
} from '../api/_lib/destination-cards.js';

let pass = 0;
const fails = [];
function ok(label, cond) { if (cond) { pass++; } else { fails.push(label); } }
function eq(label, actual, expected) {
  if (actual === expected) pass++;
  else fails.push(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

// ---- normaliseLevels -----------------------------------------------------
eq('a known level survives', normaliseLevels(['resort']).join(), 'resort');
eq('a comma string is split', normaliseLevels('resort,city').join(), 'resort,city');
eq('case and padding tolerated', normaliseLevels(' RESORT , City ').join(), 'resort,city');
eq('an unknown level is dropped', normaliseLevels(['resort', 'planet']).join(), 'resort');
eq('duplicates collapse', normaliseLevels(['city', 'city']).join(), 'city');
eq('all unknown falls back to the default', normaliseLevels(['planet']).join(), DEFAULT_DECK_LEVELS.join());
eq('an empty array falls back', normaliseLevels([]).join(), DEFAULT_DECK_LEVELS.join());
eq('undefined falls back', normaliseLevels(undefined).join(), DEFAULT_DECK_LEVELS.join());
eq('null falls back', normaliseLevels(null).join(), DEFAULT_DECK_LEVELS.join());
eq('a number falls back', normaliseLevels(42).join(), DEFAULT_DECK_LEVELS.join());
eq('every level is accepted together', normaliseLevels('country,city,resort').length, 3);
ok('the fallback is not "everything"', DEFAULT_DECK_LEVELS.length === 1);
ok('an injection attempt is dropped',
  normaliseLevels(["resort'),OR(1=1"]).join() === DEFAULT_DECK_LEVELS.join());

// ---- normaliseTags -------------------------------------------------------
eq('a known tag survives', normaliseTags(['Beach']).join(), 'Beach');
eq('a comma string is split', normaliseTags('Beach,Luxury').join(), 'Beach,Luxury');
eq('an unknown tag is dropped', normaliseTags(['Beach', 'Haunted']).join(), 'Beach');
eq('case must match exactly', normaliseTags(['beach']).join(), '');
eq('duplicates collapse', normaliseTags(['Beach', 'Beach']).join(), 'Beach');
eq('padding is trimmed', normaliseTags(' Beach , Luxury ').join(), 'Beach,Luxury');
eq('no tags is empty, not everything', normaliseTags([]).length, 0);
eq('null is empty', normaliseTags(null).length, 0);
eq('the tag list is capped', normaliseTags(Array.from(TAG_VOCAB)).length, 8);
eq('a quote injection is dropped', normaliseTags(["Beach') ,OR(1=1"]).length, 0);
eq('a formula fragment is dropped', normaliseTags(["','1')>0,FIND('"]).length, 0);
ok('a tag containing a slash still works', normaliseTags(['Eco / Sustainable']).length === 1);
ok('a tag containing a plus still works', normaliseTags(['LGBTQ+ Friendly']).length === 1);

// ---- The vocabulary itself is formula-safe --------------------------------
for (const tag of TAG_VOCAB) {
  ok(`tag "${tag}" carries no single quote`, !tag.includes("'"));
  ok(`tag "${tag}" carries no brace or paren`, !/[(){}]/.test(tag));
  ok(`tag "${tag}" carries no backslash`, !tag.includes('\\'));
}
// FIND() matches substrings, so an overlapping vocabulary would silently deal
// the wrong destinations into a filtered deck.
{
  const tags = Array.from(TAG_VOCAB);
  let overlaps = 0;
  for (const a of tags) {
    for (const b of tags) {
      if (a !== b && b.includes(a)) overlaps++;
    }
  }
  eq('no tag is a substring of another', overlaps, 0);
}

// ---- deckFormula ---------------------------------------------------------
{
  const f = deckFormula('resort', []);
  ok('the formula is an AND', f.startsWith('AND('));
  ok('the formula requires Live', f.includes("{Status}='Live'"));
  ok('the formula requires a photo', f.includes("{Image URLs}!=''"));
  ok('an unfiltered deck has no FIND clause', !f.includes('FIND('));
}
{
  const f = deckFormula('resort', ['Beach']);
  ok('one tag produces a bare FIND', f.includes("FIND('Beach',ARRAYJOIN({Best For Tags},','))>0"));
  ok('one tag needs no OR', !f.includes('OR('));
}
{
  const f = deckFormula('city', ['Beach', 'Luxury']);
  ok('two tags are OR-joined', f.includes('OR(') && f.includes("FIND('Luxury'"));
  ok('the photo clause survives a tag filter', f.includes("{Image URLs}!=''"));
  ok('the live clause survives a tag filter', f.includes("{Status}='Live'"));
}
{
  // Tags that did not come through normaliseTags must still be refused here:
  // deckFormula validates at the point of use, not on trust.
  const f = deckFormula('resort', ["Beach'),OR(1=1"]);
  ok('an unvocabularied tag never reaches the formula', !f.includes('1=1'));
  ok('and the formula degrades to unfiltered', !f.includes('FIND('));
}
eq('an unknown level yields no formula', deckFormula('planet', []), '');
eq('a null level yields no formula', deckFormula(null, []), '');
ok('a non-array tags value is tolerated', deckFormula('resort', 'Beach').startsWith('AND('));

// Every level must produce a usable formula with the same guarantees.
for (const level of VALID_LEVELS) {
  const f = deckFormula(level, ['Beach']);
  ok(`${level} formula requires Live`, f.includes("{Status}='Live'"));
  ok(`${level} formula requires a photo`, f.includes("{Image URLs}!=''"));
  ok(`${level} formula filters on the tag`, f.includes("FIND('Beach'"));
  ok(`${level} declares its filter field names`, !!LEVEL_MAP[level].filterFields.status);
  ok(`${level} declares its live status`, LEVEL_MAP[level].liveStatus === 'Live');
}

// ---- toCard tag limit ----------------------------------------------------
{
  // A deck card keeps more tags than a list row: the taste profile is inferred
  // from them, so truncating to four would bias the read towards whatever
  // Airtable happened to list first.
  const many = ['Beach', 'Luxury', 'Culture', 'Budget', 'Romance', 'Adventure'];
  const fields = {
    [LEVEL_MAP.resort.fields.name]: 'Somewhere',
    [LEVEL_MAP.resort.fields.bestForTags]: many,
  };
  eq('a deck card keeps up to eight tags', toCard('resort', 'rec00000000000001', fields, 8).tags.length, 6);
  eq('a list card still truncates to four', toCard('resort', 'rec00000000000001', fields).tags.length, 4);
}

// ---- Report --------------------------------------------------------------
if (fails.length) {
  console.error(`\n✗ inspirator-deck: ${fails.length} failed, ${pass} passed\n`);
  fails.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(`✓ inspirator-deck: ${pass} assertions passed`);
