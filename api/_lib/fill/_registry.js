/**
 * What kind of work does each gap actually need?
 *
 * Andy's instruction (10 Sep 2026): the dashboard should fill the gaps and
 * correct the issues on a button press, per record and in bulk. That only works
 * if the runner knows that "gap" is three different problems wearing one word.
 *
 *   derive  — the answer is already in the database. A URL slug is the name
 *             lower-cased; a resort's currency is its country's currency. No
 *             research, no model, no cost, and it cannot be wrong. Roughly a
 *             fifth of the library's gaps are this, and every one of them was
 *             being counted as work.
 *
 *   fact    — a checkable quantity. Twelve monthly temperatures, a coordinate,
 *             an IATA code. Two INDEPENDENT sources have to agree or it is
 *             held: Open-Meteo against NASA POWER, OurAirports against
 *             Wikidata. Cheap (open data, not model calls) and it can never
 *             invent, because a single source is a hold, not an answer.
 *
 *   write   — editorial. An overview, a tagline, a set of highlight cards.
 *             There is no second source for a sentence, so this is where the
 *             model writes and where the gate earns its keep. This is also
 *             where the money goes.
 *
 *   manual  — a person has to decide. Photography, and the tags that say who a
 *             place suits, are judgement calls we do not fake.
 *
 * The order matters: derive before fact before write. Every derived value gives
 * the writer more context and one less thing to invent, so running them in that
 * order makes the expensive step both cheaper and better grounded.
 */

import { hasAirportFixer } from './_source.js';
import { estimateFieldUsd } from './_model.js';

/**
 * Which types have somewhere to inherit FROM.
 *
 * A resort sits in a city, a city sits in a country. A country sits at the top,
 * and airports and attractions carry no parent link at all. So "inherit it from
 * the country" is not a plan for those three, it is a guaranteed hold.
 *
 * 14 Sep 2026: Andy pressed Flight Time From UK on countries and all three were
 * held saying "no parent record holds this yet". They never could have been
 * anything else. Same bug as the FACT one, one layer along: a field's plan
 * depends on the TYPE it is on, not only on its name.
 */
const INHERITS_FROM_ABOVE = new Set(['city', 'resort']);

/** Fields whose value is already in the database, and where to get it. */
const DERIVE = {
  // Computed from the record's own name.
  'URL Slug': { from: 'slug' },
  // Inherited from the parent country (a resort is in its country's time zone).
  'Time Zone': { from: 'country' },
  'Currency': { from: 'country' },
  'Language': { from: 'country' },
  'Voltage And Plug': { from: 'country' },
  // Inherited from whichever ancestor has it.
  'Flight Time From UK': { from: 'parent' },
};

/** Fields two independent sources can settle. */
const FACT = {
  'Climate Temps': { via: 'climate' },
  'Climate Rainfall': { via: 'climate' },
  'Climate Season': { via: 'climate' },
  'Latitude': { via: 'geo' },
  'Longitude': { via: 'geo' },
  'Lat': { via: 'geo' },
  'Lng': { via: 'geo' },
  'IATA Code': { via: 'airport' },
  'City Served': { via: 'airport' },
  'Country Text': { via: 'airport' },
  'Official Website': { via: 'source' },
  'Wikipedia URL': { via: 'source' },
  'Source 1 URL': { via: 'source' },
  'Source 2 URL': { via: 'source' },
  'Verified Date': { via: 'stamp' },
};

/** Fields we will not guess at. */
const MANUAL = new Set([
  // REGION IS NOT INHERITED, WHICH IS HOW IT LOOKED AND IS NOT WHAT IT IS.
  // It was set to come down from the parent. Andy asked on 14 Sep 2026 why a
  // country would need a region at all, and checking the records that already
  // have one settled it. The same place reads three different ways:
  //
  //   country  French Polynesia   South Pacific · Polynesia
  //   city     Bora Bora          Society Islands · South Pacific
  //   resort   on Bora Bora       Bora Bora · Society Islands
  //
  // It is a breadcrumb of where THIS record sits, and it shifts at every level.
  // Handing a country's value down would have written "South Pacific ·
  // Polynesia" onto 279 cities and 483 resorts, which is coarse at city level
  // and simply wrong at resort level. Blank is recoverable. Filled and wrong
  // looks finished, and nobody goes back to it.
  'Region',
  'Image URLs',           // photography is chosen, not generated
  'Image Attribution',    // follows the photograph
  'Hero Image URL',
  'Best For Tags',        // audience fit is Andy's call, not a model's
  'Who Is It Best For',
  'Best Paired With (Countries)',
  'Best Paired With (Cities)',
  'Best Paired With (Resorts)',
]);

/**
 * Per-field briefs for the writer. Most fields need nothing here: the label,
 * the group and the hint already say what they are. These are the ones with a
 * shape that has to be exact, where a good sentence in the wrong format is
 * still a failure.
 */
const BRIEF = {
  'Tagline':
    'One evocative line of 40 to 70 characters. Never use the place name. No full stop. ' +
    'Editorial, in the register of a good travel magazine, not sales copy. ' +
    // 11 Sep 2026: asked to be evocative, it reached for a poetic specific the
    // facts did not carry. Serbia got "medieval stone" when the only site in
    // evidence is Roman, and the grounding check rightly refused it. Evoke what
    // is there.
    'Build the image ONLY from the facts you are given, and name nothing they do not. ' +
    'If the facts are thin, evoke the general character rather than inventing a detail.',
  'Hero Intro':
    'Two or three sentences that open the page. Concrete and specific to this place. ' +
    'No throat-clearing and no "nestled".',
  'Overview':
    '150 to 200 words. What the place actually is, who goes and why, what it feels like. ' +
    'Specific detail beats adjectives.',
  'Highlights JSON':
    'A JSON array of 3 to 6 objects, each {"icon","title","description"}. Icon must be one of: ' +
    'mountain, sunset, wine, water, palm, city, temple, beach, food, star, camera, heart, ' +
    'building, map, compass, sun, snowflake. Title is 2 to 4 words. Description is 25 to 40 ' +
    'words and names something real. Output the JSON array and nothing else.',
  'Events JSON':
    'A JSON array of 1 to 6 objects, each {"month","name","description"}. Month is a short name ' +
    '(Jan, Feb) or a range (May-Sep). Description is 15 to 25 words. Only genuine annual events ' +
    'you are confident exist. An empty array is better than an invented festival. ' +
    'Output the JSON array and nothing else.',
  'SEO Meta Title': 'At most 60 characters including the place name. No pipes stacked with keywords.',
  'SEO Meta Description': 'At most 155 characters. A reason to click, not a keyword list.',
  'Best Time to Visit': 'Month by month where it matters. Name the trade-offs, including the bad months.',
  'Top Things to Do': '5 to 8 highlights in prose, each named specifically. No numbered list.',
  'Food and Drink': 'What to actually eat and drink here, named. Local, not generic.',
  'Getting There': 'From the UK. Airports, typical flight time, transfer.',
  'Practical Info': 'Currency, language, time zone, visas for UK travellers, plugs.',
  'Character and Vibe': 'Beach or town, lively or quiet, modern or traditional. Be willing to say who would not enjoy it.',
  'Beaches': 'The beaches by name, what the sand and water are like, facilities.',
  'Getting Around': 'Walkability, local transport, whether a car is needed.',
  'Nearby Excursions': 'Day trips worth the journey, with rough travel times.',
  'What Makes It Special': 'The one thing that would make someone choose here over the next place along the coast.',
};

/**
 * The format a field's brief promises, enforced rather than hoped for.
 *
 * A Tagline is a text field, and "filled" for a text field means non-empty, so
 * nothing stopped a two-hundred-character tagline saving itself into a slot
 * that sits beside the place name on a client site. If the brief states a
 * shape, the gate checks it: telling a model a rule and not enforcing it is
 * the same as having no rule.
 */
const FORMAT = {
  'Tagline': { min: 40, max: 70, noTrailingStop: true, noPlaceName: true },
  'SEO Meta Title': { max: 60 },
  'SEO Meta Description': { max: 155 },
};

export function formatFor(label) { return FORMAT[label] || null; }

/** Fields the runner must never touch, whatever their state. */
const NEVER = new Set(['Status']);

/**
 * THE ALLOW-LIST. A field is written by a model ONLY if it is named here.
 *
 * This used to be the default, and that was the single worst decision in this
 * runner. On 11 Sep 2026 Andy ran Terminals & Airlines over 375 airports, twice.
 * Every item was held, $4.14 was spent, and nothing was written. The field asks
 * which terminal each airline flies from. That is an operational fact about a
 * named airport, and we hold no source for it, so the writer either refused or
 * invented and the gate refused for it. Correct behaviour, two hours late and
 * four dollars in.
 *
 * The same trap was sitting under Parking, Lounges, Drop-off & Pick-up,
 * Special Assistance, Recommended Arrival Time, Getting There By Train and a
 * dozen more: all facts, all defaulting to "a model writes it".
 *
 * So the default is now closed, like every other decision in this system. What
 * belongs here is INTERPRETATION of facts we already hold, never a new fact.
 * If filling a field correctly would require looking something up, it does not
 * belong here however well a model could fake it.
 */
const WRITE = new Set([
  'Overview',                 // what the place is, from what we hold about it
  'Tagline',
  'Hero Intro',
  'Character and Vibe',
  'What Makes It Special',
  'Highlights JSON',
  'SEO Meta Title',
  'SEO Meta Description',
]);

/**
 * Which two-source fixers are actually BUILT, per content type.
 *
 * A fact with no fixer is not work the runner can do, and calling it 'fact'
 * anyway is how 498 airports got queued for Official Website on 10 Sep and held
 * every one. So the question is never "could two sources settle this in
 * principle" but "can we settle it today".
 *
 * airports  OurAirports against Wikidata, keyed on the IATA code the record
 *           already carries. Built, and measured. See _source.js.
 * climate   Open-Meteo against NASA POWER. The engine exists as a whole-table
 *           batch job and is not wired to the queue.
 * anything
 * else      a city or a resort has no IATA code, so neither source can be
 *           looked up for it at all.
 */
function fixerExists(label, typeKey) {
  return typeKey === 'airport' && hasAirportFixer(label);
}

/**
 * Classify one field.
 *
 * The content type matters: Latitude on an airport is two open datasets away,
 * and Latitude on a resort is a research job nobody has automated.
 *
 * @returns {{kind:'derive'|'fact'|'write'|'source'|'manual', how?:object, brief?:string}}
 */
/**
 * Where the two sources we hold cannot settle the question, however well the
 * fixer is written. This is not "not built yet". It is a different answer, and
 * saying so saves Andy pressing a button that can only ever hold.
 *
 * City Served on an airport is the case that taught us. OurAirports records the
 * city an airport SERVES and Wikidata's P131 records the district it SITS IN,
 * and for any airport worth flying to those differ: Dublin sits in Fingal,
 * Vienna in Schwechat, Rome in Fiumicino, Stockholm Arlanda in Sigtuna. Measured
 * on 14 Sep 2026 against 100 of Andy's own blank records, the agreement rate was
 * zero, so the job would have produced 362 holds and nothing else.
 */
const NO_SECOND_SOURCE = {
  'airport:City Served':
    'the two sources answer different questions here, one naming the city an airport '
    + 'serves and the other the district it stands in, so Dublin reads as Fingal and '
    + 'Rome as Fiumicino. This one needs a person or a third source',
};

/**
 * Fields whose plan depends on the level they sit on rather than the name.
 *
 * A resort's region is built from its city (see _derive.js). A city's and a
 * country's are not built from anything we hold: the city half needs the
 * sub-national area, which no record carries, and a country sits at the top.
 * Those stay manual, which is why Region is still in MANUAL below.
 */
const BY_TYPE = {
  'resort:Region': { kind: 'derive', how: { from: 'regionCrumb' } },
};

export function fillPlanFor(field, typeKey) {
  const label = field && field.label;
  if (!label || NEVER.has(label)) return { kind: 'manual', why: 'not a field the runner writes' };
  const byType = BY_TYPE[typeKey + ':' + label];
  if (byType) return byType;
  if (MANUAL.has(label)) return { kind: 'manual', why: 'a person chooses this' };
  if (DERIVE[label]) {
    const how = DERIVE[label];
    // Computed from the record's own name, so it works anywhere.
    if (how.from === 'slug') return { kind: 'derive', how };
    // Everything else is inheritance, and inheritance needs an ancestor.
    if (typeKey && !INHERITS_FROM_ABOVE.has(typeKey)) {
      return {
        kind: 'source',
        why: 'a ' + typeKey + ' has no parent record to inherit this from, so it needs a source',
      };
    }
    return { kind: 'derive', how };
  }
  if (FACT[label]) {
    const blocked = NO_SECOND_SOURCE[typeKey + ':' + label];
    if (blocked) return { kind: 'source', why: blocked };
    if (fixerExists(label, typeKey)) return { kind: 'fact', how: FACT[label], via: FACT[label].via };
    return {
      kind: 'source',
      why: typeKey && typeKey !== 'airport'
        ? 'two independent sources could settle this, but the fixer for a ' + typeKey + ' is not built yet'
        : 'two independent sources could settle this, but that fixer is not built yet',
    };
  }
  if (field.kind === 'link') return { kind: 'manual', why: 'links are set by hand' };
  if (WRITE.has(label)) return { kind: 'write', brief: BRIEF[label] || '' };
  return {
    kind: 'source',
    why: 'this is a fact about the place, not something that can be written from what we hold',
  };
}

/**
 * Can the runner actually attempt this today?
 *
 * 'source' and 'fact' both mean no: one has no source at all, the other has a
 * fixer nobody has wired up yet. Both would queue and hold every record, which
 * is the exact failure this whole file now exists to prevent.
 */
export function isAutomatable(field, typeKey) {
  const kind = fillPlanFor(field, typeKey).kind;
  return kind === 'derive' || kind === 'write';
}

/**
 * Roughly what one field costs to fill, in pence. Derived and factual fills
 * make no model call at all. An editorial field pays for the write plus the two
 * independent gate reads, which is the whole reason the gate is worth paying
 * for: it is the difference between "a model wrote it" and "a model wrote it
 * and two separate reads could not fault it".
 */
export function estimatePence(field, typeKey) {
  const plan = fillPlanFor(field, typeKey);
  return plan.kind === 'write' ? Math.ceil(estimateFieldUsd() * USD_TO_PENCE) : 0;
}

/**
 * Roughly what a dollar is in pence. It only has to be close: this figure is
 * shown to Andy so he can decide whether a job is worth pressing, and the real
 * cap is enforced in dollars against measured token counts in _queue.js. It is
 * named rather than buried so nobody mistakes it for an exchange rate we trade
 * on.
 */
const USD_TO_PENCE = 79;

/**
 * Is there enough on this record to write from?
 *
 * The writer's evidence is the record's own values plus its parents. An airport
 * record holding a name and a country code gives it nothing, so it can only
 * refuse or invent, and either way we pay for the attempt. This is the check
 * that makes an empty record free instead of three pence, and it is the reason
 * the order of work is facts first, editorial second.
 *
 * @returns {{ok:true} | {ok:false, why:string}}
 */
export function hasEnoughToWriteFrom({ rec, ancestors, research }) {
  // A published source about this exact record is evidence, and usually far
  // more of it than the record itself carries. See wikipediaIntro in _source.js.
  if (research && String(research.text || '').trim().length >= MIN_EVIDENCE_CHARS) {
    return { ok: true };
  }
  // Bookkeeping, not evidence about the place.
  const SKIP = new Set(['Status', 'URL Slug', 'Verified Date', 'Source 1 URL',
                        'Source 2 URL', 'Official Website', 'Wikipedia URL']);

  // HOW MUCH IS THERE, not how many boxes are ticked. Counting filled fields
  // was the first attempt and it was simply the wrong measure: on 11 Sep it
  // refused to write a Hero Intro for Estonia, Serbia and Ethiopia, each of
  // which carries a two-hundred-word Overview and nothing else. One rich field
  // scored lower than four containing a currency code and a plug type, which
  // is backwards. Characters of real content is the honest proxy for "is there
  // something here to write from".
  const chars = Object.entries((rec && rec.values) || {})
    .filter(([label, v]) => !SKIP.has(label) && v != null)
    .reduce((sum, [, v]) => sum + String(v).trim().length, 0);
  if (chars >= MIN_EVIDENCE_CHARS) return { ok: true };

  // A parent with real content is evidence too: a resort can be written from
  // its country's overview even when its own row is bare.
  const parentProse = (ancestors || []).some(a =>
    ['Overview', 'Character and Vibe', 'Best Time to Visit']
      .some(l => a.values && String(a.values[l] || '').trim().length >= 80));
  if (parentProse) return { ok: true };

  return {
    ok: false,
    why: 'there is almost nothing on this record to write from, so the facts need filling first',
  };
}

/**
 * Where "a few identifiers" stops and "some description" starts.
 *
 * Not a quality bar, and not precise. The gate judges the output; this only
 * stops an attempt that is certainly wasted. It has to separate two real
 * cases: a country carrying one long overview and nothing else (passes), and a
 * record holding a time zone, a currency, a language and a plug type, which is
 * seventeen characters saying nothing about what a place is like (fails).
 */
export const MIN_EVIDENCE_CHARS = 60;

export const KINDS = { DERIVE, FACT, MANUAL, WRITE, BRIEF, NEVER, FORMAT, INHERITS_FROM_ABOVE };
